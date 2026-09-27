-- ================================================================
-- WoRxshift — complete database schema
-- Matches the live Supabase project as of September 26, 2026.
--
-- Use this to rebuild the database from nothing:
--   Supabase -> SQL Editor -> New query -> paste all -> Run
-- Then:
--   1. Replace the allowed domain at the bottom with the pharmacy's domain.
--   2. Create the first user (Authentication -> Users -> Add user) and run:
--        update public.profiles
--        set role = 'manager', approved = true, is_floater = false
--        where id = (select id from auth.users where email = 'you@example.com');
--   3. Deploy supabase/functions/send-push and set its secrets.
-- ================================================================

create extension if not exists btree_gist with schema extensions;


-- ============================ TABLES ============================

create table if not exists public.locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  abbrev      text not null,
  color       text not null default '#1f6feb',
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default 'New pharmacist',
  initials    text not null default '??',
  role        text not null default 'pharmacist' check (role in ('pharmacist', 'manager')),
  active      boolean not null default true,
  approved    boolean not null default false,
  is_floater  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  shift_date    date not null,
  location_id   uuid not null references public.locations(id) on delete cascade,
  pharmacist_id uuid references public.profiles(id) on delete set null,
  start_time    time not null,
  end_time      time not null,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint shifts_end_after_start check (end_time > start_time),
  constraint shifts_no_overlap exclude using gist (
    pharmacist_id with =,
    tsrange(shift_date + start_time, shift_date + end_time, '[)') with &&
  ) where (pharmacist_id is not null)
);

create table if not exists public.time_off (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint time_off_dates check (end_date >= start_date)
);

-- Reasons live apart from requests so only the requester and managers can read them.
create table if not exists public.time_off_notes (
  time_off_id uuid primary key references public.time_off(id) on delete cascade,
  note        text not null
);

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.allowed_domains (
  domain      text primary key,
  created_at  timestamptz not null default now()
);


-- ============================ INDEXES ===========================

create index if not exists shifts_date_idx         on public.shifts (shift_date);
create index if not exists shifts_pharmacist_idx   on public.shifts (pharmacist_id);
create index if not exists shifts_location_idx     on public.shifts (location_id);
create index if not exists shifts_created_by_idx   on public.shifts (created_by);
create index if not exists time_off_user_idx       on public.time_off (user_id);
create index if not exists time_off_range_idx      on public.time_off (start_date, end_date);
create index if not exists time_off_decided_by_idx on public.time_off (decided_by);
create index if not exists push_subs_user_idx      on public.push_subscriptions (user_id);


-- ======================= HELPER FUNCTIONS =======================

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager' and active
  );
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved and active
  );
$$;

revoke execute on function public.is_manager()  from public, anon;
revoke execute on function public.is_approved() from public, anon;
grant  execute on function public.is_manager()  to authenticated;
grant  execute on function public.is_approved() to authenticated;


-- ============================ SIGNUP ============================
-- Only approved email domains may register; everyone starts unapproved.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  email_domain text := lower(split_part(new.email, '@', 2));
begin
  if not exists (select 1 from public.allowed_domains d where d.domain = email_domain) then
    raise exception 'EMAIL_DOMAIN_NOT_ALLOWED';
  end if;

  insert into public.profiles (id, full_name, initials, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'full_name', new.email), 2)),
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- ======================== SHIFT RULES ===========================
-- Only active, approved floaters can be assigned; stamps who created and edited.

create or replace function public.shifts_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pharmacist_id is not null and not exists (
    select 1 from public.profiles
    where id = new.pharmacist_id and active and approved and is_floater
  ) then
    raise exception 'SHIFT_ASSIGNEE_NOT_SCHEDULABLE';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shifts_before_write on public.shifts;
create trigger shifts_before_write
  before insert or update on public.shifts
  for each row execute function public.shifts_before_write();

revoke execute on function public.shifts_before_write() from public, anon, authenticated;


-- ==================== ALWAYS ONE MANAGER ========================

create or replace function public.protect_last_manager()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'manager' and old.active and old.approved and (
       tg_op = 'DELETE'
       or new.role <> 'manager' or not new.active or not new.approved
     ) then
    if not exists (
      select 1 from public.profiles
      where id <> old.id and role = 'manager' and active and approved
    ) then
      raise exception 'LAST_MANAGER';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists protect_last_manager on public.profiles;
create trigger protect_last_manager
  before update or delete on public.profiles
  for each row execute function public.protect_last_manager();

revoke execute on function public.protect_last_manager() from public, anon, authenticated;


-- ========================= TIME OFF =============================

create or replace function public.request_time_off(p_start date, p_end date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and active and approved and is_floater
  ) then
    raise exception 'NOT_A_FLOATER';
  end if;

  insert into public.time_off (user_id, start_date, end_date, status)
  values (auth.uid(), p_start, p_end, 'pending')
  returning id into new_id;

  if p_note is not null and btrim(p_note) <> '' then
    insert into public.time_off_notes (time_off_id, note)
    values (new_id, left(btrim(p_note), 500));
  end if;

  return new_id;
end;
$$;

revoke execute on function public.request_time_off(date, date, text) from public, anon;
grant  execute on function public.request_time_off(date, date, text) to authenticated;


-- ================= SAVE A FORTNIGHT, ALL OR NOTHING =============

create or replace function public.save_schedule_period(p_pharmacist uuid, p_days jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  d        jsonb;
  day      date;
  existing public.shifts%rowtype;
  cnt      integer;
  changed  integer := 0;
  loc      uuid;
  st       time;
  en       time;
begin
  if not public.is_manager() then
    raise exception 'NOT_MANAGER';
  end if;

  for d in select * from jsonb_array_elements(p_days)
  loop
    day := (d->>'date')::date;
    loc := nullif(d->>'location_id', '')::uuid;
    st  := nullif(d->>'start', '')::time;
    en  := nullif(d->>'end', '')::time;

    select count(*) into cnt from public.shifts
    where pharmacist_id = p_pharmacist and shift_date = day;

    if cnt > 1 then
      raise exception 'SCHEDULE_CHANGED_ELSEWHERE %', day;
    end if;

    if cnt = 1 then
      select * into existing from public.shifts
      where pharmacist_id = p_pharmacist and shift_date = day;

      if loc is null then
        delete from public.shifts where id = existing.id;
        changed := changed + 1;
      elsif existing.location_id <> loc or existing.start_time <> st or existing.end_time <> en then
        update public.shifts set location_id = loc, start_time = st, end_time = en
        where id = existing.id;
        changed := changed + 1;
      end if;
    elsif loc is not null then
      insert into public.shifts (shift_date, location_id, pharmacist_id, start_time, end_time)
      values (day, loc, p_pharmacist, st, en);
      changed := changed + 1;
    end if;
  end loop;

  return changed;
end;
$$;

revoke execute on function public.save_schedule_period(uuid, jsonb) from public, anon;
grant  execute on function public.save_schedule_period(uuid, jsonb) to authenticated;


-- ===================== ROW LEVEL SECURITY =======================

alter table public.locations          enable row level security;
alter table public.profiles           enable row level security;
alter table public.shifts             enable row level security;
alter table public.time_off           enable row level security;
alter table public.time_off_notes     enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.allowed_domains    enable row level security;

-- locations
drop policy if exists locations_read  on public.locations;
drop policy if exists locations_write on public.locations;
create policy locations_read  on public.locations for select to authenticated using (public.is_approved());
create policy locations_write on public.locations for all    to authenticated using (public.is_manager()) with check (public.is_manager());

-- profiles
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_manage on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (id = auth.uid() or public.is_approved());
create policy profiles_manage on public.profiles for all    to authenticated using (public.is_manager()) with check (public.is_manager());

-- shifts
drop policy if exists shifts_read  on public.shifts;
drop policy if exists shifts_write on public.shifts;
create policy shifts_read  on public.shifts for select to authenticated using (public.is_approved());
create policy shifts_write on public.shifts for all    to authenticated using (public.is_manager()) with check (public.is_manager());

-- time_off
drop policy if exists time_off_read       on public.time_off;
drop policy if exists time_off_insert_own on public.time_off;
drop policy if exists time_off_delete_own on public.time_off;
drop policy if exists time_off_manage     on public.time_off;
create policy time_off_read on public.time_off for select to authenticated using (public.is_approved());
create policy time_off_insert_own on public.time_off for insert to authenticated
  with check (
    user_id = auth.uid() and status = 'pending' and public.is_approved()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_floater)
  );
create policy time_off_delete_own on public.time_off for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');
create policy time_off_manage on public.time_off for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- time_off_notes: read only; written only through request_time_off()
drop policy if exists time_off_notes_read on public.time_off_notes;
create policy time_off_notes_read on public.time_off_notes for select to authenticated
  using (
    public.is_manager()
    or exists (
      select 1 from public.time_off t
      where t.id = time_off_id and t.user_id = (select auth.uid())
    )
  );

-- push_subscriptions: each person manages only their own devices
drop policy if exists push_own_select on public.push_subscriptions;
drop policy if exists push_own_insert on public.push_subscriptions;
drop policy if exists push_own_update on public.push_subscriptions;
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_own_update on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- allowed_domains: managers only
drop policy if exists domains_read  on public.allowed_domains;
drop policy if exists domains_write on public.allowed_domains;
create policy domains_read  on public.allowed_domains for select to authenticated using (public.is_manager());
create policy domains_write on public.allowed_domains for all    to authenticated using (public.is_manager()) with check (public.is_manager());


-- ============================ SEED ==============================

insert into public.locations (name, abbrev, color, sort_order)
select * from (values
  ('Beebe Drug',              'BEEBE',   '#1f6feb', 1),
  ('Vilonia Family Pharmacy', 'VILONIA', '#0f8a5f', 2),
  ('Amity Road Pharmacy',     'AMITY',   '#b0410f', 3)
) as v(name, abbrev, color, sort_order)
where not exists (select 1 from public.locations);

-- CHANGE THIS to the pharmacy's email domain (no @, lowercase).
insert into public.allowed_domains (domain) values ('yourpharmacy.com')
on conflict (domain) do nothing;
