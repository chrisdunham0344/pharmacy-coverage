-- Simplified WoRxshift schema
-- Passcodes are configured outside the browser. Do not store them in VITE_ variables.

create extension if not exists pgcrypto;

create table if not exists public.simple_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  is_floater boolean not null default false,
  is_manager boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists simple_people_name_unique
on public.simple_people (lower(name));

create table if not exists public.simple_sessions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  person_id uuid not null references public.simple_people(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.simple_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  person_id uuid not null references public.simple_people(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  created_by uuid not null references public.simple_people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simple_shift_time check (end_time > start_time),
  constraint simple_shift_no_overlap exclude using gist (
    person_id with =,
    tsrange(shift_date + start_time, shift_date + end_time, '[)') with &&
  )
);

create table if not exists public.simple_time_off (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.simple_people(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  constraint simple_time_off_dates check (end_date >= start_date)
);

create table if not exists public.simple_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.simple_people(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.simple_people enable row level security;
alter table public.simple_sessions enable row level security;
alter table public.simple_shifts enable row level security;
alter table public.simple_time_off enable row level security;
alter table public.simple_push_subscriptions enable row level security;

create or replace function public.simple_current_person()
returns uuid language sql stable security definer set search_path=public as $$
  select person_id from public.simple_sessions where auth_user_id = auth.uid()
$$;

create or replace function public.simple_is_logged_in()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.simple_sessions where auth_user_id = auth.uid())
$$;

revoke all on function public.simple_current_person() from public, anon;
revoke all on function public.simple_is_logged_in() from public, anon;
grant execute on function public.simple_current_person() to authenticated;
grant execute on function public.simple_is_logged_in() to authenticated;

drop policy if exists simple_people_read on public.simple_people;
create policy simple_people_read on public.simple_people for select to authenticated
using (public.simple_is_logged_in());

drop policy if exists simple_sessions_read on public.simple_sessions;
create policy simple_sessions_read on public.simple_sessions for select to authenticated
using (auth_user_id = auth.uid());

drop policy if exists simple_shifts_read on public.simple_shifts;
drop policy if exists simple_shifts_write on public.simple_shifts;
create policy simple_shifts_read on public.simple_shifts for select to authenticated
using (public.simple_is_logged_in());
create policy simple_shifts_write on public.simple_shifts for all to authenticated
using (public.simple_is_logged_in()) with check (public.simple_is_logged_in());

drop policy if exists simple_time_off_read on public.simple_time_off;
drop policy if exists simple_time_off_write on public.simple_time_off;
create policy simple_time_off_read on public.simple_time_off for select to authenticated
using (public.simple_is_logged_in());
create policy simple_time_off_write on public.simple_time_off for all to authenticated
using (public.simple_is_logged_in()) with check (public.simple_is_logged_in());

drop policy if exists simple_push_read on public.simple_push_subscriptions;
drop policy if exists simple_push_write on public.simple_push_subscriptions;
create policy simple_push_read on public.simple_push_subscriptions for select to authenticated
using (auth_user_id = auth.uid());
create policy simple_push_write on public.simple_push_subscriptions for all to authenticated
using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

insert into public.simple_people (name, is_manager)
select 'Manager', true
where not exists (select 1 from public.simple_people);

