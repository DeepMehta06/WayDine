# Google Places — backend integration

## Testing rule

The user is using Google's free allowance. **Ask for explicit approval before
every live Google Places request, or before a precisely bounded batch.** Adding
an API key is not approval to call it. This also applies to smoke tests,
recommendation requests and photo downloads. This rule is recorded in `AGENTS.md`.

No live Google Places calls were made while implementing this integration.
After implementation, the user approved exactly one basic Nearby Search call
on 30 October 2026: it returned HTTP 200 with one restaurant, a place ID and
coordinates. There were no detail/photo calls or retries. That call was recorded
in both application quota counters. Rich details remain mock-tested only.
Automated tests use injected mocked providers; their global fetch wrapper also
blocks accidental outbound requests to Google Places endpoints.

## Activation and limits

Add `GOOGLE_PLACES_API_KEY` to `backend/.env`. Key presence alone does not enable
Google requests. Leave `GOOGLE_PLACES_ENABLED=false` until deliberately testing
or using the Google-backed endpoints. Startup and status/health checks never
call Google.

Defaults (also listed in `backend/.env.example`):

| Setting | Default |
| --- | --- |
| `GOOGLE_PLACES_ENABLED` | `false` |
| `GOOGLE_PLACES_NEARBY_PER_DAY` | `20` |
| `GOOGLE_PLACES_DETAILS_PER_DAY` | `20` |
| `GOOGLE_PLACES_NEARBY_PER_MONTH` | `100` |
| `GOOGLE_PLACES_DETAILS_PER_MONTH` | `100` |
| `GOOGLE_PLACES_SEARCHES_PER_REQUEST` | `3` |
| `GOOGLE_PLACES_DETAILS_PER_REQUEST` | `3` |
| `GOOGLE_PLACES_CORRIDOR_M` | `200` |
| `GOOGLE_PLACES_QUOTA_FILE` | `.data/google-places-monthly.json` |

These are conservative **application request ceilings**, not a representation
of Google's free tier or a guarantee of zero charges. Google meters different
search/detail SKUs separately, and usage outside WayDine is not counted here.
Check the project's actual allowance and set corresponding Google Cloud quotas.

Nearby discovery uses an explicit Pro field mask with identity, location,
address, type, business status, listing link and attribution. Rich details use
Enterprise + Atmosphere fields, including dietary and meal-service information.
Field masks never use `*`. No AI summaries are requested.

Set any of `GOOGLE_PLACES_NEARBY_PER_DAY`, `GOOGLE_PLACES_DETAILS_PER_DAY`,
`GOOGLE_PLACES_NEARBY_PER_MONTH` or `GOOGLE_PLACES_DETAILS_PER_MONTH` to `null`
(or `none`) to disable that application limit. Numeric positive integers
re-enable the limits. Usage continues to be counted when a limit is disabled.
Status responses represent a disabled limit as `null`. Photo budgets and
per-request limits are configured separately.

All enabled daily and monthly budgets are checked before sending a request. Failed
requests count. There are **zero automatic Google retries**. Monthly budgets
are recorded separately from the existing daily quota file; both use
Asia/Kolkata boundaries. Deploy a single backend process for these file-based
counters, or replace them with a shared atomic quota store before scaling out.

## Backend endpoints

| Endpoint | Effect |
| --- | --- |
| `GET /api/google/status` | Reads local configuration only; no Google calls. |
| `POST /api/google/recommend` | Google discovery/details plus the existing Mapbox driving pipeline; requires login and explicit enablement. |
| `GET /api/google/restaurants/:placeId` | One rich Place Details lookup, including available reviews; requires login and explicit enablement. |

The recommendation request body contains source, destination, departure, an
optional route index and optional partial preference overrides. The authenticated
user's saved defaults fill omitted values. The response includes a
`preferenceContext` with effective values and whether a food budget is applied.
The existing public `/api/recommend` continues
to require explicit preferences. Google responses also include `google` provider
identifiers and restaurant details such as ratings, prices, meal flags, service
options, amenities, photo references and attribution.

Each recommendation request makes at most the configured nearby-search count
plus the configured detail-lookup count. With defaults, that is at most **three
Nearby Search calls and three Place Details calls**. A subsequent restaurant
detail request is an additional lookup. Matrix/Directions calls are separately
counted against the existing Mapbox budgets.

Requesting details does not download photos. The returned photo resource names,
dimensions and author attribution are metadata for a future photo integration.
No photo endpoint has been added, so image requests cannot happen implicitly.

The Google recommendation endpoint defaults to two requests per client per minute,
configured by `GOOGLE_RECOMMEND_PER_MINUTE`. Set it to `null` (or `none`) to disable
that limiter. `GOOGLE_ROUTES_PER_DAY` and `GOOGLE_ROUTE_MATRIX_ELEMENTS_PER_DAY`
also accept `null` (or `none`) to disable the application's daily routing ceilings.
Google's own quotas still apply. The
detail endpoint is limited to four lookups per account/client per minute. These
limits are in addition to the provider budgets. Concurrent identical details
share in-flight work; results are not cached for subsequent requests.

## Discovery and filtering

1. Obtain the selected baseline route using existing Mapbox Directions.
2. Distribute bounded search circles over the whole route, including its ends.
   The circles grow when the budget cannot support dense sampling. Reject
   routes needing a Google search radius above 50 km before spending Google
   requests.
3. Request Nearby Search (New) results, at most 20 per area. It has no page-token
   pagination. Report saturated/failed areas; never silently run extra searches.
4. Deduplicate by provider ID and conservative name/distance matching. Measure
   actual point-to-polyline distance and apply the 200 m corridor. Exclude
   listings marked temporarily or permanently closed.
5. Select a small shortlist distributed along the route. Retrieve rich details
   before applying dietary/cuisine/hours rules. Report candidates not evaluated
   because of the detail cap. Recheck corrected locations and business status.
6. Screen driving time and verify complete source → restaurant → destination
   routes using the existing curb-aware Matrix/Directions pipeline.
7. Check listed hours at the actual estimated arrival, enforce the user's detour
   limit, and return ranked stops with Google details and evidence explanations.

Directions requests include maneuver steps in the existing baseline and via-route
calls; no additional routing requests are made. `routeAssessment` reports local
geometric side/bearing, router-reported U-turns compared with the baseline,
possible backward progress sampled near the stop, and possible route divergence.
An unmatched U-turn adds a 90-second ranking penalty; possible backward travel
adds 120 seconds. Neither is a hard exclusion. Ambiguous or incomplete evidence
is unknown, and physical entrance, crossing safety, and median access are not
verified. Extra time compares the complete via journey to the selected baseline,
and may not describe a local detour if those routes diverge.

Ratings are exposed as data; this integration preserves the existing ranking
formula based on routed extra driving time and uncertainty penalties. It does
not introduce a fabricated quality/match score. At verified arrival, an explicit
negative lunch or dinner flag excludes that meal; breakfast is excluded only
when both breakfast and brunch are explicitly false. Snack and late-night
availability stays unknown when there is insufficient evidence. Missing flags
do not cause exclusion. `mealRecommendation.ideas` are general, unverified ideas
from the listed cuisine and the chosen cuisine preferences, not menu items the
restaurant is confirmed to serve. Saved budgets are compared with structured
INR price ranges as described in `USER_PREFERENCES.md`; missing or overlapping
ranges remain unconfirmed.

## Missing data and opening hours

- Missing optional fields become `null`/empty arrays; missing boolean values
  remain unknown rather than false.
- `servesVegetarianFood=true` means vegetarian **options**, not a pure-veg kitchen.
  Restaurant names, reviews and a vegetarian type tag never establish pure-veg
  status. Existing strict dietary preferences remain strict.
- Current opening periods take precedence for the seven local dates covered by
  Google's response. Outside that interval, regular weekly hours are used when
  supplied. Malformed/missing special periods are unknown; `openNow` is never
  substituted for opening status at a future arrival.
- Overnight/week-wrap periods and the listing's IANA timezone are supported;
  missing timezone falls back to Asia/Kolkata for this India-focused app.
- Google does not provide complete menus, exact dish inventory or guaranteed
  item-level pricing. Price ranges are restaurant-level estimates.
- Detail failures leave basic discovery data with `detailsStatus: unavailable`
  and warnings. Mandatory dietary rules still exclude unknown evidence unless
  the existing opt-in allows it.
- Coordinates do not prove a usable entrance. Real driving verification remains
  necessary. Entrances/navigation-points integration is deferred; the API uses
  listing coordinates and labels access uncertainty through the existing logic.

## Frontend and provider policies

The existing frontend and `/api/recommend` remain on the legacy pipeline, even
when a Google key is present or Google endpoints are enabled. This prevents
unexpected Google charges and prevents Google listings from being placed on
the current Mapbox map. No frontend source files were changed.

Before connecting a frontend to `/api/google/*`, implement Google Maps rendering
or an appropriately attributed map-free presentation. Preserve Google branding,
listing links, third-party/photo/review author attribution, and applicable
privacy/terms requirements. Do not store Google restaurant content, photos,
reviews or coordinates in the app database as a permanent catalogue. Save
permitted place IDs and user-owned preferences separately. No Google content
is persisted by this integration.

References:
[Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search),
[Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details),
[field tiers](https://developers.google.com/maps/documentation/places/web-service/data-fields),
[usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing),
[display/storage policies](https://developers.google.com/maps/documentation/places/web-service/policies).

## Validation

Run `npm run typecheck`, `npm test`, and `npm run build` from `backend/`.
Google tests cover normalization, booleans, attribution, missing data, current
and overnight hours, field masks, retry prevention, daily/monthly ceilings,
deduplication, corridor boundaries, enrichment limits, detour filtering,
authentication, partial failures and legacy API isolation. They use only mock
Google and routing responses. The approved live check verified only basic Nearby
Search access; it did not verify the rich detail field mask or full route flow.

A proposed first live check should be explicitly approved as **exactly one
Nearby Search (New) request with maxResultCount=1 and identity/location fields**.
Do not request Place Details, photos, route-wide discovery, or retry that check
without additional approval. Rich detail field masks should be live-verified
separately with the user's approval before relying on production availability.
