# Live API outputs — 30 October 2026

Test window: approximately 00:05–00:06 IST. Tests used the current saved backend code, configured credentials, and public Mumbai locality queries. Credentials were not printed. Application source was not changed.

## Validation results

| Check | Result |
| --- | --- |
| Backend tests | 87 passed across 6 test files |
| Backend typecheck | Passed |
| Backend production build | Passed |
| Frontend production build | Passed; large Mapbox bundle warning remains |
| Frontend lint | Exit 0, with 10 warnings (React refs/effects/purity and Fast Refresh exports) |
| Geoapify live requests | 11 requests, all HTTP 200 |
| Mapbox live requests | 53 requests, all HTTP 200 |
| Foursquare live requests | 3 default-Pro requests, all HTTP 200 |
| Current HTTP app readiness | HTTP 200, ready, no configuration problems reported |
| Identical endpoint validation | HTTP 400, BAD_REQUEST, “Your start and destination are the same place. Choose a different destination.” |

Initial test/build attempts encountered Windows sandbox worker/write restrictions. The reruns with the required filesystem/process permissions passed. This is separate from application correctness.

The API integration runner loaded the freshly built application on a temporary loopback port, retained its quota manager, disabled optional database search logging, and closed the temporary server afterwards. It did not replace or restart any existing development server. It used the app's configured keys and adapters rather than mocked provider responses. The 87 automated tests are a separate test layer and use provider fakes.

## Location outputs

All five HTTP suggestion requests returned 200, with both providers reported `ok` and `partial=false`.

| Input | Returned leading matches |
| --- | --- |
| Kandivali West | **Kandiwali West**, Mumbai locality from Mapbox; Kandivali (West), a Geoapify POI |
| Borivali East | **Borivali East**, Mumbai locality from Mapbox; Borivali Station (East), a Geoapify POI |
| Borivli | **Borivali East**, suburb from Geoapify; **Borivali West**, locality from Mapbox |
| Andheri East | **Andheri East**, Mumbai locality from Mapbox |
| बोरीवली | **Borivali East**, Mumbai suburb from Geoapify; बोरीवली from Mapbox |

This improves on the earlier UI observation where selecting a suburb replaced its name with “Mumbai, [postcode], India”. The current API sends a separate name, secondary context, place kind, source, and coordinates. The UI editing flow was not retested in this run.

Remaining ambiguity: some lower-ranked Borivli/Devanagari results refer to Khopoli or Kamshet. A successful HTTP response does not mean every suggestion is relevant. Exact endpoint confirmation still matters.

## Direct Geoapify food results

These are 1km searches around approximate public suburb centres, with the current application adapter and a page limit of 20. They are separate from the route-corridor counts below.

| Area | Records accepted by adapter | Records rejected by adapter | With hours | With phone | With dietary evidence |
| --- | --- | --- | --- | --- | --- |
| Kandivali | 12 | 4 | 5 | 1 | 1 |
| Borivali | 7 | 1 | 4 | 0 | 4 |

Example returned names: Delicasy, cafe ameyzing, Growels, jinus corner, Lochlainn Cafe, Domino's, Harbhole Kutchi Dabeli, Dwarka Restaurant, Simply Saraswat. These are provider-returned listings, not independently verified recommendations.

The adapter currently reports rejected records as malformed. Their exact rejection reasons were not investigated here; they may represent missing optional metadata or a strict schema, not necessarily unusable businesses. Raw results also contained repeated names, so direct page counts are not unique-venue counts.

## Full route: Kandivali West → Borivali East

Both tests used locality suggestions resolved by the current app, any diet, no cuisine restriction, a 15-minute extra-driving allowance, and route option 0.

- Selected source name: **Kandiwali West** (provider spelling).
- Destination: **Borivali East**.
- Baseline route: **3.57km, 13.4 minutes**.
- Two route options returned.
- Every listed detour below was checked through the current complete via-stop routing stage.
- Times are driving estimates with `mapbox/driving`, not traffic-aware forecasts. Food/service time is not included.

### Leave now, approximately 00:05 IST

HTTP 200 in 4.45 seconds. Five stops returned:

| Stop | Extra driving, minutes | Listed hours at estimated arrival |
| --- | --- | --- |
| Foo Borivali | 1.52 | Open |
| Olive Café & Bar, Borivali | 1.52 | Open; closing about 41 minutes after arrival |
| McDonald's | 1.65 | Open |
| Hangout Cakes and Gourmet Foods | 1.68 | Open; closing about 16 minutes after arrival |
| Garden Groves Family Restaurant and Bar/Banquets | 1.73 | Open; closing about 17 minutes after arrival |

All five had unknown dietary evidence. “Open” is a provider-hours calculation for arrival, not independent confirmation that the business will serve the user. The test surfaced 82 hours exclusions across discovery/precheck/final checks.

### Scheduled 30 October at 12:00 IST

HTTP 200 in 0.82 seconds within the same test process. Geoapify data was reusable from that process's cache, so this is not an independent cold-search latency measurement. Eight stops returned:

| Rank | Stop | Extra driving, minutes | Dietary evidence | Listed hours at arrival |
| --- | --- | --- | --- | --- |
| 1 | Radha Restaurant & Banquets | 1.00 | Unknown | Open |
| 2 | Foo Borivali | 1.52 | Unknown | Open |
| 3 | McDonald's | 1.65 | Unknown | Open |
| 4 | Rabdi Wala, Borivali (W) | 1.68 | Unknown | Open |
| 5 | The Belgian Waffle Co | 1.68 | Unknown | Open |
| 6 | Hangout Cakes and Gourmet Foods | 1.68 | Unknown | Open |
| 7 | Garden Groves Family Restaurant and Bar/Banquets | 1.73 | Unknown | Open |
| 8 | Annalaya Udupi Cafe | 2.68 | Vegetarian options, sourced via Geoapify/OSM | Open |

The first seven were supplied by Mapbox, with McDonald's merged with a Geoapify listing. Annalaya Udupi Cafe came from Geoapify. The test did not request strict vegetarian filtering, and unknown entries are not claims of vegetarian suitability.

### Discovery diagnostics and limits

Both route tests reported:

- Three search areas, zero failed areas, all three still saturated after the bounded refinement stage.
- 81 accepted Geoapify records and 275 accepted Mapbox records across all search pages/areas. These include repeated listings and are not distinct business counts.
- **255 merged candidates; 208 within the 1.5km corridor**.
- 11 records rejected by provider parsing.
- 46 candidates screened by Matrix; eight complete via-stop routes verified per test.
- 121 additional eligible places were not checked in detail for the midnight trip; 183 for lunch.

The app correctly emitted warnings about busy stretches and its verification budget. The returned eight lunch stops are a bounded shortlist, not an exhaustive ranking of all restaurants along the route. No quality ratings or review-count comparison was established.

## Foursquare outputs

The existing smoke script was rerun once, making exactly three requests without Premium fields:

| Request | Result | Observed time |
| --- | --- | --- |
| Kandivali restaurant query | HTTP 200; 10 returned, the requested limit | 700ms |
| Borivali restaurant query | HTTP 200; 10 returned, the requested limit | 189ms |
| Sarovar Restaurant details | HTTP 200 | 661ms |

Kandivali examples: **Sarovar Restaurant**, **Monginis Cake Shop**, **Hotel Lata**, **Jain Sweet and Bhelpuri House**.

Borivali examples: **Gora Gandhi Juice Corner and Veg World - Pure Veg**, **JumboKing**, **Raju's Chinese Truck**, **Kababchini**. A dietary claim in a listing's name alone is not verified dietary evidence.

Across the 20 search results, 11 phone fields and one website field were present. Ratings, hours, photos, prices, and attributes were absent from these default-Pro responses. This field coverage is effectively unchanged from the previous smoke test. No Premium data or account billing was tested.

**Foursquare is still separate from the recommendation pipeline.** The app's provider context, discovery service, and shared API contract currently use Geoapify and Mapbox only. A working Foursquare credential does not by itself add its venues to the eight route recommendations above. The environment variable remains spelled `FOURSQAURE_API_KEY`; the smoke script supports that alias.

## Material findings still visible in this run

1. Locality suggestions and full route outputs now work for the requested short Mumbai trip.
2. The broad old side-of-road exclusion is replaced by routed stop verification in the current pipeline.
3. Result sets change with arrival time and expose unknown dietary facts rather than asserting them.
4. Discovery is still incomplete in busy areas, and the eight-stop verification cap can omit useful venues.
5. Some address suggestions remain geographically irrelevant; some provider food records are dropped by parsing.
6. Restaurant quality/reputation evidence remains absent from these tested results.
7. Foursquare integration, UI/mobile behaviour, strict-diet flows, deployed database permissions, and all 74 audit items were not comprehensively reverified by this API test.

## Output files and rerun commands

- [Current API metrics](LIVE_API_TEST_METRICS_2026-10-30.json): statuses, counts, diagnostics, timings, and upstream call counts; deliberately omits Mapbox place records/route coordinates.
- [Foursquare output](FOURSQUARE_OUTPUT_2026-10-30.json): sanitized statuses, coverage, and sample venues.
- [Live integration runner](../backend/scripts/test-live-apis.mjs): exercises current HTTP endpoints and provider adapters; compile backend first.

```powershell
node backend/scripts/test-live-apis.mjs
node backend/scripts/test-foursquare.mjs
```

These commands make additional live provider calls. They use credentials from `backend/.env` and never print their values. The integration runner has a 120-request upstream ceiling, uses the existing backend quota-state file, and performs both live-now and next-lunch route tests. This run used 64 upstream calls through that runner plus the three separate Foursquare calls. Existing account-wide free usage balances were not inspected.
