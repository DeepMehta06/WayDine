-- RPC used by backend/src/services/candidates.ts to run the 200m ST_DWithin filter
-- server-side (native GiST index) instead of pulling the whole table into the app.

create or replace function restaurants_near_route(route_wkt text, radius_m double precision)
returns table (
  id uuid,
  name text,
  latitude double precision,
  longitude double precision,
  highway_id text,
  side text,
  cuisine text,
  veg_available boolean,
  road_access_verified boolean,
  distance_from_road_m double precision
)
language sql
stable
as $$
  select
    r.id,
    r.name,
    r.latitude,
    r.longitude,
    r.highway_id,
    r.side,
    r.cuisine,
    r.veg_available,
    r.road_access_verified,
    ST_Distance(r.geo_location, ST_GeogFromText(route_wkt)) as distance_from_road_m
  from restaurants r
  where ST_DWithin(r.geo_location, ST_GeogFromText(route_wkt), radius_m);
$$;
