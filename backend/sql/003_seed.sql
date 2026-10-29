-- Seed data: Mumbai-Pune corridor (NH48), mixed left/right side, varied hours.
-- Includes deliberately excluded cases: one closed at a typical arrival time,
-- and one placed >200m from the highway so the filter visibly excludes it.
-- NOTE: coordinates are approximate waypoints along the corridor, not surveyed
-- against the live Mapbox route. Before the demo, run GET /api/restaurants,
-- overlay on the actual rendered route, and nudge any rows that land on the
-- wrong side of the 200m line (especially "Far From Road Resort Cafe").

insert into restaurants (name, latitude, longitude, highway_id, side, cuisine, veg_available, road_access_verified)
values
  ('Highway Spice Kitchen', 18.9894, 73.1175, 'NH48-mumbai-pune', 'right', 'north indian', true, true),
  ('Khandala Ghat Dhaba', 18.7607, 73.3799, 'NH48-mumbai-pune', 'left', 'maharashtrian', true, true),
  ('Lonavala Chikki & Cafe', 18.7500, 73.4050, 'NH48-mumbai-pune', 'right', 'snacks', true, true),
  ('Expressway Family Restaurant', 18.8537, 73.2497, 'NH48-mumbai-pune', 'left', 'multi-cuisine', true, true),
  ('Midnight Biryani Point', 18.6500, 73.5800, 'NH48-mumbai-pune', 'right', 'biryani', false, true),
  ('Green Leaf Pure Veg', 18.6000, 73.6400, 'NH48-mumbai-pune', 'left', 'south indian', true, true),
  ('Roadside Punjabi Dhaba', 18.5800, 73.6700, 'NH48-mumbai-pune', 'right', 'punjabi', true, true),
  ('Truckers Tandoor', 18.9200, 73.1500, 'NH48-mumbai-pune', 'left', 'tandoor', false, true),
  ('Sunrise Breakfast Hub', 18.9700, 73.1300, 'NH48-mumbai-pune', 'right', 'breakfast', true, true),
  ('Ghat Section Tea Stall', 18.7700, 73.3600, 'NH48-mumbai-pune', 'left', 'snacks', true, false),
  ('Closed-By-Evening Thali House', 18.8200, 73.2800, 'NH48-mumbai-pune', 'right', 'thali', true, true),
  ('Far From Road Resort Cafe', 18.7000, 73.4500, 'NH48-mumbai-pune', 'left', 'continental', true, true),
  ('U-Turn Required Dhaba', 18.6800, 73.5200, 'NH48-mumbai-pune', 'left', 'maharashtrian', true, true),
  ('Night Owl Dhaba', 18.6200, 73.6100, 'NH48-mumbai-pune', 'right', 'north indian', false, true),
  ('Early Bird Idli Corner', 18.9500, 73.1400, 'NH48-mumbai-pune', 'right', 'south indian', true, true);

-- Opening hours: all days (0-6), with one restaurant deliberately closed by typical arrival time.
insert into opening_hours (restaurant_id, weekday, opens_at, closes_at, meal_type)
select r.id, w.weekday, '07:00', '11:00', 'breakfast'
from restaurants r, generate_series(0, 6) as w(weekday)
where r.name in ('Sunrise Breakfast Hub', 'Early Bird Idli Corner');

insert into opening_hours (restaurant_id, weekday, opens_at, closes_at, meal_type)
select r.id, w.weekday, '11:30', '15:30', 'lunch'
from restaurants r, generate_series(0, 6) as w(weekday)
where r.name not in ('Midnight Biryani Point', 'Night Owl Dhaba', 'Closed-By-Evening Thali House');

insert into opening_hours (restaurant_id, weekday, opens_at, closes_at, meal_type)
select r.id, w.weekday, '16:00', '19:00', 'snacks'
from restaurants r, generate_series(0, 6) as w(weekday)
where r.name in ('Lonavala Chikki & Cafe', 'Ghat Section Tea Stall', 'Expressway Family Restaurant');

insert into opening_hours (restaurant_id, weekday, opens_at, closes_at, meal_type)
select r.id, w.weekday, '19:00', '23:00', 'dinner'
from restaurants r, generate_series(0, 6) as w(weekday)
where r.name not in ('Sunrise Breakfast Hub', 'Early Bird Idli Corner');

-- Closed-By-Evening Thali House: lunch only, closes at 15:30, nothing after -> demonstrates
-- the "closed at expected arrival time" exclusion reason for evening searches.
insert into opening_hours (restaurant_id, weekday, opens_at, closes_at, meal_type)
select r.id, w.weekday, '11:00', '15:30', 'lunch'
from restaurants r, generate_series(0, 6) as w(weekday)
where r.name = 'Closed-By-Evening Thali House';

-- Midnight Biryani Point / Night Owl Dhaba: dinner into late night only.
insert into opening_hours (restaurant_id, weekday, opens_at, closes_at, meal_type)
select r.id, w.weekday, '20:00', '02:00', 'dinner'
from restaurants r, generate_series(0, 6) as w(weekday)
where r.name in ('Midnight Biryani Point', 'Night Owl Dhaba');
