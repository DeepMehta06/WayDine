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

1. **Supabase**: create a project, enable the `postgis` extension (Database →
   Extensions), then run `backend/sql/001_schema.sql`, `002_candidates_rpc.sql`,
   and `003_seed.sql` in the SQL editor, in that order.
2. **Mapbox**: create an access token at mapbox.com. The same token works for
   both the frontend (public, scoped to your domain before the demo) and the
   backend secret token (Directions + Matrix APIs).
3. Copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` →
   `frontend/.env`, fill in both from the values above. Never commit either `.env`.
4. Install and run:
   ```bash
   cd backend && npm install && npm run dev    # http://localhost:4000
   cd frontend && npm install && npm run dev   # http://localhost:5173
   ```

## Recommendation pipeline (`/api/recommend`)

1. **Route + 200m filter** — Mapbox Directions for the real route geometry,
   then a PostGIS `ST_DWithin` query for restaurants within 200m of it.
2. **Direction + side-of-road** — cross-product classification of each
   candidate against the local travel vector; restaurants requiring a U-turn
   are excluded, not just down-ranked.
3. **Candidate graph + Dijkstra** — real Mapbox driving-time edges between
   source, candidates, and destination; Dijkstra computes the true detour
   cost (ΔT), not straight-line distance.
4. **Time-aware meal filtering** — arrival time → meal type, checked against
   `opening_hours` (including rows that cross midnight).
5. **Exclude + rank** — hard exclusions first (wrong side, closed, over
   detour budget, preference mismatch), then weighted scoring: detour 45%,
   food match 30%, timing 15%, proximity 10%.

Excluded candidates are returned with reasons (`excluded[]`), not silently
dropped — that's what powers the no-results state honestly.
