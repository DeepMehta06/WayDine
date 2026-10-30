# WayDine documentation

Eat on the way, not out of the way. WayDine discovers restaurants along a driving route and explains the extra travel each stop adds. This guide describes the implementation in this repository; provider availability, database deployment and real-world road access require separate verification.

## Product and user journey

The public landing page demonstrates city and highway trips with illustrative restaurant data. Google sign-in leads to preference onboarding, then the planning form. Choose and confirm origin and destination, departure time, dietary requirements, cuisines, maximum extra driving time and an optional per-person INR budget. The results page shows route alternatives, ranked stops, arrival estimates, exclusions and uncertainty. A stop detail view supplies more information and navigation options. Profile manages defaults; History lists saved successful searches and supports deletion and replanning.

Public routes: /, /signin and /docs. Account routes: /onboarding, /plan, /trip, /trip/stop/:id, /profile and /history. The onboarding route permits accounts without saved preferences; other account pages require completed preferences.

## System architecture

```text
Browser: React 19 / Vite / React Router / Tailwind / PWA
  │ typed API client + runtime Zod response validation
  │ shared contract: backend/src/contract/api.ts
  ▼
Express API: request IDs → CORS → validation → auth / quotas
  ├─ Recommendation orchestration → eligibility / hours / ranking
  │    ├─ Google Routes: baseline, matrix, via-stop verification
  │    ├─ Google Places: corridor discovery, details, photos
  │    ├─ Geoapify: location search and legacy discovery
  │    └─ OSM graph: snapping → directed Dijkstra → detour evidence
  ├─ Auth: Google → Supabase OAuth / PKCE → server session
  ├─ Preferences and trip summaries → Supabase PostgreSQL
  └─ Local quota files / caches / optional search analytics

Google Maps JavaScript renders the browser map separately.
```

Frontend state lives in AuthProvider and the account-keyed TripProvider. Changing accounts remounts trip state. Pages are lazy loaded behind an error boundary. The API client handles credentials, cancellation and structured errors. Provider adapters isolate external HTTP from recommendation logic. Graph modules implement road topology independently from display rendering. PostgreSQL persists account data; restaurant discovery is provider driven rather than a curated database lookup.

## Repository map

- frontend/src/pages: public, planning, results, details and account screens.
- frontend/src/components: reusable UI, landing visuals, maps, trip panels and shell.
- frontend/src/app: authentication and trip state providers.
- frontend/src/lib: typed HTTP client, formatting, motion and provider browser integration.
- backend/src/routes: HTTP validation and endpoint orchestration.
- backend/src/services: discovery, eligibility, hours, budgets, ranking, routing, preferences and history.
- backend/src/providers: Google, Google Routes, Geoapify and retained Mapbox adapters.
- backend/src/graph: OSM parsing, directed roads, snapping, turn restrictions, shortest paths and traffic observations.
- backend/src/auth: OAuth provider, encrypted sessions, cookie and Origin checks.
- backend/src/db: account storage and optional analytics adapters.
- backend/sql: ordered database migrations; backend/test: mocked service and HTTP tests.
- docs: feature setup guides and historical audits. Older audits describe the code at their recorded time, not necessarily current behavior.

## Recommendation pipeline

1. Validate coordinates in longitude/latitude order, departure and preferences. Google requests merge saved account defaults with explicit trip overrides.
2. Obtain Google Routes alternatives and select the requested baseline. If that alternative is no longer offered, use the fastest and add a warning.
3. Discover candidate venues along the route. Google mode uses a configurable point-to-polyline corridor, 200 metres by default, with bounded nearby searches and details enrichment.
4. Screen candidates for access and detour. Google mode uses matrix estimates followed by full via-stop verification. Details are deferred until route screening when the Google routing path is used, limiting enrichment costs.
5. Evaluate dietary and cuisine evidence, price budget and opening hours at estimated arrival. Unknown information is represented explicitly. Arrival labels use Asia/Kolkata, independently of server timezone.
6. Exclude confirmed failures and rank surviving candidates by added travel time plus evidence penalties. Return explanations, exclusions, warnings, routing metadata and diagnostics.
7. For authenticated requests carrying tripLabels, save an account-owned summary after success, including successful searches with zero results. A history write failure leaves recommendations available and reports that saving failed.

Ranking cost starts with nonnegative extraTimeSec. Fixed penalties in services/ranking.ts are 180 seconds for unknown hours, 120 for uncertain access, 240 for unconfirmed diet, 300 for closing within 30 minutes, 90 for a possible additional U-turn and 120 for possible backward travel. These are heuristic ordering weights, not measured user preferences or calibrated confidence scores. They do not alter the displayed actual detour.

## Graph routing and limitations

ROUTING_ENGINE=google is the default. ROUTING_ENGINE=graph ranks candidate stops using directed Dijkstra on OSM roads while retaining Google for the baseline discovery corridor and bounded cross-checks. OSM_GRAPH_SOURCE=file reads OSM_GRAPH_PATH; overpass downloads corridor road data and uses GRAPH_CACHE_DIR. File mode needs coverage of the complete journey and detours.

The graph snaps endpoints and venues to roads, accounts for supported one-way and node turn restrictions, and compares start→stop→destination with start→destination using the same graph. Restaurant snapping excludes motorways and is bounded to 75 metres. Backward travel of at least one kilometre excludes a stop; smaller access findings can penalize it. Class-speed durations are scaled against the Google baseline. Cross-check disagreement adds uncertainty without reranking.

If graph preparation fails, recommendations fall back to Google and expose routing.fallbackReason. POST /api/graph/route is a separate graph preview. Extracts are bounded to 30 MB and 200,000 nodes; Overpass preview requests are limited to 200 km and may omit paths outside their corridor. Missing graph paths do not establish real-world inaccessibility. OSM coverage, snapping, access restrictions and turn support can be incomplete. Preserve OpenStreetMap attribution.

Traffic observation support accepts fresh direction-specific adapter inputs and falls back to estimated speeds for stale or absent observations. No live traffic feed is connected by default. This is a planning estimate, not turn-by-turn navigation or a future traffic forecast.

## API reference

All paths below are relative to the backend origin. Request and response types are defined in backend/src/contract/api.ts. Google account mutations require trusted Origin and credentialed cookies; Google recommendation and detail/photo routes require enabled Places and authentication.

```text
GET    /api/health                    Process liveness
GET    /api/ready                     Configuration readiness
GET    /api/auth/status               Sign-in configuration status
GET    /api/auth/google               Start Google OAuth redirect
GET    /api/auth/callback             Complete PKCE code exchange
GET    /api/auth/me                   Current public account
POST   /api/auth/logout               Revoke session (trusted Origin)
GET    /api/me/preferences            Account defaults and saved state
PATCH  /api/me/preferences            Partial preference update
DELETE /api/me/preferences            Reset defaults
GET    /api/me/trips                  Owner history; limit and cursor
DELETE /api/me/trips/:id              Delete owner's summary
DELETE /api/me/trips                  Clear owner's history
GET    /api/places/suggest            Location autocomplete
GET    /api/places/reverse            Coordinate lookup
POST   /api/recommend                Legacy discovery recommendation
GET    /api/google/status             Google Places configuration
POST   /api/google/recommend          Account-aware recommendations
GET    /api/google/restaurants/:placeId  Bounded details
GET    /api/google/photo              Bounded photo retrieval
POST   /api/graph/route               Independent OSM graph preview
```

Example authenticated Google request body (documentation only; submitting it calls providers):

```json
{
  "source": [72.85, 19.20],
  "destination": [72.86, 19.23],
  "departure": { "mode": "now" },
  "preferences": {
    "diet": "vegetarian-options",
    "includeUnconfirmedDiet": false,
    "maxDetourMinutes": 10,
    "cuisines": [],
    "budgetPerPersonInr": 500
  },
  "tripLabels": { "source": "Origin", "destination": "Destination" }
}
```

Google preferences are optional partial overrides. Legacy recommendation requests require their complete preference object and do not use account history. History uses newest-first keyset pagination, default 20 and maximum 50 records; nextCursor is nullable. Replanning restores labels and preferences, resets departure, and requires endpoint confirmation without automatically calling Places.

Errors use an error object with code, message and optional requestId, retryAfterSec and details. Important statuses: BAD_REQUEST 400, UNAUTHENTICATED/AUTH_FAILED 401, FORBIDDEN 403, NO_ROUTE/OUT_OF_COVERAGE 422, RATE_LIMITED/QUOTA_EXCEEDED 429, UPSTREAM_UNAVAILABLE 502, NOT_CONFIGURED 503 and UPSTREAM_TIMEOUT 504. Provider bodies and tokens are not exposed as client diagnostics.

## Database and migrations

001_schema.sql creates PostGIS restaurant/opening-hour tables and search_history. The restaurant tables, 002_candidates_rpc.sql and 003_seed.sql belong to the earlier curated-data design; current provider discovery does not require seeded restaurants. The optional analytics logger uses search_history.

Apply 004_google_auth.sql, then 005_user_preferences.sql, then 006_trip_history.sql for account features. They create profiles, auth_sessions, user_preferences and account-owned trip history with indexes, policies and service-controlled writes. Apply SQL separately in Supabase; application startup does not migrate remote databases. Check each migration's prerequisites before running it.

Profiles reference Supabase identity; sessions store hashes of opaque identifiers and encrypted provider token envelopes. Preferences store account defaults. Trip summaries retain labels, timestamps, effective preferences, result count and an account-scoped idempotency identifier. They do not retain coordinates, restaurant records, route geometry, photos or tokens. Deleting a profile cascades to its history. Optional search analytics are separate and can store coordinates: review their retention before enabling SEARCH_LOGGING.

## Local development

Install dependencies separately in backend and frontend. Copy each .env.example to .env and configure only the capabilities needed. Never commit keys. Use a Node version compatible with the installed Vite release and the lockfiles.

```sh
# Terminal 1, from backend/
npm ci
npm run dev
# Terminal 2, from frontend/
npm ci
npm run dev
```

The API defaults to localhost:4000 and Vite to localhost:5173. Vite proxies /api to the backend; WAYDINE_API_PROXY changes the development/preview proxy target. VITE_API_BASE_URL changes the browser API base. /docs remains public without signing in. A provider-free install can render documentation and the illustrative landing page; real recommendations need configured providers.

## Configuration and provider boundaries

- Google Maps display: VITE_GOOGLE_MAPS_API_KEY, restricted to browser referrers and Maps JavaScript. Map loads have separate billing; documentation itself contains no map.
- Route computation: GOOGLE_ROUTES_API_KEY, GOOGLE_ROUTES_PER_DAY (100 default), GOOGLE_ROUTE_MATRIX_ELEMENTS_PER_DAY (300 default).
- Restaurant discovery: GOOGLE_PLACES_ENABLED=false by default and GOOGLE_PLACES_API_KEY. Enable explicitly after configuring auth. Default per-request limits are 3 searches and 3 details, with a 200 m corridor. Daily/monthly nearby limits are 20/100, details 20/100 and photos 30/200. These are application ceilings, not promises about provider pricing or free allowances.
- Search: GEOAPIFY_API_KEY powers existing location search and legacy discovery. Mapbox adapters and budget configuration remain for legacy paths; they do not render the current Google map.
- Account storage: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and server-only SUPABASE_SERVICE_ROLE_KEY. AUTH_ENABLED=true also requires AUTH_ENCRYPTION_KEY, a base64 32-byte key. Configure AUTH_CALLBACK_URL, AUTH_FRONTEND_URL, CORS_ORIGIN and AUTH_COOKIE_SECURE.
- Runtime controls: PORT, TRUST_PROXY, SEARCH_LOGGING, QUOTA_STATE_FILE and GOOGLE_PLACES_QUOTA_FILE. Full validated configuration and defaults live in backend/src/config.ts; both .env.example files describe deployment values.

Before any live Google Places API request, obtain explicit approval for that request or a clearly bounded batch. A configured key is not authorization. Automated tests must mock Google, including photos. Do not automatically run backend/scripts/test-live-apis.mjs or Google-backed smoke searches.

## Authentication and security

Google redirects through Supabase OAuth to the fixed backend callback. PKCE flow state is encrypted in a short-lived cookie; provider tokens remain encrypted server side with purpose-bound AES-256-GCM. Sessions use opaque random identifiers whose hashes are persisted. Browser JavaScript receives public identity rather than provider tokens.

Production requires HTTPS, AUTH_COOKIE_SECURE=true, exact allowed redirects and same-site frontend/API hosts or an /api reverse proxy. Secure cookies use the __Host- prefix, HttpOnly and SameSite=Lax. Sensitive responses use no-store. Trusted-Origin checks protect account mutations. Owner IDs come from authenticated sessions rather than request bodies. Service-role credentials stay on the server; validate RLS and grants with real separate accounts after migrations.

Keep AUTH_ENCRYPTION_KEY stable across restarts; rotation invalidates existing encrypted sessions. Never expose backend keys through VITE_ variables. Trust proxy headers only behind a controlled reverse proxy. IP rate limits and refresh coordination are process local: multiple replicas need shared coordination and quota storage rather than relying on independent local files.

## Frontend and motion

The UI uses React Router, Tailwind and Radix-based components, Lucide icons and shared TypeScript contracts. GSAP handles entrance effects; Lenis connects scrolling to ScrollTrigger. The landing hero uses Vanta NET with Three.js, desktop and reduced-motion gating, and graceful WebGL failure. Documentation reuses the visual language with readable sections, search and anchors. PWA runtime caching is empty and /api is excluded from navigation fallback to avoid serving the app shell for API requests.

## Tests and verification

```sh
# backend/
npm run typecheck
npm test
npm run build
# frontend/
npm run lint
npx vitest run
npm run build
```

Backend tests cover HTTP validation, mocked providers, quotas, route evidence, graph behavior, opening hours, meal timing, budgets, auth, preferences and trip history. Frontend tests cover recommendation contract handling and history interactions. Tests do not establish production RLS correctness, provider uptime, billing, map accuracy or navigation safety. Historical live-test files record bounded prior runs and are not performance benchmarks.

## Deployment and troubleshooting

Build backend to dist and run npm start. Publish frontend/dist on an SPA-capable host that rewrites non-file paths such as /docs to index.html; keep /api routed to Express. Configure TLS, same-site cookies, exact CORS origins, environment variables, database migrations and persistent storage for quota/cache files. Keep secrets and .data outside public static hosting. Vite preview is for verification rather than the production server.

NOT_CONFIGURED means a capability is disabled or missing required configuration. A blank map usually needs a browser key, API enablement or referrer configuration. Auth callback failures require matching Google→Supabase and Supabase→backend redirects. Preference/history failures can indicate unapplied migrations. Graph fallback needs extract coverage and usable endpoint snaps; inspect fallbackReason. Quota errors require reviewing local counters and provider dashboards rather than blindly retrying. Use request IDs to correlate sanitized server logs.

## Further reading

Repository guides: docs/GOOGLE_AUTH.md, docs/GOOGLE_PLACES.md, docs/USER_PREFERENCES.md and docs/TRIP_HISTORY.md. PRODUCT.md explains product intent; WayDine-Build-Plan.pdf records the original plan. Source and current tests take precedence over historical planning or audit documents where they differ.
