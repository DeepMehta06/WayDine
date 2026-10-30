-- Apply after 004_google_auth.sql and 005_user_preferences.sql.
-- Only user-selected labels, input preferences and application counts are saved.
begin;

create table if not exists public.trip_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  source_label text not null check (char_length(btrim(source_label)) between 1 and 120),
  destination_label text not null check (char_length(btrim(destination_label)) between 1 and 120),
  departure_time timestamptz not null,
  preferences jsonb not null check (jsonb_typeof(preferences) = 'object'),
  result_count integer not null check (result_count between 0 and 1000),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create index if not exists trip_history_owner_page_idx on public.trip_history(user_id, created_at desc, id desc);
alter table public.trip_history enable row level security;
revoke all on public.trip_history from anon, authenticated;
grant select on public.trip_history to authenticated;
grant all on public.trip_history to service_role;
drop policy if exists trip_history_read_own on public.trip_history;
create policy trip_history_read_own on public.trip_history for select to authenticated
using ((select auth.uid()) = user_id);

commit;
