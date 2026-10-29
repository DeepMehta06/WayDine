# WayDine project audit

Reviewed: 29 October 2026 (Asia/Kolkata).

## Assessment

WayDine is a small, working route-search prototype with significant correctness and product gaps. Its largest weaknesses are location identity, incomplete restaurant discovery, an unjustified side-of-road exclusion, and recommendations that cannot distinguish a good restaurant from an arbitrary nearby POI. Adding libraries alone will not resolve these problems.

The next version should support neighbourhood-to-neighbourhood driving trips, beginning with Mumbai, as deliberately as it supports highway trips. Kandivali West to Borivali East, a particular station entrance, and an exact restaurant should be valid inputs with visibly confirmed endpoints. Restaurant recommendations must explain access, extra travel time, actual food evidence, and what is unknown.

This is an audit and proposed implementation order. Application source and configuration were not changed. The report and diagnostic files are the deliverables.

## Scope and evidence

Read all 40 source files (2,315 lines), the SQL, package manifests, build/configuration files, READMEs, launcher configuration, and all 14 pages of the original build plan. Inspected the public icon dimensions. Read provider documentation to verify API assumptions. Reviewed the original plan as historical context, rather than treating its six-hour demo cuts as current product requirements.

Evidence labels:

- **Live**: observed in the running app or local HTTP endpoint.
- **Reproduced**: demonstrated with the real compiled backend functions and mocked provider responses; no provider calls are made by the diagnostic script.
- **Code**: directly established by implementation or absence of a relevant implementation in this repository.
- **Coverage**: provider documentation or a dataset limitation requiring a benchmark; not a claim that every live query fails.
- **Gap**: missing product capability proposed for the improved version, not necessarily an original requirement.

Priorities: **P1** fix before trusting recommendations or widening usage; **P2** next product/reliability pass; **P3** maintenance or polish. The numbered list contains **74 findings**; related symptoms are kept together where they share a fix.

### Checks completed

| Check | Result |
| --- | --- |
| Backend `npm run typecheck` | Passed |
| Backend `npm run build` | Passed |
| Frontend `npm run build` | Passed after allowing writes to the existing TypeScript cache; initial access denial was environmental |
| Frontend `npm run lint` | Passed with 3 warnings: state update in autocomplete effect; Fast Refresh exports in badge/button |
| Diagnostic script | 9 behavioural defects reproduced; see [script](audit-regressions.mjs) and [output](audit-results.json) |
| Local health endpoint | Returned `{"status":"ok"}` |
| Local restaurant-list endpoint | Returned an empty restaurant list during the audit |
| Live Kandivali to Borivali | Suggestions resolved and a route returned 4 recommendations |
| Phone viewport, 390 x 844 CSS pixels | Results region measured 0px high; header and form exceeded allocated sidebar height |
| PWA icon dimensions | Correct 192 x 192 and 512 x 512 PNG dimensions; installability was not tested |

No production deployment, database policies, account quotas, token restrictions, or exhaustive restaurant ground truth were inspected. No dependency vulnerability scan or measured network/performance benchmark was completed. A passing build establishes compilation, not recommendation correctness.

## What happened on the user's example

1. Typing **Kandivali** returned a suburb suggestion plus several stations/other POIs.
2. Selecting the suburb changed the visible field to **Mumbai, 400067, India**, dropping the name Kandivali.
3. Typing **Borivali** produced several identically named results with different context. Selecting the Mumbai 400091 result changed its field to **Mumbai, 400091, India**.
4. A departure of 30 October 2026 at 12:00 and the default 15-minute detour returned Butterfly Cafe & Restro, Nandu Dosa Dinner, Aura Restaurant, and Veg Treat Regalia. This is one observation, not independent verification of those businesses or their hours.
5. After changing the selected source text to **Andheri** without selecting a new result, the submit button remained enabled. The code retains the previously selected Kandivali coordinates.
6. At 390 x 844, the results region collapsed to zero height. Its preceding header measured about 69px and form about 414px, against a sidebar allocation of about 464px.

The complaint is supported, but the precise diagnosis matters: the application can return these suburbs. It loses useful locality identity, makes disambiguation difficult, and has no robust quality or coverage strategy after resolving coordinates.

## Complete findings

### Location search and endpoint identity

| ID | Priority / evidence | Problem and consequence | Required change / source |
| --- | --- | --- | --- |
| 01 | P1 / Coverage + Live | India is outside the geography currently listed in Search Box documentation, although live Indian queries did work. Both address and restaurant discovery depend on this undocumented coverage assumption. | Benchmark and choose a provider that explicitly covers the target market. `frontend/src/lib/mapbox.ts:27`; `backend/src/services/mapbox.ts:119`. [Provider geography](https://docs.mapbox.com/api/search/search-box/#supported-geographies). |
| 02 | P1 / Code | Autocomplete restricts results to `place,address,poi`, omitting locality, neighbourhood, and street types. Some suburb names may still appear under other types; this is a restriction, not proof they always disappear. | Include appropriate granular feature types and identify each suggestion's type. `frontend/src/lib/mapbox.ts:27`. |
| 03 | P1 / Code + Live | No city, map-centre, selected-endpoint, or user-approved current-location bias. Country-wide matching leaves ambiguous suburb/POI results competing in only five slots. | Apply sensible contextual bias; show suburb, East/West where supplied, city, and feature type. `frontend/src/lib/mapbox.ts:27`. |
| 04 | P1 / Live | Selecting Kandivali/Borivali replaces the field with an address that omits the selected name. Two local endpoints visually become “Mumbai”. | Keep selected name and address separately; display both. `frontend/src/components/PlaceAutocomplete.tsx:62`; `frontend/src/lib/mapbox.ts:64`. |
| 05 | P1 / Live + Code | Editing or clearing selected text never clears the stored selected coordinates in SearchForm. The displayed route and submitted route can be different. | Controlled selected-place state; invalidate immediately on any free-text edit. `PlaceAutocomplete.tsx:78`; `SearchForm.tsx:23`. |
| 06 | P2 / Gap | No “use my location” flow, making a nearby food stop unnecessarily difficult to start. | Add an explicit permission-triggered location action with a manual fallback. `SearchForm.tsx`; `MapView.tsx`. |
| 07 | P1 / Gap | No map pin selection, reverse lookup, selected-endpoint markers, or endpoint preview before submission. A suburb centroid can land on the wrong side of a railway, junction, or access road. | Allow exact endpoint confirmation and adjustment; do not infer entrances from suburb names. `MapView.tsx`; `SearchForm.tsx`. |
| 08 | P1 / Code | Non-2xx suggest responses become `[]`, retrieval errors become null, and network exceptions in the async handlers are uncaught. Users cannot distinguish “no place” from a failed service; resolution can remain disabled after a thrown fetch. | Show loading/empty/error states and retry; use try/catch/finally. `lib/mapbox.ts:28,47`; `PlaceAutocomplete.tsx:44,53`. |
| 09 | P1 / Code | Debouncing cancels timers, not in-flight requests. Older responses can overwrite newer suggestions or reopen a dropdown after selection/blur. | Abort requests and ignore obsolete responses, including short/cleared queries. `PlaceAutocomplete.tsx:30`. |
| 10 | P1 / Code | Suggestions select only on `onMouseDown`, without normal click/keyboard selection or a proper combobox pattern. Arrow/Enter/Escape behaviour and ARIA selection state are absent. | Use an accessible combobox and test keyboard/touch selection. Also support Space on recommendation cards. `PlaceAutocomplete.tsx:84`; `RecommendationCard.tsx:19`. |
| 11 | P2 / Gap | Only English is requested, and the application has no locality alias/transliteration handling or tests for “Borivali/Borivli”, East/West, Hindi, or Marathi queries. | Benchmark common local spellings and scripts; normalize documented aliases without silently replacing distinct areas. `lib/mapbox.ts:27`. |

### Restaurant discovery and data completeness

| ID | Priority / evidence | Problem and consequence | Required change / source |
| --- | --- | --- | --- |
| 12 | P1 / Reproduced | Samples are 15km apart but each query covers a box extending only 0.03 degrees each way. A roughly 10km urban route gets only endpoint searches; its middle can be missed. Longer routes have gaps between boxes. | Cover the complete route corridor with density-aware overlapping searches. `backend/src/services/candidates.ts:7,43`; `mapbox.ts:116`. |
| 13 | P1 / Reproduced | After 8 samples, sampling stops rather than distributing across the entire route. The destination is not appended once the cap is reached. Long trips lose their tail. | Allocate samples across the full distance and always cover both ends. `candidates.ts:48,57`. |
| 14 | P1 / Code | Each query asks for only 10 restaurants, with no pagination or denser retry. Busy areas lose candidates before route filtering even runs. | Use provider-supported pagination/area subdivision and a route-wide retrieval budget. `mapbox.ts:112,120`. |
| 15 | P2 / Gap | Discovery queries only the restaurant category, despite offering breakfast/snacks/coffee-style recommendations. There is no explicit strategy for cafés, bakeries, quick bites, or food courts. | Search the intended food categories and deduplicate; measure what each provider includes. `mapbox.ts:119`. |
| 16 | P1 / Reproduced | “Distance from route” means nearest polyline vertex, not nearest point on a segment. A POI exactly on a 1km route segment was rejected for being over 400m from its endpoints. | Use segment projection/geodesic point-to-line distance. `candidates.ts:26`. |
| 17 | P1 / Code | A fixed 400m straight-line gate is applied before real detour evaluation, regardless of the user's 5–30 minute allowance. A useful two-minute stop 500m away is never considered. | Make the discovery corridor a documented product constraint or adapt it to trip context and detour budget. `candidates.ts:6,81`; `SearchForm.tsx:84`. |
| 18 | P1 / Code | Only the 23 closest-to-route candidates survive, before dietary/hours/access/quality checks. Those 23 can all fail while viable restaurants are discarded. | Retrieve more, do cheap confidence/eligibility checks, then route candidates in batches. `candidates.ts:97`; `graph.ts:55`. |
| 19 | P2 / Code | Deduplication is only by provider ID. Duplicate listings with different IDs can occupy limited candidate slots; no normalized branch identity exists for future multiple providers. | Deduplicate by source ID plus conservative name/address/distance matching, preserving distinct branches. `candidates.ts:75`. |
| 20 | P1 / Code | `Promise.all` makes a single failed sample reject discovery for the whole route. | Bounded concurrency, partial success handling, provider status, and an honest coverage warning where needed. `candidates.ts:73`. |
| 21 | P1 / Code | Most useful restaurant fields never enter the model: full address, phone, website, rating/review evidence, price, photos, source URL, operational status, and freshness. Some may be unavailable; the adapter also discards extra fields a provider could supply. | Define a normalized place-details model with nullable fields and source attribution. `mapbox.ts:75,126`; `backend/src/types/index.ts:37`. |
| 22 | P1 / Code | Uses feature coordinates only, without entrance/routable access coordinates or validated access confidence. Driving to a building centroid is not the same as driving to its entrance. | Prefer provider entrance/access points where available and verify shortlisted stops through routing. `mapbox.ts:135`; `frontend/src/lib/mapbox.ts:65`. |

### Routing, access, and arrival correctness

| ID | Priority / evidence | Problem and consequence | Required change / source |
| --- | --- | --- | --- |
| 23 | P1 / Code | Every right-side POI is excluded as requiring a U-turn. There is no road-class, median, junction, one-way, or service-road evidence. This is unjustified on ordinary urban streets and some highway access layouts. | Treat geometric side as a hint; establish access through the road router and verified constraints. `direction.ts:25`; `ranking.ts:76`. |
| 24 | P1 / Reproduced | A zero cross product, including a POI on the route line, is classified right and rejected. Degenerate local direction vectors have no unknown state either. | Handle on-line/ambiguous geometry explicitly with a tolerance. `direction.ts:26`. |
| 25 | P1 / Code | Being left of the route is treated as evidence of usable access. A wall, elevated road, railway, fenced plot, or driveway can invalidate that claim. | Require routable entrance/access evidence and show confidence separately from geometric side. `direction.ts:31`; `ranking.ts:52`. |
| 26 | P1 / Code | Source→restaurant and restaurant→destination are independently fastest routes. They can leave the displayed route or arrive/depart from inconsistent approaches. The UI never verifies the complete via-stop journey. | Route shortlisted stops as complete journeys with waypoints/approaches; compare and display their actual geometry. `graph.ts:63,78`; `mapbox.ts:60`. |
| 27 | P2 / Gap | Only the first route is considered. There is no alternative-route selection, route-progress/stop-after-time preference, or preservation of a user's intended corridor. | Establish one explicit selected baseline route and rank stops against it. `mapbox.ts:31`; `SearchForm.tsx`. |
| 28 | P1 / Code | Detour compares Matrix leg times to a separate Directions baseline, clamps negatives to zero, and rounds before exclusion. A 15m29s extra journey can pass a 15-minute limit; disagreement between APIs is hidden. | Align profiles/options; keep seconds internally, validate anomalies, round only for display. `graph.ts:97`; `ranking.ts:92`. |
| 29 | P1 / Code | A full 25×25 matrix computes 625 elements although this graph uses only source→candidate, candidate→destination, and baseline edges (47 for 23 candidates). This spends quota unnecessarily. | Use rectangular/batched matrices or targeted via routes. `mapbox.ts:60`; `graph.ts:76`. [Matrix sources/destinations](https://docs.mapbox.com/api/navigation/matrix/). |
| 30 | P2 / Code | Dijkstra is implemented and runs, but the constructed graph gives each restaurant one relevant incoming edge from source and one outgoing edge to destination. Its distances reduce to those two matrix lookups. It does not constrain travel along the displayed route. | Keep it only with a clearly explained role, or construct a meaningful directed graph of route anchors/access edges if graph reasoning remains a requirement. `graph.ts:75,91`. |
| 31 | P2 / Reproduced | Unreachable Matrix legs become Infinity and produce `Invalid Date` ETAs. Later ranking normally excludes them as infinite detours, giving the wrong explanation rather than identifying unreachable access. | Explicit reachability checks and a structured exclusion reason before time calculation. `mapbox.ts:68`; `graph.ts:100`. |
| 32 | P1 / Reproduced | Meal, opening weekday, and ETA use the server timezone rather than restaurant time. The same 12:00 IST instant produces breakfast on a UTC server and lunch on an India-time server. | Carry absolute timestamps and evaluate using Asia/Kolkata for the current India scope. `graph.ts:101`; `mealRules.ts:11,41`. |
| 33 | P1 / Code | Arrival is reduced to HH:mm and reconstructed from departure, losing the actual date and duration. Multi-day travel cannot be reconstructed reliably. | Keep ISO arrival timestamps and duration seconds through the whole pipeline; format in the UI. `graph.ts:101`; `mealRules.ts:70`. |
| 34 | P1 / Reproduced | For a 12:00:30 departure and 10-second journey, truncating to 12:00 makes the reconstructed time earlier than departure, so the code advances a day and checks the wrong opening weekday. | Remove string round-tripping; compare the actual arrival instant. `mealRules.ts:74`. |
| 35 | P1 / Reproduced | Opening-hours parsing discards `close.day`, drops periods without close times, and has no explicit 24/7 or exceptional-date model. A Monday→Wednesday period is incorrectly closed on Tuesday. | Normalize full weekly intervals and special hours using validated provider formats and a suitable parser. `mapbox.ts:90`; `mealRules.ts:40`. |

### Recommendation quality and truthfulness

| ID | Priority / evidence | Problem and consequence | Required change / source |
| --- | --- | --- | --- |
| 36 | P1 / Reproduced | `vegAvailable` is hardcoded null for every live candidate; vegetarian-only excludes only false. The switch does not filter current candidates at all. | Distinguish confirmed vegetarian options, confirmed pure veg, and unknown. Make strictness explicit; never infer from a restaurant name. `candidates.ts:89`; `ranking.ts:100`. |
| 37 | P1 / Code | Food match contributes a full 30% by default. With no cuisine input in the UI and no confirmed dietary facts, this component is effectively constant for live recommendations. | Rank on available, documented signals; missing evidence must not masquerade as a perfect food match. `ranking.ts:27`; `SearchForm.tsx:39`. |
| 38 | P1 / Reproduced + Code | “Good for lunch” follows the clock, not menu/service evidence. Being open at lunch does not establish that lunch is served. | Separate suggested meal time from verified availability and explain the distinction in user-facing copy. `mealRules.ts:93`; `ranking.ts:54`. |
| 39 | P1 / Code | No restaurant reputation or quality signal participates in ranking: no rating/review count, popularity evidence, verified listing quality, or source-confidence measure. Thus the app has no basis to prioritize a known good restaurant. | Benchmark usable quality sources and use transparent scoring with evidence coverage; familiarity alone should not determine quality. `ranking.ts:8`; `backend/src/types/index.ts:37`. |
| 40 | P2 / Code + Gap | Cuisine is the first coarse POI category, can fall back to “restaurant”, and uses exact string equality for preference matching. The UI has no cuisine selector. | Normalize cuisine tags; keep venue type separate and expose supported cuisine preferences. `mapbox.ts:138`; `ranking.ts:35`. |
| 41 | P2 / Code | Proximity scoring reaches zero at 200m while candidate discovery accepts 400m. Restaurants from 200–400m all lose differentiation in this score. | Use one documented configuration and calibrate against actual driving access. `ranking.ts:47`; `candidates.ts:6`. |
| 42 | P1 / Reproduced | The drawer turns an arbitrary weighted score into a match percentage. A candidate with unknown hours/diet/cuisine can receive 93%; this is not a calibrated probability or quality rating. | Present a transparent fit explanation and separate evidence confidence; do not imply certainty through percentages. `DetailsDrawer.tsx:53`; `ranking.ts:110`. |
| 43 | P1 / Live + Code | Drawer says “Open now” for a value calculated at future arrival. The audited trip was scheduled for the next day. | Label “Expected open at arrival” with date/time, timezone, and uncertainty. `DetailsDrawer.tsx:39`. |

### User experience, map state, and mobile

| ID | Priority / evidence | Problem and consequence | Required change / source |
| --- | --- | --- | --- |
| 44 | P1 / Live | At a 390×844 phone viewport, the results area has zero height: the non-shrinking form/header exceed a fixed 55svh sidebar. A successful search can be unusable on a phone. | Scrollable/collapsible search and a usable results bottom sheet or list/map switch. `App.tsx:22,28,33`. |
| 45 | P1 / Gap | No navigate/open-in-maps action, call action, or website/source link. Users can discover a name but cannot act on the stop from the app. | Add a chosen-stop navigation handoff and verified contact/source actions where available. `DetailsDrawer.tsx`. |
| 46 | P2 / Gap | Route duration is returned but never shown; route distance is fetched then omitted from the response. No named origin/destination summary or destination arrival is displayed. | Show route names, kilometres, baseline time, selected-stop extra time, and resulting arrival. `recommend.ts:76`; `App.tsx`. |
| 47 | P1 / Gap | Selecting a restaurant zooms the map but does not draw the diversion, entrance, or rejoin. Straight-line “off road” distance can look like actual access distance. | Show the complete route via the selected stop and label geometric distance accurately. `MapView.tsx:108`; `DetailsDrawer.tsx:51`. |
| 48 | P2 / Code | During a new search, old data stays visible and interactive. Only the button label changes; there is no stale-result notice, stage/progress feedback, or cancellation. | Associate visible results with a search snapshot, mark stale state, and provide useful progress. `useRecommend.ts:17`; `App.tsx:34`. |
| 49 | P1 / Code | Empty state still claims a 200m rule, while discovery uses 400m. It offers no radius/detour relaxation or distinction between no coverage and no eligible stops. | Report counts/reasons by stage, offer deliberate recovery actions, and use current configuration. `NoResultsState.tsx:12`. |
| 50 | P2 / Code | Exclusion reasons are only displayed when there are zero recommendations. With one survivor, every other exclusion disappears from the experience. Candidates dropped by radius/cap are never in `excluded` at all. | Add optional “why others were excluded” diagnostics with stage counts rather than claiming full transparency. `ResultsPanel.tsx:30`; `candidates.ts:81,99`. |
| 51 | P1 / Code | After a failed search sets data null, MapView returns early instead of removing the previous route source. Old route geometry can remain on the map while results are cleared. | Explicitly clear the route layer/source on null or failed search. `useRecommend.ts:30`; `MapView.tsx:45`. |
| 52 | P1 / Code | ErrorBoundary only handles React render/lifecycle failures. Mapbox asynchronous errors have no event handler/recovery UI; a bad token/style/network failure can leave an unusable map. | Handle map error/loading/context-loss states and provide an independent list experience. `MapView.tsx:27`; `App.tsx:51`. |
| 53 | P2 / Code | When selectedId becomes null, the selection effect returns before clearing marker rings/scale. The drawer can close while a marker remains visually selected. | Update highlight state even when nothing is selected. `MapView.tsx:110`. |
| 54 | P2 / Code | Route-drawing load callbacks have no effect cleanup. If route data changes before the style loads, obsolete callbacks can draw stale routes or run after teardown. | Remove old listeners and guard callbacks against obsolete requests/maps. `MapView.tsx:76`. |
| 55 | P2 / Code | GSAP result animations, Mapbox fly/fit animations, and Lenis scrolling do not check reduced-motion preferences. The CSS media query does not stop those JavaScript animations. | Respect reduced motion in each animation system and preserve ordinary native scrolling. `ResultsPanel.tsx:23`; `MapView.tsx:73,113`; `useLenis.ts:16`. |
| 56 | P3 / Code | Lenis initializes once against a stable ref. If ResultsPanel first renders the empty state, its wrapper is null; later non-empty results do not rerun the effect, so initialization is inconsistent. | Remove unnecessary custom scrolling or initialize against the actual mounted wrapper. `useLenis.ts:9,28`; `ResultsPanel.tsx:30`. |
| 57 | P2 / Gap | Every search requires a manually selected departure datetime; no leave-now default. Dates can be in the past, identical endpoints are accepted, and city users cannot choose below a 5-minute detour. | Offer leave-now/schedule, validate intent, and allow smaller detours for local trips. `SearchForm.tsx:25,29,84`. |
| 58 | P2 / Gap | No route swap, search reset, browser/URL search state, or shareable chosen journey. Reloading loses the current task. | Add the basic search lifecycle, with opt-in persistence appropriate to location data. `App.tsx`; `SearchForm.tsx`; `useRecommend.ts`. |

### Backend reliability, cost, data handling, and maintainability

| ID | Priority / evidence | Problem and consequence | Required change / source |
| --- | --- | --- | --- |
| 59 | P1 / Code | README says Supabase is optional, but its imported client throws on startup without URL/service-role credentials. Analytics is therefore a mandatory runtime dependency. | Make optional logging truly optional and test startup without it. `backend/src/db/supabaseClient.ts:6`; `README.md:22`. |
| 60 | P2 / Live + Code | `/api/restaurants` reads the old database while recommendations use live Search Box. It returned an empty list during this audit and is not a reliable way to inspect recommendations. | Remove/deprecate the old public endpoint or clearly separate curated records from live discovery/debug tools. `routes/restaurants.ts:7`; `routes/recommend.ts:42`. |
| 61 | P1 / Code | Seed SQL contains demo restaurant names and approximate locations; some rows are marked `road_access_verified=true` despite the file saying locations need adjustment. The “Closed-By-Evening” fixture also receives a dinner row from the general dinner insertion. | Isolate synthetic fixtures; do not expose them as verified real businesses. Correct contradictory fixtures. These rows are not used by the current live recommendation path. `backend/sql/003_seed.sql`. |
| 62 | P1 / Code | A public recommendation request can fan out to route, multiple search calls, and a large matrix. No rate limiting, concurrency budget, or daily provider allowance is implemented. CORS does not enforce quotas. | Add per-client and global request budgets with a hard free-tier ceiling and understandable quota responses. `backend/src/index.ts:12`; `recommend.ts:41`; `mapbox.ts`. |
| 63 | P1 / Code | Provider fetches have no explicit deadlines, retries for transient errors, or caller cancellation. One stalled call can leave the whole search loading indefinitely. | Abortable timeouts, bounded retries/backoff for retryable errors, and cancellation propagation. All fetches in `backend/src/services/mapbox.ts`; `frontend/src/lib/api.ts`. |
| 64 | P1 / Code | Every repeat search repeats provider work. No in-flight deduplication or source-aware cache exists, making free usage harder to sustain. | Cache only where permitted, keyed by provider/profile/route/time and freshness; deduplicate concurrent identical requests. `recommend.ts`; `mapbox.ts`. |
| 65 | P1 / Code | Raw upstream response bodies are included in errors returned to users; malformed JSON and provider-level error codes are not consistently classified. All pipeline errors become 502. | Structured error codes for bad input, no route, no coverage, rate limit, timeout, upstream failure, and internal error; keep provider diagnostics server-side. `mapbox.ts:26,64,124`; `recommend.ts:101`. |
| 66 | P2 / Code | Input schema checks coordinate ranges and basic types but not identical endpoints, geographic scope/coverage, extreme detour values, bounded cuisine text, or a sensible scheduling window. | Apply documented semantic constraints and useful field-level errors, avoiding arbitrary global bans. `recommend.ts:14`. |
| 67 | P1 / Code | Provider responses and frontend API results are TypeScript assertions, not runtime-validated contracts. Missing arrays, malformed hours, or invalid coordinates can abort the pipeline or render bad results. | Validate and normalize third-party/API data at boundaries; distinguish malformed records from total provider failure. `mapbox.ts:29,66,126`; `frontend/src/lib/api.ts:19`. |
| 68 | P2 / Code | Environment variables have no central validation. An unset frontend base URL becomes a request to an `undefined/...` path; map/search configuration fails inconsistently. | Validate enabled capabilities at startup/build, support a deliberate same-origin API default, and provide actionable setup diagnostics. `frontend/src/lib/api.ts:3`; `vite-env.d.ts`; `mapbox.ts:8`. |
| 69 | P1 / Code; deployment unverified | SQL creates location-history tables without RLS policies, role restrictions, or retention policy in the repository. Searches are logged without a user-facing explanation or opt-out. Actual deployed permissions were not inspected. | Define minimal data collection/retention and verify deployed grants/RLS; avoid storing precise endpoints unless necessary. `backend/sql/001_schema.sql`; `recommend.ts:63`. |
| 70 | P1 / Code + provider docs | Search-derived endpoint coordinates are inserted into persistent history while the provider documents temporary-use restrictions. The project has no source-specific retention rules. | Resolve permitted persistence with the chosen provider; disable unnecessary durable coordinate logging in the meantime. This is a provider-integration question, not a verified legal finding. `recommend.ts:66`; [Search Box restrictions](https://docs.mapbox.com/api/search/search-box/#search-box-api-restrictions-and-limits). |
| 71 | P2 / Code | Health checks only report process liveness; there are no per-stage counts, durations, coverage/failure metrics, provider quota metrics, or request IDs. Empty results are difficult to diagnose. | Add redacted structured diagnostics and separate liveness/readiness. `routes/health.ts`; `routes/recommend.ts`. |
| 72 | P1 / Code | No existing automated behavioural tests, provider fixtures, end-to-end tests, or CI were found. Builds and lint cannot catch the defects reproduced here. | Add targeted tests for endpoint identity, route coverage, road access, timezone/hours, unknown dietary data, and mobile search flow. Keep mocked tests separate from optional live provider benchmarks. |
| 73 | P2 / Build + Code | Frontend emits about 1.88MB minified Mapbox JS plus 405kB app JS, before CSS/assets; map is eagerly imported. Three/Vanta/@gsap-react and the frontend Supabase client have no application usage. | Lazy-load mapping when appropriate, remove unused dependencies/client/config, then measure slow-device performance. `frontend/package.json`; `App.tsx:4`; build output. Installed unused packages are not proof they are included in the bundle. |
| 74 | P2 / Code | Documentation and implementation disagree: optional database, 200m/400m, hours availability, supported coverage, stale RPC/seed comments, and a template frontend README. Frontend/backend response types are manually duplicated. Deployment/run instructions lack one reproducible validation path. | Update the active architecture/setup docs, share or generate API contracts, and document repeatable local/deployment verification. `README.md`; `frontend/README.md`; SQL; both `src/types/index.ts`; `.claude/launch.json`. |

## Free-service strategy worth benchmarking

Choose providers by measured Mumbai coverage and the fields the product needs, rather than by how many APIs can be connected. Additional providers often share the same underlying data, so adding two OpenStreetMap-derived feeds is not automatically twice the coverage.

| Role | Candidate | Free-use facts checked on 29 October 2026 | What remains to prove |
| --- | --- | --- | --- |
| Local address autocomplete and POIs | Geoapify | Free plan lists 3,000 credits/day and up to 5 requests/sec with attribution. Higher-result queries and matrices use variable credits. [Pricing](https://www.geoapify.com/pricing/) · [credit rules](https://www.geoapify.com/pricing-details/) | Kandivali/Borivali East/West and address precision, actual restaurant recall, details/hours availability, and credit cost for one full search. |
| Restaurant metadata/diet tags | Geoapify Places | OSM-derived places; supports vegetarian and vegetarian-only conditions where data exists. [Places documentation](https://apidocs.geoapify.com/docs/places/) | Sparse tags must remain unknown. No promise of comprehensive review ratings/photos or every popular Mumbai restaurant. |
| Independent search/routing comparison | TomTom | Current page lists monthly free allocations: 10K Suggest, 5K Details, 5K Discover, 20K Routing, and 2.5K Matrix; no credit card needed to start. Quota units and product-specific terms must be checked before integration. [Current pricing](https://docs.tomtom.com/pricing) | Coverage, access-point accuracy, permitted data combination/storage, and how each complete query consumes allowances. Do not rely on older daily-limit blog posts. |
| Routing | Existing Mapbox Directions/Matrix, or a benchmarked alternative above | Existing integration can be retained while replacing search. Matrix accepts selected sources/destinations; traffic profile has different coordinate limits. [Matrix documentation](https://docs.mapbox.com/api/navigation/matrix/) | Account's actual free balance and traffic availability were not inspected. Correct access and complete via-stop routing must be measured. |
| Map renderer | MapLibre GL JS, if it helps provider independence | Open-source renderer. Tiles/styles/hosting remain separate services with separate limits. [Project](https://maplibre.org/projects/gl-js/) | Map style compatibility, attribution, tile cost, and measured performance. Switching renderer alone does not improve restaurant data. |
| Route geometry | Small Turf modules | `nearestPointOnLine` supplies segment-aware nearest point/distance and route position. [Documentation](https://turfjs.org/docs/api/nearestPointOnLine) | Version-specific return fields and geographic edge cases; pin and test the installed version. |
| Better place-detail comparison, optional | Google Places | Has SKU-specific free usage caps within a billing-enabled pay-as-you-go service. It is not an unlimited free replacement. [Billing](https://developers.google.com/maps/billing-and-pricing/overview) | Only consider if a billing account is acceptable and enforceable quotas keep usage free. Places plotted on a map have Google-map requirements; do not simply add Google POIs to the current Mapbox map. [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) |

Do not use the public Nominatim server for type-ahead: its usage policy prohibits autocomplete. A hosted service with an appropriate plan or a separately operated instance is a different choice. [Public Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

Recommendation: first benchmark Geoapify and TomTom against the existing integration on a small, independently verified Mumbai dataset. Keep one primary and at most one justified fallback. Use nullable metadata and source attribution throughout. A free plan can support a bounded prototype; reliable unlimited traffic and comprehensive reviews/photos are not established by any of the sources above.

## Implementation order

### Pass 1: reliable inputs and honest results

- Fix selected text versus selected coordinates, preserve locality names, and implement accessible contextual search.
- Confirm exact endpoints on the map; support leave-now and a permission-triggered current location.
- Repair mobile results sizing.
- Remove geometric side as a hard access exclusion; stop claiming verified vegetarian/meal suitability from unknown data.
- Keep complete arrival timestamps and a restaurant timezone; correct future-opening labels.
- Make Supabase logging optional and define a minimal data policy.

Acceptance: a user can select and verify Kandivali West → Borivali East, edit either endpoint without stale coordinates, and view results on a phone. Unknown dietary/hours facts remain explicitly unknown.

### Pass 2: discovery that covers the actual journey

- Benchmark and choose the search/POI provider(s).
- Cover the entire route with overlapping adaptive queries and segment-aware geometry.
- Preserve candidate diversity, paginate/subdivide where needed, and batch routing instead of truncating to 23.
- Validate actual access and display a complete journey through a chosen stop.
- Add partial failure handling, deadlines, source-aware caching, and quota ceilings.

Acceptance: known eligible venues at the start, middle, and end of test routes can be retrieved; a single failed sample does not erase all valid results; the selected detour is visibly consistent with its ETA.

### Pass 3: restaurant decisions people can trust

- Add details, source links, location/address, contact/navigation actions, and quality signals where licensed and available.
- Distinguish pure veg from vegetarian options and unknown; separate meal-time suggestion from actual menu availability.
- Explain rank using access, exact extra time, relevant food evidence, reputation evidence, and uncertainty.
- Add supported cuisine/budget/stop-timing preferences and useful empty-state recovery.

Acceptance: users can understand why a stop is recommended, judge its evidence, and navigate to its actual entrance. No synthetic rating, invented menu, or fabricated restaurant detail is used to fill missing fields.

### Pass 4: repeatable release quality

- Add the targeted regression suite and responsive end-to-end checks.
- Add provider-cost/coverage diagnostics and a documented free usage budget.
- Remove dead code/dependencies, align shared contracts/docs, measure initial loading and map behaviour.
- Validate deployed configuration, database permissions, error recovery, and PWA installation on real phones.

## Benchmark and regression acceptance set

| Scenario | Required behaviour |
| --- | --- |
| Kandivali West → Borivali West; Kandivali West → Borivali East | Correct names, distinguishable endpoints, visibly correct start/destination, useful local results |
| Kandivali station entrance → Borivali station entrance | Route to the chosen access point, not a generic suburb centroid |
| Borivali/Borivli; East/West; Hindi/Marathi variants | Measure resolution quality; offer disambiguation rather than silently choose a different locality |
| Edit/clear selected origin or destination | Disable submission until coordinates match the newly selected value |
| 1km, 5km, 10km, 50km, and 250km routes | Measured discovery coverage at start/middle/end; no cap-induced missing tail |
| Restaurant on segment midpoint; repeated/looped road geometry | Correct point-to-line distance and robust route position/access checks |
| Legal right turn; divided highway; service road; railway/elevated-road barrier | Access based on routing evidence, with confidence and complete via geometry |
| Unknown dietary facts with strict vegetarian preference | No claim of confirmed vegetarian suitability |
| UTC versus India-time deployment; midnight, overnight, multi-day periods | Same correct India-local meal/hours decisions from the same arrival instant |
| 10-second stop in departure minute | No next-day rollover from formatting loss |
| Future departure | Expected-at-arrival wording, visible date, no unsupported traffic prediction |
| One failed category request; malformed response; timeout; quota exhaustion | Useful partial results or an accurate recoverable failure; no raw provider error dumped into UI |
| New search after previous success/failure | No stale coordinates, old route layer, or mismatched interactive results |
| 390×844, shorter phones, desktop, keyboard, reduced motion | Visible usable results, reachable controls, proper selection and motion handling |

Set quantitative recall and latency targets after collecting a real baseline. The four returned live restaurant names were not used as a ground-truth dataset, and this audit does not claim a provider is best before that comparison.
