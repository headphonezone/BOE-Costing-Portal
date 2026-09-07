-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 005: close the anon key's write access
--
-- WHAT THIS FIXES
--
-- The anon key ships in the portal's page source, which is by design -- it is
-- meant to be public, and row level security is meant to be what constrains
-- it. RLS was enabled here, but every table carried an `allow all for anon`
-- policy granting ALL commands, so it constrained nothing. An audit with the
-- public key confirmed the effect:
--
--   * 8 of 9 tables readable, insertable and deletable by anyone
--   * the boe-documents bucket listable, downloadable AND writable, holding
--     real Bills of Entry -- importer IEC and GSTIN, supplier, unit prices,
--     duty
--
-- Anyone with the site URL could read every import record and delete all of
-- them. This removes the write half.
--
-- WHAT THIS DOES NOT FIX
--
-- Reads stay open. Without a login there is no way to tell a colleague from a
-- stranger, so every SELECT the portal needs is a SELECT anyone can make.
-- Closing that requires authentication.
--
-- PREREQUISITES (both done)
--
--   * parser project SUPABASE_KEY is the service_role key, which bypasses RLS
--   * portal project SUPABASE_SERVICE_KEY is set, so document links are
--     signed server-side rather than with the anon key
--
-- Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Remove the blanket grants
-- ---------------------------------------------------------------------------
drop policy if exists "allow all for anon" on boes;
drop policy if exists "allow all for anon" on boe_items;
drop policy if exists "allow all for anon" on boe_licences;
drop policy if exists "allow all for anon" on boe_variable_fields;
drop policy if exists "allow all for anon" on boe_documents;
drop policy if exists "allow all for anon" on boe_field_history;

alter table boes                     enable row level security;
alter table boe_items                enable row level security;
alter table boe_licences             enable row level security;
alter table boe_variable_fields      enable row level security;
alter table boe_documents            enable row level security;
alter table boe_field_history        enable row level security;
alter table boe_document_extractions enable row level security;


-- ---------------------------------------------------------------------------
-- 2. Reads
--
-- The portal reads these five directly, so they stay readable. RLS denies
-- anything it is not told to allow, so no INSERT, UPDATE or DELETE policy
-- means those commands are refused -- the parser does that work with the
-- service_role key, which bypasses RLS entirely.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['boes','boe_items','boe_licences',
                           'boe_variable_fields','boe_documents']
  loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (true)', t || '_read', t);
  end loop;
end $$;

-- boe_field_history is an audit trail and boe_document_extractions holds raw
-- document text. The portal reads neither, so neither gets a policy and both
-- are closed to the anon key completely.


-- ---------------------------------------------------------------------------
-- 3. Scenarios stay writable
--
-- Simulations are created and edited from the browser with the anon key, so
-- closing these would remove the feature. They hold no import data of their
-- own -- only adjustments referencing a BOE -- so the exposure is bounded,
-- and it closes when login lands.
-- ---------------------------------------------------------------------------
drop policy if exists boe_scenarios_all      on boe_scenarios;
drop policy if exists boe_scenario_items_all on boe_scenario_items;

create policy boe_scenarios_all on boe_scenarios
  for all using (true) with check (true);
create policy boe_scenario_items_all on boe_scenario_items
  for all using (true) with check (true);


-- ---------------------------------------------------------------------------
-- 4. Storage
--
-- The bucket is already marked private, but a policy granted ALL commands to
-- `public` on it, which is how the anon key could list, download and upload
-- Bills of Entry.
--
-- Dropping it leaves no policy, so anon gets nothing. The portal is
-- unaffected: it signs links with the service_role key, which bypasses this.
-- ---------------------------------------------------------------------------
drop policy if exists "allow all for anon on boe-documents" on storage.objects;


-- ---------------------------------------------------------------------------
-- 5. Manual entry
--
-- frontend/src/lib/manual-entry.ts wrote boes and boe_items straight from the
-- browser. That is exactly the access this migration closes, so the feature
-- is removed from the UI in the same change rather than left to fail.
--
-- To bring it back, route it through the parser service, which holds the
-- service_role key -- not by reopening these tables to anon.
-- ---------------------------------------------------------------------------
