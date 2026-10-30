# User preferences — backend and database

The Google account's verified Supabase user ID owns one preferences record.
Authenticated Google-backed recommendation searches use these preferences as
defaults, with optional per-trip overrides. Frontend controls are a separate step.
Reading, updating and resetting preferences make **no Google Places requests**.

## Setup

Apply `backend/sql/005_user_preferences.sql` in the existing Supabase project's
SQL editor after migration 004. No new keys or environment variables are needed.
Google authentication must already be configured. Restart the backend after
building with `npm run build`.

The migration creates `public.user_preferences`, an own-row read policy and a
service-role-only `waydine_patch_preferences` RPC. It does not drop tables,
delete data or change the earlier authentication tables. Account deletion
cascades to preferences through the existing profile foreign key.

The backend's service role writes preferences. Direct anonymous/authenticated
table writes and RPC execution are denied. The RPC performs an atomic partial
upsert, preserving fields omitted from a patch even when separate fields are
updated concurrently. API callers cannot supply another owner's ID.

## Fields and defaults

| Field | Default | Validation |
| --- | --- | --- |
| `diet` | `any` | `any`, `vegetarian-options`, `pure-veg` |
| `cuisines` | `[]` | Existing supported cuisine IDs; duplicates removed, order preserved |
| `includeUnconfirmedDiet` | `false` | Boolean; explicit opt-in for unknown dietary evidence |
| `maxDetourMinutes` | `10` | Integer, 1–60 |
| `budgetPerPersonInr` | `null` | Whole INR per person, 1–100000; null means no saved limit |

These are account defaults, not facts about a restaurant. A saved budget is
compared with Google's typical INR price range. A listed lower bound above the
budget is excluded; overlapping, missing, or invalid ranges remain unconfirmed.
These ranges are estimates of typical spending, not menu prices or guarantees.

## Use preferences for a trip

`POST /api/google/recommend` reads the authenticated account's saved defaults.
If the account has no saved record, it uses the defaults above. Omit the request's
`preferences` field to use them as-is, or provide a partial object to override
only the fields needed for this trip. For example:

```json
{
  "source": [72.84, 19.20],
  "destination": [72.90, 19.24],
  "departure": { "mode": "now" },
  "preferences": { "diet": "any", "cuisines": [], "maxDetourMinutes": 15 }
}
```

The explicit empty cuisine list removes that trip's cuisine filter. `false`
and `budgetPerPersonInr: null` are also valid overrides. Overrides affect only
the current request and never modify saved settings. The response's
`preferenceContext` lists effective values, whether the base came from `saved`
or `defaults`, the overridden field names, and `budgetApplied` indicating whether
a budget is set. Storage errors
fail the search rather than silently changing dietary choices.

The existing public `/api/recommend` retains its required explicit preference
object and does not load user data. Google searches remain disabled by default
and consume provider quota when enabled: obtain the user's approval before any
live Google Places test. See `docs/GOOGLE_PLACES.md` for limits and policy.

## Endpoints

All requests require the existing HttpOnly Google-login session cookie. Responses
use `Cache-Control: no-store`. The backend never exposes the service-role key.

| Method and path | Behavior |
| --- | --- |
| `GET /api/me/preferences` | Return the user's saved preferences, or defaults without creating a DB record |
| `PATCH /api/me/preferences` | Update one or more fields; omitted fields are preserved |
| `DELETE /api/me/preferences` | Remove only this user's preferences record and return defaults |

PATCH/DELETE require `Origin` matching the configured frontend or backend origin
to protect cookie-authenticated mutations against CSRF. Browser fetches use
`credentials: 'include'` when calling a different origin. Empty patches, unknown
fields, `userId`, nested envelopes, strings in place of numbers, and out-of-range
values return structured `BAD_REQUEST` errors. Missing authentication returns
401; rejected origins return 403. Storage/missing-migration failures return
`UPSTREAM_UNAVAILABLE`, never a false successful save or silent defaults.

Example PATCH body:

```json
{
  "diet": "vegetarian-options",
  "cuisines": ["south indian", "maharashtrian"],
  "maxDetourMinutes": 5,
  "budgetPerPersonInr": 300
}
```

Response:

```json
{
  "preferences": {
    "diet": "vegetarian-options",
    "cuisines": ["south indian", "maharashtrian"],
    "includeUnconfirmedDiet": false,
    "maxDetourMinutes": 5,
    "budgetPerPersonInr": 300
  },
  "saved": true,
  "updatedAt": "<database update timestamp>"
}
```

`saved` is false and `updatedAt` is null until the first successful save, or after
reset. `cuisines: []` clears the list; `budgetPerPersonInr: null` clears the limit.

## Tests and manual verification

Run the backend typecheck, test suite and build. Tests mock Supabase storage and
HTTP. They cover defaults, partial changes, persistence across service instances,
account isolation, reset, validation, CSRF, database errors and RPC/read/delete
ownership parameters. They do not apply remote SQL or call Google Places.

After applying migration 005:

1. Sign in and open `http://localhost:4000/api/me/preferences` in the same browser.
   Initially expect defaults with `saved: false`.
2. From the configured frontend origin, execute a credentialed PATCH with the
   example body. Expect `saved: true` and a database timestamp.
3. Reload the GET endpoint and restart the backend. Values must persist.
4. PATCH only `maxDetourMinutes`; all previously saved food choices must remain.
5. Set the budget to null and cuisines to []; confirm explicit clearing works.
6. Sign in as another Google user in a separate browser profile. That user must
   not see or overwrite the first user's preferences. A `userId` JSON field is
   rejected; a `userId` query parameter never changes the authenticated owner.
7. DELETE preferences and confirm defaults return, while the Google account,
   profile, session and other users' preferences remain.
8. Test RLS in Supabase with separate authenticated user contexts: own-row reads
   only, no direct writes, and no direct invocation of the service-only RPC.

The remote schema, RLS and SQL concurrency behavior must be verified after the
migration is applied; mocked tests do not substitute for those database checks.
