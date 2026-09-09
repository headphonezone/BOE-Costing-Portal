-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 008: an administrator
--
-- data@ferrarivideo.com administers the portal: it may create other users,
-- open any locked scenario, and reset a lock somebody else set.
--
-- ON "VIEW THE PASSWORD SOMEONE SET"
--
-- It cannot, and no migration can give it that. Scenario passwords are stored
-- as bcrypt hashes, which are one-way -- there is nothing to read back, by
-- design. Storing them recoverably instead would mean one compromised key
-- exposes every scenario password at once, and people reuse passwords across
-- systems, so the blast radius would reach well past this portal.
--
-- What an administrator gets instead answers the same need without that risk:
--
--   * it is never locked out -- scenario_has_access() returns true for an
--     admin whatever password was set, so it opens the scenario directly
--   * it can clear any lock, so a forgotten password costs a reset
--
-- The one thing it cannot do is tell a user what they typed. It can let them
-- back in, which is what the request is actually for.
--
-- Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Who is an administrator
--
-- A table rather than a hardcoded address, so the second administrator is an
-- insert rather than a migration. Readable by any signed-in user -- knowing
-- who the admins are is not sensitive, and the interface needs it to decide
-- what to show. Writable only through service_role, which no browser holds.
-- ---------------------------------------------------------------------------
create table if not exists app_admins (
  user_id  uuid primary key,
  email    text not null,
  added_at timestamptz not null default now()
);

alter table app_admins enable row level security;

drop policy if exists app_admins_read on app_admins;
create policy app_admins_read on app_admins
  for select to authenticated using (true);

-- Seed from auth.users so the address, not a hand-copied id, is the source.
insert into app_admins (user_id, email)
select id, email from auth.users where email = 'data@ferrarivideo.com'
on conflict (user_id) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The test
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from app_admins a where a.user_id = auth.uid());
$$;

grant execute on function is_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. An administrator is never locked out
--
-- The only change is the extra disjunct. A locked scenario still needs a
-- grant for everybody else.
-- ---------------------------------------------------------------------------
create or replace function scenario_has_access(p_scenario uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    is_admin()
    or not exists (select 1 from boe_scenario_secrets s where s.scenario_id = p_scenario)
    or exists (
      select 1 from boe_scenario_grants g
      where g.scenario_id = p_scenario
        and g.user_id = auth.uid()
        and g.expires_at > now()
    );
$$;


-- ---------------------------------------------------------------------------
-- 4. An administrator may reset any lock
-- ---------------------------------------------------------------------------
create or replace function scenario_clear_password(p_scenario uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare owner text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select created_by into owner from boe_scenarios where id = p_scenario;
  if owner is not null and owner <> auth.uid()::text and not is_admin() then
    raise exception 'only the owner or an administrator may unlock this scenario';
  end if;
  delete from boe_scenario_secrets where scenario_id = p_scenario;
  delete from boe_scenario_grants  where scenario_id = p_scenario;
end;
$$;

create or replace function scenario_set_password(p_scenario uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare owner text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'password too short';
  end if;

  select created_by into owner from boe_scenarios where id = p_scenario;
  if not found then
    raise exception 'no such scenario';
  end if;
  if owner is not null and owner <> auth.uid()::text and not is_admin() then
    raise exception 'only the owner or an administrator may lock this scenario';
  end if;

  insert into boe_scenario_secrets (scenario_id, password_hash, set_by)
  values (p_scenario, extensions.crypt(p_password, extensions.gen_salt('bf', 12)), auth.uid()::text)
  on conflict (scenario_id)
    do update set password_hash = excluded.password_hash,
                  set_by = excluded.set_by,
                  set_at = now();

  insert into boe_scenario_grants (scenario_id, user_id, expires_at)
  values (p_scenario, auth.uid(), now() + interval '30 minutes')
  on conflict (scenario_id, user_id) do update set expires_at = excluded.expires_at;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. What an administrator can see about locks
--
-- Who set one and when -- never the password, because it is not stored.
-- ---------------------------------------------------------------------------
create or replace function scenario_locks(p_be_no text)
returns table (scenario_id uuid, name text, set_by_email text, set_at timestamptz)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select s.scenario_id, sc.name, u.email::text, s.set_at
  from boe_scenario_secrets s
  join boe_scenarios sc on sc.id = s.scenario_id
  left join auth.users u on u.id::text = s.set_by
  where is_admin() and sc.be_no = p_be_no
  order by s.set_at desc;
$$;

revoke all on function scenario_locks(text) from public, anon;
grant execute on function scenario_locks(text) to authenticated;
