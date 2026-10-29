-- WayDine schema: restaurants, opening_hours, search_history
-- Run in Supabase SQL editor (or via `supabase db push`).

create extension if not exists postgis;

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  geo_location geography(Point, 4326)
    generated always as (
      ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
    ) stored,
  highway_id text not null,
  side text check (side in ('left', 'right')),
  cuisine text,
  veg_available boolean default false,
  road_access_verified boolean default false
);

create index if not exists restaurants_geo_idx on restaurants using gist (geo_location);

create table if not exists opening_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  weekday int check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'snacks', 'dinner'))
);

create index if not exists opening_hours_restaurant_idx on opening_hours (restaurant_id);

create table if not exists search_history (
  id uuid primary key default gen_random_uuid(),
  source geography(Point, 4326),
  destination geography(Point, 4326),
  departure_time timestamptz,
  preferences jsonb,
  created_at timestamptz default now()
);
