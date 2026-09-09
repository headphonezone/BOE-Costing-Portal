-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 011: refuse at the door, not after
--
-- WHAT CHANGES
--
-- Until now anyone with a Google account could authenticate. They saw nothing
-- -- every policy gates on app_users membership -- but they held a real
-- session, and two things followed from that: they could read app_users and so
-- enumerate the team's addresses and roles, and the portal looked broken to
-- them rather than closed.
--
-- Now an address that is not on the allowlist cannot get an account at all.
-- The check runs on insert into auth.users, so it covers every route in:
-- Google, email, and the admin API alike.
--
-- ORDER OF OPERATIONS
--
-- A colleague must be granted access BEFORE their first sign-in. That is
-- already how app_users worked; this only makes the consequence immediate
-- rather than silent.
--
-- Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Only an allowlisted address may become a user
--
-- security definer so the lookup reads app_users as the owner, which keeps it
-- working no matter who is authenticating (the caller at this point is the
-- auth service, not a member).
-- ---------------------------------------------------------------------------
create or replace function auth_enforce_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from app_users u
    where u.email = lower(coalesce(new.email, ''))
  ) then
    raise exception 'This address is not authorised to use the BOE Costing Portal'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_allowlist on auth.users;
create trigger enforce_allowlist
  before insert on auth.users
  for each row execute function auth_enforce_allowlist();


-- ---------------------------------------------------------------------------
-- 2. The allowlist itself is members-only
--
-- Defence in depth. Step 1 means a stranger should never hold a session at
-- all, but if one ever did, the team's addresses and who administers the
-- portal are not theirs to read.
--
-- is_member() is security definer and so reads app_users as the owner; it does
-- not re-enter this policy.
-- ---------------------------------------------------------------------------
drop policy if exists app_users_read on app_users;
create policy app_users_read on app_users
  for select to authenticated using (is_member());


-- ---------------------------------------------------------------------------
-- 3. Anyone already through the door who should not be
--
-- Reports rather than deletes: removing an auth user cascades into whatever
-- they created, so this names them and leaves the decision to a person.
-- ---------------------------------------------------------------------------
create or replace function admin_unauthorised_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at
  from auth.users u
  where is_admin()
    and not exists (select 1 from app_users a where a.email = lower(u.email))
  order by u.created_at;
$$;

revoke all on function admin_unauthorised_users() from public, anon;
grant execute on function admin_unauthorised_users() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Verify
--
--   select * from admin_unauthorised_users();      -- should be empty
--   select * from app_users order by role, email;  -- readable only by members
--
-- A Google account whose address is not in app_users can no longer sign in;
-- the attempt fails at account creation.
-- ---------------------------------------------------------------------------
