-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 003
--
-- Lets a scenario carry items that are not on the BOE, created by duplicating
-- one that is. Used to model "what if we had also shipped another of these".
--
-- Additive and idempotent. Requires 001 and 002.
-- ---------------------------------------------------------------------------

-- A duplicated row needs a description of its own, since it no longer maps to
-- a boe_items row to inherit one from.
alter table boe_scenario_items
  add column if not exists description text;

-- Which BOE item this row was duplicated from.
--   null     -- this row adjusts a real BOE item
--   not null -- this row IS an extra item, and borrows the source item's
--               effective duty rates, because it has no duty of its own
alter table boe_scenario_items
  add column if not exists source_itemsn integer;

create index if not exists boe_scenario_items_source_idx
  on boe_scenario_items (scenario_id, source_itemsn)
  where source_itemsn is not null;
