-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 007: per-scenario passwords
--
-- A scenario may carry a password. Once set, opening it -- its inputs, its
-- item adjustments, its costed rows -- requires that password; without it the
-- scenario is listed by name and nothing more.
--
-- ENFORCEMENT IS AT THE DATA LAYER, NOT IN THE INTERFACE
--
-- The portal reads the scenario tables directly from Postgres, so a lock that
-- only hides a panel is a curtain rather than a lock: the row is one query
-- away, and it is a query the client is otherwise entitled to make. So the
-- row-level policy itself withholds the body, and the interface merely
-- reflects what the database has already decided.
--
-- A scenario password is a sharing control between people who are already
-- signed in. It is not a second factor and not a substitute for migration 006.
--
-- ON THE HASH
--
-- docs/WHITEPAPER.md §7.6 specifies Argon2id. This project's Postgres has
-- pgcrypto but no Argon2 -- pgsodium is deprecated and not installed -- so
-- this uses bcrypt at cost 12, which pgcrypto does provide. For a sharing
-- control between authenticated colleagues that is an appropriate strength;
-- the whitepaper should be corrected to say bcrypt rather than this
-- pretending otherwise. pgcrypto lives in Supabase's `extensions` schema, so
-- crypt and gen_salt are schema-qualified rather than widening search_path,
-- which for a security definer function is the safer of the two.
--
-- Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------------
-- 1. The hash, somewhere unselectable
--
-- A separate table rather than a column on boe_scenarios, because a column
-- would be returned by `select *` -- which is what the portal issues -- and
-- revoking one column's SELECT is easy to undo by accident later.
--
-- RLS is enabled and NO policy is created, so this table is unreachable by
-- any client, with the anon key or a session. Only the security definer
-- functions below can see it.
-- ---------------------------------------------------------------------------
create table if not exists boe_scenario_secrets (
  scenario_id   uuid primary key references boe_scenarios(id) on delete cascade,
  password_hash text        not null,
  set_by        text,
  set_at        timestamptz not null default now()
);

alter table boe_scenario_secrets enable row level security;


-- ---------------------------------------------------------------------------
-- 2. Grants -- the short-lived proof that a password was given
--
-- Also unreachable directly. A grant is per user and per scenario, so one
-- person unlocking a scenario does not unlock it for everybody.
-- ---------------------------------------------------------------------------
create table if not exists boe_scenario_grants (
  scenario_id uuid        not null references boe_scenarios(id) on delete cascade,
  user_id     uuid        not null,
  expires_at  timestamptz not null,
  primary key (scenario_id, user_id)
);

alter table boe_scenario_grants enable row level security;


-- ---------------------------------------------------------------------------
-- 3. The access test
--
-- Unlocked scenarios are readable by any signed-in user, which is the point:
-- the register is shared. A locked one needs an unexpired grant.
--
-- `security definer` so it can see the two tables above; `stable` so Postgres
-- may cache it within a statement rather than re-running it per row.
-- ---------------------------------------------------------------------------
create or replace function scenario_has_access(p_scenario uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    not exists (select 1 from boe_scenario_secrets s where s.scenario_id = p_scenario)
    or exists (
      select 1 from boe_scenario_grants g
      where g.scenario_id = p_scenario
        and g.user_id = auth.uid()
        and g.expires_at > now()
    );
$$;


-- ---------------------------------------------------------------------------
-- 4. The listing
--
-- A locked scenario must still appear, or the comparison would misstate how
-- many scenarios exist. This returns identity and lock state only -- never an
-- input, never a figure -- so it can safely bypass the policy below.
-- ---------------------------------------------------------------------------
create or replace function scenario_index(p_be_no text)
returns table (id uuid, name text, is_locked boolean, has_access boolean, created_at timestamptz)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select s.id,
         s.name,
         exists (select 1 from boe_scenario_secrets x where x.scenario_id = s.id),
         scenario_has_access(s.id),
         s.created_at
  from boe_scenarios s
  where s.be_no = p_be_no
  order by s.created_at;
$$;


-- ---------------------------------------------------------------------------
-- 5. Setting, clearing and opening
--
-- Only the owner may set or clear. Rows created before migration 006 have a
-- null created_by -- they predate sign-in -- so anyone signed in may adopt
-- them, which is better than leaving them permanently unlockable.
-- ---------------------------------------------------------------------------
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
  if owner is not null and owner <> auth.uid()::text then
    raise exception 'only the owner may lock this scenario';
  end if;

  insert into boe_scenario_secrets (scenario_id, password_hash, set_by)
  values (p_scenario, extensions.crypt(p_password, extensions.gen_salt('bf', 12)), auth.uid()::text)
  on conflict (scenario_id)
    do update set password_hash = excluded.password_hash,
                  set_by = excluded.set_by,
                  set_at = now();

  -- Whoever set it can obviously open it.
  insert into boe_scenario_grants (scenario_id, user_id, expires_at)
  values (p_scenario, auth.uid(), now() + interval '30 minutes')
  on conflict (scenario_id, user_id) do update set expires_at = excluded.expires_at;
end;
$$;

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
  if owner is not null and owner <> auth.uid()::text then
    raise exception 'only the owner may unlock this scenario';
  end if;
  delete from boe_scenario_secrets where scenario_id = p_scenario;
  delete from boe_scenario_grants  where scenario_id = p_scenario;
end;
$$;

-- Returns true and issues a grant, or false. Deliberately says nothing about
-- why it failed.
create or replace function scenario_unlock(p_scenario uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare stored text;
begin
  if auth.uid() is null then
    return false;
  end if;
  select password_hash into stored from boe_scenario_secrets where scenario_id = p_scenario;
  if stored is null then
    return true;              -- not locked
  end if;
  if stored <> extensions.crypt(p_password, stored) then
    return false;
  end if;

  insert into boe_scenario_grants (scenario_id, user_id, expires_at)
  values (p_scenario, auth.uid(), now() + interval '30 minutes')
  on conflict (scenario_id, user_id) do update set expires_at = excluded.expires_at;
  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. The policies withhold the body
--
-- This is the line that makes it a lock rather than a curtain.
-- ---------------------------------------------------------------------------
drop policy if exists boe_scenarios_all      on boe_scenarios;
drop policy if exists boe_scenario_items_all on boe_scenario_items;

create policy boe_scenarios_all on boe_scenarios
  for all to authenticated
  using (scenario_has_access(id))
  with check (scenario_has_access(id));

create policy boe_scenario_items_all on boe_scenario_items
  for all to authenticated
  using (scenario_has_access(scenario_id))
  with check (scenario_has_access(scenario_id));


-- ---------------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------------
revoke all on function scenario_set_password(uuid, text)   from public, anon;
revoke all on function scenario_clear_password(uuid)       from public, anon;
revoke all on function scenario_unlock(uuid, text)         from public, anon;
revoke all on function scenario_index(text)                from public, anon;

grant execute on function scenario_set_password(uuid, text) to authenticated;
grant execute on function scenario_clear_password(uuid)     to authenticated;
grant execute on function scenario_unlock(uuid, text)       to authenticated;
grant execute on function scenario_index(text)              to authenticated;
grant execute on function scenario_has_access(uuid)         to authenticated;
