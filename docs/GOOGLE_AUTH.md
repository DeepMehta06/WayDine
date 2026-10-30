# Google authentication — backend setup and API

WayDine uses Google sign-in through the existing Supabase project. This change
adds backend authentication only. There is no password login, frontend auth UI,
or automatic login requirement on recommendation/place-search endpoints yet.

## Implementation

1. The browser opens `GET /api/auth/google` as a top-level navigation.
2. Supabase's SDK generates a PKCE verifier/challenge. The verifier storage is
   encrypted in a short-lived, HttpOnly cookie; Google OAuth state is managed by
   Supabase. One login attempt per browser is supported; restarting replaces it.
3. Google returns to Supabase, which returns a single-use authorization code to
   WayDine's callback. The backend exchanges it using that browser's verifier.
4. The backend verifies the user with Supabase Auth and requires a Google-linked
   account with a confirmed email. It upserts the account's public profile.
5. A random 256-bit opaque session cookie is issued. Only its SHA-256 hash goes
   into the database. Supabase access/refresh tokens are encrypted with AES-256-GCM,
   bound to this session hash and token purpose; they never go to the frontend.
6. Account requests validate the durable session and call Supabase `getUser`.
   Tokens within 60 seconds of expiry refresh server-side. Session lifetime is
   fixed (seven days by default), not extended by refresh.
7. Logout deletes the database session first, clears cookies, and attempts to
   revoke the corresponding Supabase session. Provider outages cannot revive a
   deleted WayDine session. Google itself is not signed out.

## 1. Apply the database migration

Open the SQL editor in the existing Supabase project and execute
`backend/sql/004_google_auth.sql`. This migration is transactional and rerunnable.
It does not require the older restaurant schema or PostGIS.

It creates:

- `public.profiles`: Supabase Auth user ID, email, display name, avatar URL,
  provider, creation/update timestamps, and last sign-in timestamp.
- `public.auth_sessions`: session-token hash, profile foreign key, encrypted
  provider tokens, access-token expiry, and absolute application-session expiry.

Both tables use RLS. Authenticated Supabase users may read only their own
profile; profile writes and all session-table operations are backend-only.
Deleting an Auth user cascades to their profile and WayDine sessions. No
passwords, Google client secrets, or plaintext provider tokens are stored here.

Schedule this maintenance query in Supabase (e.g. daily) when deploying:

```sql
delete from public.auth_sessions where expires_at <= now();
```

Expired sessions cannot authenticate even before cleanup. Active attempts to
use an expired session also remove that row.

## 2. Configure Google OAuth in Supabase

A Places API key does **not** configure Google login. You need a Google OAuth
client with application type **Web application**.

1. In Google Cloud, configure the OAuth consent screen for the project. If the
   app is in testing, add the Google accounts that will test it.
2. Create a web OAuth client. Set the authorized redirect URI to the exact
   callback shown by Supabase under **Authentication → Sign In / Providers →
   Google**, normally `https://<project-ref>.supabase.co/auth/v1/callback`.
   Google's redirect goes to **Supabase**, not directly to Express.
3. Enable Google in Supabase and enter that OAuth client ID and client secret.
   Keep the client secret there; WayDine does not need it in its `.env` file.
4. In Supabase **Authentication → URL Configuration**, add the exact WayDine
   backend callback URL to the allowed redirect URLs:
   `http://localhost:4000/api/auth/callback` for local development.
5. For a deployed app, add its exact HTTPS backend callback as well. Match the
   configured host, port, path, and scheme; avoid broad production wildcards.

Only basic identity scopes (`openid email profile`) are requested. Google Drive,
Calendar, and other Google account access are not requested.

References: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google),
[PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[user data](https://supabase.com/docs/guides/auth/managing-user-data).

## 3. Configure the backend

Use these exact variable names in `backend/.env`:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-or-legacy-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-or-secret-key>
AUTH_ENABLED=true
AUTH_ENCRYPTION_KEY=<base64-encoded-random-32-byte-key>
AUTH_CALLBACK_URL=http://localhost:4000/api/auth/callback
AUTH_FRONTEND_URL=http://localhost:5173
AUTH_COOKIE_SECURE=false
AUTH_SESSION_DAYS=7
CORS_ORIGIN=http://localhost:5173
```

Generate the encryption key locally using:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Store the result in the ignored `.env` file or your deployment's secret manager;
do not commit it. Keep the key stable across restarts. Rotating it invalidates
pending login attempts and existing sessions; remove old session rows when
rotating. The public client is separate from the backend service-role client.

`AUTH_ENABLED=false` is the default. Existing routes still start when auth is
disabled; auth endpoints report `NOT_CONFIGURED` rather than fake success.
Enabling auth with incomplete or unsafe configuration fails startup clearly.

For production, use HTTPS and `AUTH_COOKIE_SECURE=true`. Cookies then use the
`__Host-` prefix, Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain attribute.
Use same-site frontend/API hosts, e.g. `app.example.com` and `api.example.com`,
or reverse-proxy `/api` under the frontend origin. Unrelated frontend/API domains
are not supported by this Lax-cookie design. Include the frontend origin in
`CORS_ORIGIN`. Callback and frontend URLs are fixed configuration, never supplied
by the caller. Behind a trusted proxy, configure the existing `TRUST_PROXY` option
so per-client rate limiting sees the intended IP.

## API contract

| Endpoint | Behavior |
| --- | --- |
| `GET /api/auth/status` | `{ "enabled": true/false, "provider": "google" }`; configuration status, not proof of provider/dashboard setup. |
| `GET /api/auth/google` | Sets a ten-minute encrypted PKCE cookie and redirects to Supabase's Google authorization endpoint. |
| `GET /api/auth/callback?code=...` | Exchanges the code, verifies Google identity, persists profile/session, clears the flow cookie, sets the session cookie, then redirects to `AUTH_FRONTEND_URL`. |
| `GET /api/auth/me` | Returns `{ "user": { "id", "email", "displayName", "avatarUrl", "provider", "createdAt", "lastSignInAt" } }`; requires a valid session. |
| `POST /api/auth/logout` | Deletes the current session, clears cookies, returns 204. Requires `Origin` matching the configured frontend or API origin. Repeated logout is harmless. |

All auth responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
OAuth denial, invalid/expired callbacks, missing sessions, and provider/database
outages use the existing structured error envelope. New codes:
`AUTH_FAILED` (401), `UNAUTHENTICATED` (401), `FORBIDDEN` (403).
Upstream details, cookies, codes, and provider tokens are not logged or returned.
OAuth callbacks return a JSON error on failure until a frontend error screen is
added. Caller-supplied redirect destinations are not accepted.

Auth attempts and account endpoints have per-client rate limits. Browser code
must use top-level navigation for sign-in and `credentials: 'include'` for
cross-origin account/logout requests. A future login button can simply navigate
to `/api/auth/google`; frontend Supabase tokens/localStorage are not needed.

`requireAuth` in `backend/src/auth/http.ts` is available for future protected
routes and attaches the verified public account to `req.user`. This release does
not change who can call the recommendation API.

## Validation

From `backend/`:

```sh
npm run typecheck
npm test
npm run build
```

Tests mock Google/Supabase HTTP and storage; they do not create real users or
consume live APIs. They cover PKCE, cookie tampering/expiry, encrypted storage,
Google identity verification, session isolation/expiry, refresh rotation and
concurrency, database failures, logout, CSRF origins, safe redirects, CORS, and
existing recommendation regressions. SQL policies still need verification in a
real Supabase database after applying the migration.

### Manual end-to-end test (no frontend changes required)

1. Complete the migration, provider settings, redirect allowlist and `.env`
   configuration above. Start the backend with `npm run dev`.
2. Open `http://localhost:4000/api/auth/status`; expect `enabled: true`.
3. Navigate to `http://localhost:4000/api/auth/google` and select a test Google
   account. Expect a redirect to `http://localhost:5173` after consent. That URL
   can show the existing app; no new UI is required for the session to work.
4. In the same browser, open `http://localhost:4000/api/auth/me`. Expect the
   selected account's public data and no tokens. Inspect cookies: HttpOnly,
   SameSite=Lax, and an opaque session value. The OAuth cookie should be cleared.
5. Check Supabase: one profile for that Auth user and a session row containing
   a hash and encrypted token envelopes. Sign in again: profile count stays one.
6. Restart the backend with the same key; `/me` must still work.
7. From the browser console on the configured frontend origin, run:

   ```js
   await fetch('http://localhost:4000/api/auth/logout', {
     method: 'POST', credentials: 'include'
   });
   ```

   Expect 204. `/me` must now return 401, even with a copied old session cookie.
8. Cancel Google consent, reuse a callback code, try a callback in another browser,
   and let a login attempt expire: no new application session should be created.
9. Test with two Google users in separate browser profiles; each must see only
   their own account. Check RLS using separate Supabase authenticated clients:
   cross-user profile reads and every session-table operation must be denied.

Use `localhost` consistently during local testing; cookies are host-based and
will not follow a switch to `127.0.0.1`. No background Google access is required.

## Deployment limitations

- Dashboard/provider configuration and SQL migration must be completed separately;
  code alone cannot enable a Google OAuth client or create remote tables.
- Refresh coalescing and IP rate limits currently assume one backend process,
  matching the existing app. Before running multiple instances, use a shared
  refresh lock and shared rate-limit store to coordinate refresh-token rotation.
- A Google identity is required. There is no email/password, phone, account
  deletion UI, preference editor, or application authorization role system yet.
- Apply user-facing privacy/terms pages when adding the frontend and publishing
  the app. Authentication does not enable Google Places, Maps, or Routes APIs.
