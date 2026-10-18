-- Enforce manager-only writes to the schedule.
-- Apply only to the isolated Preview Supabase branch until tests pass.

create or replace function public.simple_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.simple_sessions s
    join public.simple_people p on p.id = s.person_id
    where s.auth_user_id = auth.uid()
      and p.active = true
      and p.is_manager = true
  );
$$;

revoke all on function public.simple_is_manager() from public, anon;
grant execute on function public.simple_is_manager() to authenticated;

drop policy if exists simple_shifts_write on public.simple_shifts;
create policy simple_shifts_write
on public.simple_shifts
for all
to authenticated
using (public.simple_is_manager())
with check (public.simple_is_manager());
