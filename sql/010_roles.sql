-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 010: two roles, one list, no domain rule
--
-- WHAT CHANGES
--
-- Migration 009 let anyone on the ferrarivideo.com domain in automatically.
-- That is removed: access is now granted address by address, deliberately, by
-- an administrator. A new colleague with a company Google account gets in when
-- somebody adds them and not before.
--
-- Two roles and no more:
--
--   admin  everything a user can do, plus: grant and revoke access, change
--          roles, and reset the password on any simulation
--   user   the portal -- records, costing, simulations
--
-- KEYED BY EMAIL, NOT USER ID
--
-- app_admins keyed on auth.users.id, which needed a sync step: an
-- administrator who had signed in with a password had one id, and signing in
-- with Google could create another. A person is their address regardless of
-- how they authenticated, so the list keys on that and the sync disappears.
--
-- Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. The list
-- ---------------------------------------------------------------------------
create table if not exists app_users (
  email      text primary key,
  role       text not null default 'user' check (role in ('admin', 'user')),
  added_by   text,
  added_at   timestamptz not null default now()
);

alter table app_users enable row level security;

-- Everyone signed in may see who has access and with what role. Knowing the
-- team is not sensitive, and the admin panel needs it. Changes go through the
-- functions below, never by writing this table directly.
drop policy if exists app_users_read on app_users;
create policy app_users_read on app_users
  for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- 2. Carry over what already exists, then retire the domain rule
-- ---------------------------------------------------------------------------
insert into app_users (email, role, added_by)
select lower(email), 'admin', 'migration 010' from app_admins
on conflict (email) do update set role = 'admin';

insert into app_users (email, role, added_by)
select lower(email), 'user', 'migration 010' from app_allowed_emails
on conflict (email) do nothing;

-- Guarantee at least one administrator, or the panel becomes unreachable.
insert into app_users (email, role, added_by)
values ('data@ferrarivideo.com', 'admin', 'migration 010')
on conflict (email) do update set role = 'admin';

drop table if exists app_allowed_domains;
drop table if exists app_allowed_emails;


-- ---------------------------------------------------------------------------
-- 3. The tests
-- ---------------------------------------------------------------------------
create or replace function is_member()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from app_users u
    where u.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from app_users u
    where u.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.role = 'admin'
  );
$$;

grant execute on function is_member() to authenticated;
grant execute on function is_admin()  to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Managing access
--
-- All administrator-only, all through functions so the table itself stays
-- unwritable from a browser.
-- ---------------------------------------------------------------------------
create or replace function admin_grant_access(p_email text, p_role text default 'user')
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'administrators only';
  end if;
  if p_role not in ('admin', 'user') then
    raise exception 'role must be admin or user';
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'that does not look like an email address';
  end if;

  insert into app_users (email, role, added_by)
  values (lower(trim(p_email)), p_role, auth.jwt() ->> 'email')
  on conflict (email) do update set role = excluded.role;
end;
$$;

create or replace function admin_revoke_access(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare remaining int;
begin
  if not is_admin() then
    raise exception 'administrators only';
  end if;
  if lower(trim(p_email)) = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'you cannot remove your own access';
  end if;

  delete from app_users where email = lower(trim(p_email));

  -- Removing the last administrator would leave the panel unreachable for
  -- everyone, so it is refused rather than recovered from.
  select count(*) into remaining from app_users where role = 'admin';
  if remaining = 0 then
    raise exception 'that would leave no administrator';
  end if;
end;
$$;

create or replace function admin_set_role(p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare remaining int;
begin
  if not is_admin() then
    raise exception 'administrators only';
  end if;
  if p_role not in ('admin', 'user') then
    raise exception 'role must be admin or user';
  end if;

  update app_users set role = p_role where email = lower(trim(p_email));
  if not found then
    raise exception 'that address does not have access';
  end if;

  select count(*) into remaining from app_users where role = 'admin';
  if remaining = 0 then
    raise exception 'that would leave no administrator';
  end if;
end;
$$;

revoke all on function admin_grant_access(text, text) from public, anon;
revoke all on function admin_revoke_access(text)       from public, anon;
revoke all on function admin_set_role(text, text)      from public, anon;

grant execute on function admin_grant_access(text, text) to authenticated;
grant execute on function admin_revoke_access(text)      to authenticated;
grant execute on function admin_set_role(text, text)     to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Every locked simulation, for the panel
--
-- Which simulations carry a password, who set one and when. Never the
-- password: it is a bcrypt hash and there is nothing to read back. An
-- administrator resets a lock rather than recovering it.
-- ---------------------------------------------------------------------------
create or replace function admin_locked_scenarios()
returns table (
  scenario_id  uuid,
  be_no        text,
  name         text,
  set_by_email text,
  set_at       timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select s.scenario_id, sc.be_no, sc.name, u.email::text, s.set_at
  from boe_scenario_secrets s
  join boe_scenarios sc on sc.id = s.scenario_id
  left join auth.users u on u.id::text = s.set_by
  where is_admin()
  order by s.set_at desc;
$$;

revoke all on function admin_locked_scenarios() from public, anon;
grant execute on function admin_locked_scenarios() to authenticated;

drop table if exists app_admins;


-- ---------------------------------------------------------------------------
-- 6. Verify
--
--   select is_member(), is_admin();
--   select * from app_users order by role, email;
--
-- A Google account whose address is not in app_users sees nothing at all.
-- ---------------------------------------------------------------------------
