-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 006: grant to authenticated, not to anyone
--
-- Migration 005 closed the write half: the anon key can read the import
-- tables but not change them. This closes the read half.
--
-- Until now "public" and "our team" were the same set of people, because
-- there was no login to tell them apart. Module 1 adds one, so the policies
-- can name it: every read policy moves from `using (true)` -- which any
-- holder of the anon key satisfies, and that key is compiled into the client
-- bundle -- to `to authenticated`, which requires a signed-in session.
--
-- The anon key stops being a key to the data and becomes only the key that
-- lets a browser ask to sign in.
--
-- BEFORE RUNNING THIS
--
--   At least one user must exist, or the portal locks everyone out including
--   you. Create one in Supabase -> Authentication -> Users, or with the
--   service_role key via the admin API.
--
-- Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Reads require a session
--
-- `to authenticated` is the whole change. The policy body stays `true`
-- because every signed-in user may read every import record -- the register is
-- shared, and narrowing it further is a role question, not an access one.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['boes','boe_items','boe_licences',
                           'boe_variable_fields','boe_documents']
  loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_read', t);
  end loop;
end $$;

-- boe_field_history and boe_document_extractions still get no policy at all.
-- The portal reads neither, and the parser reaches them with service_role,
-- which bypasses RLS.


-- ---------------------------------------------------------------------------
-- 2. Scenarios require a session too
--
-- These stay writable from the browser -- creating and editing a simulation is
-- the one thing the portal does that is not a read -- but only for someone
-- signed in.
-- ---------------------------------------------------------------------------
drop policy if exists boe_scenarios_all      on boe_scenarios;
drop policy if exists boe_scenario_items_all on boe_scenario_items;

create policy boe_scenarios_all on boe_scenarios
  for all to authenticated using (true) with check (true);

create policy boe_scenario_items_all on boe_scenario_items
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- 3. Scenarios acquire an owner
--
-- created_by already exists but nothing has ever filled it. A session gives
-- the system a person to attribute the row to, which is what a per-scenario
-- password needs in order to know who may clear it.
--
-- Existing rows keep their null: they were made before there were users, and
-- inventing an owner for them would be a lie.
-- ---------------------------------------------------------------------------
alter table boe_scenarios
  alter column created_by set default (auth.uid())::text;


-- ---------------------------------------------------------------------------
-- 4. Verify
--
-- Signed out, with only the anon key, every one of these must return nothing:
--     select count(*) from boes;
--     select count(*) from boe_scenarios;
--
-- Signed in, the same queries return rows. That difference is the module.
-- ---------------------------------------------------------------------------
