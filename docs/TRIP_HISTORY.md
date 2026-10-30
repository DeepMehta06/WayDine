# Account trip history

Signed-in users can access `/history` from the header or account menu. The profile
shows the three most recent trips and links to the full list. History survives
refreshes and device changes because the summaries are stored in Supabase against
the authenticated account.

## Database setup

Apply [006_trip_history.sql](../backend/sql/006_trip_history.sql) in the existing
Supabase project's SQL editor, after migrations 004 and 005. The migration creates
an account-owned table, a stable pagination index, an idempotency constraint,
row-level security and an own-row read policy. Direct client writes are revoked;
the backend's existing service-role connection performs writes and deletes using
the server-verified account ID. No new environment variables are required.

The migration must be applied separately to the deployed database. Automated
checks use mocked storage; they do not verify production grants or apply SQL.

## What is saved

A successful authenticated recommendation request with `tripLabels` records:

- The user-selected origin and destination labels.
- When the plan was saved and its departure instant, displayed in IST.
- The effective dietary, cuisine, extra-driving and per-person budget preferences.
- The number of stops returned, including zero for successful empty searches.
- An account-scoped request identifier to prevent retry duplicates.

These are trip plans/searches, not evidence of a completed journey. The history
does not save coordinates, route geometry, restaurant records, ratings, reviews,
photos or provider tokens. Old searches that were never saved cannot be recovered.
There is no browser-storage fallback that could mix accounts on shared devices.

Recommendation errors and requests cancelled before results are produced are not saved. If history storage
is unavailable, recommendations still return and the results page explicitly
says the trip could not be saved. A missing migration therefore does not turn a
successful restaurant search into a failed search.

## Reading, reusing and removing trips

The full list uses newest-first keyset pagination (20 entries per page; maximum
API page size 50). Equal timestamps are ordered by record ID. The profile uses
the same endpoint with a three-entry limit.

**Plan a similar trip** restores the route labels and saved preference snapshot
into the planning form, resets departure to now, and requires the user to choose
and confirm both endpoints again. It does not silently rerun recommendations,
load restaurant details or download photos. History reading itself makes no
Google Places or routing requests.

Users can remove individual summaries or clear their own history after an inline
confirmation. These deletions are permanent. Deleting an account profile cascades
to its history. Changing signed-in accounts remounts trip state and history UI so
one account does not retain another account's in-memory results.

## API

| Endpoint | Behavior |
| --- | --- |
| `GET /api/me/trips?limit=20&cursor=...` | Authenticated owner's summaries and nullable `nextCursor`. No provider calls. |
| `DELETE /api/me/trips/:id` | Remove only the authenticated owner's matching row. Returns 204; does not reveal whether a different owner has that ID. |
| `DELETE /api/me/trips` | Clear only the authenticated owner's summaries. Returns 204. |

Reads are limited to 60 per minute per client and deletions to 20 per minute per
account. Responses are `no-store`; mutations require the existing trusted-Origin
CSRF check. Request JSON and query parameters never select an owner. Invalid
IDs/cursors/pages return 400; unauthenticated reads and deletes return 401.

`POST /api/google/recommend` accepts optional labels alongside its existing inputs:

```json
{
  "tripLabels": { "source": "Kandivali West", "destination": "Borivali East" }
}
```

The rest of the recommendation request is unchanged. The authenticated backend
records the effective preferences and result count after success, not values
asserted by a separate client-created history record. The response includes
`history: { saved: true }` or `history: { saved: false }` when labels were supplied.
Existing clients without labels remain compatible and do not create summaries.

## Verification

Backend tests cover account isolation, authentication and CSRF, storage query
ownership, cursor validation and tied timestamps, idempotent recording, empty
searches, failure handling and the absence of provider work during history reads.
Frontend tests cover loading, empty/error states, confirmation, delete responses,
pagination, preference/date rendering and safe replanning. All provider responses
are mocked; live Google Places requests require separate explicit approval.

After applying migration 006, verify with two real test accounts that each account
sees and deletes only its own plans, then check persistence after a browser refresh.
