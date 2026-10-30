-- Apply after 004_google_auth.sql. Adds preferences without deleting existing data.
begin;

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  diet text not null default 'any' check (diet in ('any', 'vegetarian-options', 'pure-veg')),
  cuisines text[] not null default '{}'::text[] check (
    cuisines <@ array['north indian','south indian','maharashtrian','gujarati','chinese','pizza','burger','biryani','seafood','cafe','bakery','dessert','street food']::text[]
    and cardinality(cuisines) <= 13 and array_position(cuisines, null) is null
  ),
  include_unconfirmed_diet boolean not null default false,
  max_detour_minutes integer not null default 10 check (max_detour_minutes between 1 and 60),
  budget_per_person_inr integer check (budget_per_person_inr between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
    and tablename = 'user_preferences' and policyname = 'user_preferences_read_own') then
    create policy user_preferences_read_own on public.user_preferences
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end;
$$;

-- Service-role-only atomic partial update. Unspecified fields survive concurrent
-- updates; there is no application-side read/merge/write race.
create or replace function public.waydine_patch_preferences(p_user_id uuid, p_patch jsonb)
returns setof public.user_preferences
language plpgsql security invoker set search_path = '' as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'A nonempty preferences object is required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) as fields(key)
    where key not in ('diet','cuisines','includeUnconfirmedDiet','maxDetourMinutes','budgetPerPersonInr')) then
    raise exception 'Unknown preference field' using errcode = '22023';
  end if;
  if (p_patch ? 'diet' and jsonb_typeof(p_patch->'diet') <> 'string')
    or (p_patch ? 'cuisines' and jsonb_typeof(p_patch->'cuisines') <> 'array')
    or (p_patch ? 'includeUnconfirmedDiet' and jsonb_typeof(p_patch->'includeUnconfirmedDiet') <> 'boolean')
    or (p_patch ? 'maxDetourMinutes' and jsonb_typeof(p_patch->'maxDetourMinutes') <> 'number')
    or (p_patch ? 'budgetPerPersonInr' and jsonb_typeof(p_patch->'budgetPerPersonInr') not in ('number','null')) then
    raise exception 'Invalid preference type' using errcode = '22023';
  end if;

  return query
  insert into public.user_preferences as existing (user_id, diet, cuisines,
    include_unconfirmed_diet, max_detour_minutes, budget_per_person_inr)
  values (
    p_user_id,
    coalesce(p_patch->>'diet', 'any'),
    case when p_patch ? 'cuisines' then array(select jsonb_array_elements_text(p_patch->'cuisines')) else '{}'::text[] end,
    coalesce((p_patch->>'includeUnconfirmedDiet')::boolean, false),
    coalesce((p_patch->>'maxDetourMinutes')::integer, 10),
    (p_patch->>'budgetPerPersonInr')::integer
  )
  on conflict (user_id) do update set
    diet = case when p_patch ? 'diet' then excluded.diet else existing.diet end,
    cuisines = case when p_patch ? 'cuisines' then excluded.cuisines else existing.cuisines end,
    include_unconfirmed_diet = case when p_patch ? 'includeUnconfirmedDiet' then excluded.include_unconfirmed_diet else existing.include_unconfirmed_diet end,
    max_detour_minutes = case when p_patch ? 'maxDetourMinutes' then excluded.max_detour_minutes else existing.max_detour_minutes end,
    budget_per_person_inr = case when p_patch ? 'budgetPerPersonInr' then excluded.budget_per_person_inr else existing.budget_per_person_inr end,
    updated_at = now()
  returning existing.*;
end;
$$;

revoke all on function public.waydine_patch_preferences(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.waydine_patch_preferences(uuid,jsonb) to service_role;

commit;
