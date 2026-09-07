-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 005: close the anon key's write access
--
-- WHAT THIS FIXES
--
-- The anon key ships in the portal's page source, which is by design -- it is
-- meant to be public, and row level security is meant to be what constrains
-- it. That was never applied here. An audit with the public key found:
--
--   * 8 of 9 tables readable, insertable and deletable by anyone
--   * only boe_document_extractions protected, and only by accident
--   * the document bucket listable, downloadable and writable
--
-- Anyone with the site URL could read every import record and delete all of
-- them. This migration removes the write half.
--
-- WHAT THIS DOES NOT FIX
--
-- Reads stay open. Without a login there is no way to tell a colleague from a
-- stranger, so every SELECT the portal needs is a SELECT anyone can make.
-- Closing that requires authentication -- see the README's Known gaps.
--
-- ---------------------------------------------------------------------------
-- BEFORE RUNNING THIS
--
--   1. Set SUPABASE_KEY on the parser project to the SERVICE_ROLE key, not
--      the anon key. The parser writes every table this migration closes.
--      service_role bypasses RLS; anon will no longer be able to write, and
--      PDF upload will fail with a policy error until this is done.
--
--   2. Set SUPABASE_SERVICE_KEY on the portal project (no NEXT_PUBLIC_
--      prefix -- that prefix would publish it). The portal signs document
--      links with it server-side.
--
-- Every statement is idempotent; re-running changes nothing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Row level security on every table
--
-- Enabling RLS without a policy denies everything, so each table's read
-- policy is created in the same step.
-- ---------------------------------------------------------------------------
alter table boes                     enable row level security;
alter table boe_items                enable row level security;
alter table boe_licences             enable row level security;
alter table boe_variable_fields      enable row level security;
alter table boe_documents            enable row level security;
alter table boe_field_history        enable row level security;
alter table boe_document_extractions enable row level security;
-- boe_scenarios and boe_scenario_items already have it, from 001.


-- ---------------------------------------------------------------------------
-- 2. Reads
--
-- The portal reads these seven directly. Until there is a login, "public"
-- and "our team" are the same set of people, so these stay readable.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['boes','boe_items','boe_licences',
                           'boe_variable_fields','boe_documents']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
  end loop;
end $$;

-- The portal never reads these two. The history table is an audit trail and
-- the extraction table holds raw document text, so neither is exposed at all.
drop policy if exists boe_field_history_read        on boe_field_history;
drop policy if exists boe_document_extractions_read on boe_document_extractions;


-- ---------------------------------------------------------------------------
-- 3. Writes
--
-- No write policies are created for the tables above, and RLS denies what it
-- is not told to allow. The parser writes them with the service_role key,
-- which bypasses RLS entirely -- that is the whole reason step 1 of the
-- checklist above is not optional.
--
-- Scenarios are the exception. They are created and edited from the browser
-- with the anon key, so closing them would remove the simulation feature.
-- They hold no import data of their own -- only adjustments referencing a
-- BOE -- so the exposure is bounded, and it closes when login lands.
-- ---------------------------------------------------------------------------
drop policy if exists boe_scenarios_all      on boe_scenarios;
drop policy if exists boe_scenario_items_all on boe_scenario_items;

create policy boe_scenarios_all on boe_scenarios
  for all using (true) with check (true);
create policy boe_scenario_items_all on boe_scenario_items
  for all using (true) with check (true);


-- ---------------------------------------------------------------------------
-- 4. Manual entry
--
-- frontend/src/lib/manual-entry.ts writes boes and boe_items straight from
-- the browser, deliberately: it is the fallback for when the parser cannot
-- read a PDF, so it must not depend on the parser being reachable.
--
-- That design predates this migration and is now the one hole left in the
-- write lockdown. Uncomment ONLY if you need manual entry working before
-- login exists, and understand that it reopens insert, update and delete on
-- your import records to anyone with the site URL.
--
-- The better fix is to route manual entry through the parser service, which
-- holds the service_role key.
-- ---------------------------------------------------------------------------
-- create policy boes_manual_entry on boes
--   for all using (true) with check (true);
-- create policy boe_items_manual_entry on boe_items
--   for all using (true) with check (true);


-- ---------------------------------------------------------------------------
-- 5. Storage
--
-- Run these in the Supabase dashboard (Storage -> Policies) or here. The
-- bucket holds real Bills of Entry: IEC, GSTIN, supplier, unit prices, duty.
-- It was listable, downloadable AND writable with the anon key.
--
-- The portal no longer needs anon access to it: signed links are minted
-- server-side with the service key (frontend/src/lib/supabase-server.ts), and
-- service_role bypasses these policies.
-- ---------------------------------------------------------------------------
drop policy if exists boe_documents_anon_read   on storage.objects;
drop policy if exists boe_documents_anon_write  on storage.objects;
drop policy if exists boe_documents_public_read on storage.objects;

-- No policy is created for the boe-documents bucket, so anon gets nothing.
-- Verify afterwards: listing or downloading with the anon key must fail.


-- ---------------------------------------------------------------------------
-- 6. Verify
--
-- With the anon key, these should return rows:
--     select count(*) from boes;
--
-- and these should all fail:
--     insert into boes (be_no) values ('__TEST__');
--     delete from boe_items where be_no = '__NOPE__';
--     select count(*) from boe_field_history;
--
-- and with the anon key, listing the boe-documents bucket must return nothing.
-- ---------------------------------------------------------------------------
