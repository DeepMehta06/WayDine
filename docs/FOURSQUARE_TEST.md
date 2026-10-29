# Foursquare live test

Tested 29 October 2026, approximately 23:17 IST, against the current Places API. This was a direct provider smoke test, not an application integration change or an independent verification that every returned venue is operating.

## Result: key accepted, all three requests passed

| Request | HTTP | Results | Observed time |
| --- | --- | --- | --- |
| Food search near approximate Kandivali centre, 2.5km radius | 200 | 10, the requested limit | 515ms |
| Food search near approximate Borivali centre, 2.5km radius | 200 | 10, the requested limit | 322ms |
| Default-Pro details for Sarovar Restaurant | 200 | One place record | 513ms |

Times describe one run, not a latency benchmark. Search used `query=restaurant` and distance sorting; the query also matched bakeries, snack places, and other food categories. A production adapter should use the current category taxonomy for precise eligibility.

Kandivali examples included Sarovar Restaurant, Monginis Cake Shop, Hotel Lata, Jain Sweet and Bhelpuri House, Jumbo King, and Delicacy Veg Restaurant. Borivali examples included Kababchini, Sagar Dining Hall, Subway, and Raju's Kitchen. Names are provider-returned results, not endorsements or manually validated records.

## Data returned

Across the two searches (20 returned records, not an exhaustive locality inventory):

- All 20 had finite latitude/longitude values and category labels.
- 11 had phone fields; one had a website field.
- Addresses were available for many records, but some were empty or incomplete; do not assume all address components are reliable.
- Some categories explicitly included “Vegan and Vegetarian Restaurant”, useful as source evidence rather than an inferred dietary guarantee.
- Zero records contained hours, rating, rating statistics, price, photos, or attributes in these default-Pro responses. The details response did not add these fields either.

Foursquare documents hours, rating, popularity, price, photos, statistics, and attributes under Premium. Their absence in this test does not prove that Foursquare has no such data; those fields were deliberately not requested. [Response fields](https://docs.foursquare.com/fsq-developers-places/reference/response-fields).

## Configuration and integration findings

- The configured variable is misspelled `FOURSQAURE_API_KEY` in both backend and frontend environment files. The smoke test supports this spelling as an alias, as well as the preferred `FOURSQUARE_API_KEY` and `FSQ_API_KEY`.
- No credential values were printed or added to tracked files. Both environment files are Git-ignored.
- The current recommendation pipeline still imports the Mapbox restaurant-search adapter. Adding the key alone has not connected Foursquare to the app.
- The new API uses `https://places-api.foursquare.com`, `Authorization: Bearer ...`, and `X-Places-Api-Version: 2025-06-17`. Its current identifiers/coordinates are `fsq_place_id`, `latitude`, and `longitude`; use the current category IDs rather than blindly copying legacy examples. [Authentication](https://docs.foursquare.com/fsq-developers-places/reference/authentication) · [Search](https://docs.foursquare.com/fsq-developers-places/reference/place-search).

## Free-use implications

Exactly three requests were made. No Premium fields, photos endpoint, or tips endpoint was requested. Current published pricing gives 500 free Pro calls per month; Premium requests have a separate paid rate. The account's remaining monthly allowance and actual billing were not inspected, and response rate-limit headers should not be treated as confirmation of remaining free credit. [Current pricing](https://foursquare.com/pricing/) · [June 2026 pricing change](https://docs.foursquare.com/developer/reference/upcoming-changes).

Foursquare is worth evaluating as a restaurant discovery source alongside the existing Geoapify key. It does not establish a free source of ratings, hours, or photos for the planned ranking system. A production integration needs a request budget, source-aware deduplication, category filtering, closure/access checks, and honest nulls for unavailable fields.

## Repeatable test

From the project root:

```powershell
node backend/scripts/test-foursquare.mjs
```

This makes up to three additional live requests each time. It prints statuses, metadata coverage, and a few examples without credentials. Add `--verbose` to see the complete sanitized summary. It stops after a failed first request and does not automatically retry. JavaScript syntax validation passed using `node --check`.
