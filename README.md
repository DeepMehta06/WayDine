# WayDine

Eat on the way, not out of the way. Finds restaurants actually on your driving
route — real road distance, direction of travel, and meal timing — instead of
anything just nearby.

Full build plan: [WayDine-Build-Plan.pdf](WayDine-Build-Plan.pdf) (tech stack, schema, pipeline, execution plan).

## Structure

```
backend/   Express + TypeScript API (/api/recommend, /api/restaurants, /api/health)
frontend/  React + Vite + TypeScript PWA (Tailwind, shadcn/ui, Mapbox GL)
```

## Setup

1. **Mapbox**: create an access token at mapbox.com with Directions, Matrix,
   and Search Box API access. The same token works for both the frontend
   (public, scoped to your domain before the demo) and the backend secret
   token (Directions + Matrix + Search Box APIs).
2. **Supabase** (optional): only used to log `search_history` for analytics —
   not required for recommendations to work. If you want it, create a project
   and run `backend/sql/001_schema.sql` in the SQL editor for the
   `search_history` table. (`002_candidates_rpc.sql` and `003_seed.sql` are
   leftover from an earlier curated-DB design — see "Restaurant data source"
   below — and aren't needed.)
3. Copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` →
   `frontend/.env`, fill in both from the values above. Never commit either `.env`.
4. Install and run:
   ```bash
   cd backend && npm install && npm run dev    # http://localhost:4000
   cd frontend && npm install && npm run dev   # http://localhost:5173
   ```

## Restaurant data source

Restaurants are sourced **live** from Mapbox's Search Box category API, queried
at points sampled every ~15km along the route (up to 8 samples, capped at 23
total candidates — the Mapbox Matrix API's per-request limit minus source and
destination). This works for any route in India without manual seeding, unlike
an earlier version of this project that relied on a hand-curated Supabase
table covering only one highway corridor.

The tradeoff: live POI data doesn't reliably carry cuisine tags or vegetarian
flags for small highway restaurants (Mapbox's categories are coarse, e.g.
"indian restaurant" rather than a dietary tag). Opening hours, however, Mapbox
*does* provide via `metadata.open_hours` on most results — parsed back into
real `isOpenAt()` checks, same as the original curated-DB design. Where a
specific place has no hours data, the pipeline treats it as **unknown, not
negative**: not excluded, not boosted either (`openAtArrival: null`, shown as
"hours unconfirmed" rather than guessed).

(Evaluated Geoapify's Places API as an alternative — slightly better cuisine
tags, but fewer results per area and no clear win over Mapbox once the hours
metadata above was wired in, so stuck with one provider.)

## Recommendation pipeline (`/api/recommend`)

1. **Route + live restaurant search** — Mapbox Directions for the real route
   geometry, then Mapbox Search Box category search at sampled points along
   it, filtered to within 400m of the route (haversine distance to the
   nearest polyline point; wider than a curated-DB radius since live
   coordinates are less precise).
2. **Direction + side-of-road** — cross-product classification of each
   candidate against the local travel vector; restaurants requiring a U-turn
   are excluded, not just down-ranked.
3. **Candidate graph + Dijkstra** — real Mapbox driving-time edges between
   source, candidates, and destination; Dijkstra computes the true detour
   cost (ΔT), not straight-line distance.
4. **Time-aware meal recommendation** — arrival time → recommended meal type
   (breakfast/lunch/snacks/dinner, including the overnight wraparound).
5. **Exclude + rank** — hard exclusions first (wrong side, over detour
   budget, confirmed non-veg when vegetarian-only is set), then weighted
   scoring: detour 45%, food match 30%, timing 15%, proximity 10%.

Excluded candidates are returned with reasons (`excluded[]`), not silently
dropped — that's what powers the no-results state honestly.
