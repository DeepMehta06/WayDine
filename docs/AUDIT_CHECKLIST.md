# Audit remediation checklist

Tracks every finding in [PROJECT_AUDIT.md](PROJECT_AUDIT.md). Status is one of
`pending`, `in progress`, `fixed`, `blocked`. A finding is only `fixed` when the
evidence column names a check that exercises the behaviour, not a wording change.

Type, from the audit's own evidence labels:

- **Bug**: confirmed defect (Live, Code, or Reproduced evidence).
- **Capability**: proposed product capability (Gap evidence), not an original defect.
- **Provider**: coverage or terms risk that needed a measured decision.

## Provider decision record (measured 29–30 Oct 2026)

Benchmark scripts were run against live APIs with keys read from `backend/.env`.

| Query / test | Geoapify autocomplete | Mapbox Geocoding v6 | Mapbox Search Box suggest (previous) |
| --- | --- | --- | --- |
| Kandivali West | Suburb, ranked 1st | Locality "Kandiwali West", 2nd | Only shops/POIs, no locality |
| Kandivali | Kandivali East + West suburbs | — | POIs only |
| Borivali East | Suburb, 1st | Locality, 1st | Locality, 1st |
| Borivali | Only East (West missing) | East + West localities | East + West |
| Borivli (alias) | Station/POIs only | East + West localities | POIs only |
| Andheri East | **Andheri, Punjab** (wrong state) | Locality in Mumbai, 1st | Locality |
| बोरीवली (Devanagari) | Unrelated "Barwala" towns | Borivali place (Maharashtra) + other Borivali villages | Mixed |

Restaurant data, 1km around three Kandivali W → Borivali E corridor points:

| Point | Geoapify Places (≤20) | Mapbox category (≤25) | Exact-name overlap |
| --- | --- | --- | --- |
| Kandivali W | 17 results; 11 hours, 5 phone, 12 cuisine, 5 `diet:vegetarian` | 25 (saturated); 25 hours, 25 phone, 12 web, 25 routable points | 0 |
| Midpoint | 6; 4 hours, 6 cuisine, 3 diet | 25 (saturated); 24 hours, 25 phone | 0 |
| Borivali E | 3; 2 hours, 3 cuisine, 1 diet | 25 (saturated); 25 hours, 25 phone | 0 |

Neither source returned ratings or reviews.

Free-tier facts checked from provider pages on 30 Oct 2026:

- Geoapify: 3,000 credits/day; autocomplete/reverse = 1 credit; Places ≤20 results = 1 credit. Terms: OpenStreetMap and Geoapify attribution mandatory on the free plan; no caching restriction.
- Mapbox: Search Box 500 sessions/month or 25,000 requests/month; Temporary Geocoding 100,000 requests/month ("temporary results are not allowed to be cached"); Directions 100,000 requests/month; Matrix 100,000 elements/month; GL JS 50,000 map loads/month. Search Box officially supports only the US, Canada and Europe; results are for temporary use.

Decision:

- **Location search:** merge Geoapify autocomplete (documented worldwide OSM coverage) with Mapbox Geocoding v6. Each fixes measured failures of the other. Mapbox Search Box sessions are dropped (500/month is not sustainable for typeahead).
- **Restaurants:** Geoapify Places as the documented-coverage source plus Mapbox category search as a measured supplementary source (undocumented India coverage, but the only source of routable access points and near-complete hours). Merged with conservative deduplication.
- **Routing:** Mapbox Directions and Matrix, with `approaches=curb` as access evidence.
- **Caching:** Geoapify responses only; Mapbox responses are never cached (in-flight deduplication only).

## Findings

| ID | Type | Status | Evidence |
| --- | --- | --- | --- |
| 01 | Provider | pending | |
| 02 | Bug | pending | |
| 03 | Bug | pending | |
| 04 | Bug | pending | |
| 05 | Bug | pending | |
| 06 | Capability | pending | |
| 07 | Capability | pending | |
| 08 | Bug | pending | |
| 09 | Bug | pending | |
| 10 | Bug | pending | |
| 11 | Capability | pending | |
| 12 | Bug | pending | |
| 13 | Bug | pending | |
| 14 | Bug | pending | |
| 15 | Capability | pending | |
| 16 | Bug | pending | |
| 17 | Bug | pending | |
| 18 | Bug | pending | |
| 19 | Bug | pending | |
| 20 | Bug | pending | |
| 21 | Bug | pending | |
| 22 | Bug | pending | |
| 23 | Bug | pending | |
| 24 | Bug | pending | |
| 25 | Bug | pending | |
| 26 | Bug | pending | |
| 27 | Capability | pending | |
| 28 | Bug | pending | |
| 29 | Bug | pending | |
| 30 | Bug | pending | |
| 31 | Bug | pending | |
| 32 | Bug | pending | |
| 33 | Bug | pending | |
| 34 | Bug | pending | |
| 35 | Bug | pending | |
| 36 | Bug | pending | |
| 37 | Bug | pending | |
| 38 | Bug | pending | |
| 39 | Bug | pending | |
| 40 | Bug | pending | |
| 41 | Bug | pending | |
| 42 | Bug | pending | |
| 43 | Bug | pending | |
| 44 | Bug | pending | |
| 45 | Capability | pending | |
| 46 | Capability | pending | |
| 47 | Capability | pending | |
| 48 | Bug | pending | |
| 49 | Bug | pending | |
| 50 | Bug | pending | |
| 51 | Bug | pending | |
| 52 | Bug | pending | |
| 53 | Bug | pending | |
| 54 | Bug | pending | |
| 55 | Bug | pending | |
| 56 | Bug | pending | |
| 57 | Capability | pending | |
| 58 | Capability | pending | |
| 59 | Bug | pending | |
| 60 | Bug | pending | |
| 61 | Bug | pending | |
| 62 | Bug | pending | |
| 63 | Bug | pending | |
| 64 | Bug | pending | |
| 65 | Bug | pending | |
| 66 | Bug | pending | |
| 67 | Bug | pending | |
| 68 | Bug | pending | |
| 69 | Bug | pending | |
| 70 | Bug | pending | |
| 71 | Bug | pending | |
| 72 | Bug | pending | |
| 73 | Bug | pending | |
| 74 | Bug | pending | |
