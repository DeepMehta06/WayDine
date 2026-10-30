-- Apply in the existing Supabase project's SQL editor. No PostGIS dependency.
-- Supabase Auth owns Google identities; this application never stores passwords.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  provider text not null default 'google' check (provider = 'google'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create or replace function public.waydine_touch_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists waydine_profile_updated on public.profiles;
create trigger waydine_profile_updated before update on public.profiles
for each row execute function public.waydine_touch_profile();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);
-- Profile writes are performed only by the verified backend login flow.

create table if not exists public.auth_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  access_expires_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user_idx on public.auth_sessions(user_id);
create index if not exists auth_sessions_expiry_idx on public.auth_sessions(expires_at);
alter table public.auth_sessions enable row level security;
revoke all on public.auth_sessions from anon, authenticated;
grant all on public.auth_sessions to service_role;
-- Deliberately no client policies. Only the backend service role can read tokens.

commit;
