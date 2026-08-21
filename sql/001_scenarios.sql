-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- simulation tables
--
-- Additive migration. Runs against the SAME Supabase project that the
-- existing BOE-Costing-Sheet backend writes actuals into; it creates no
-- tables that already exist and alters none of them. The portal reads
-- boes / boe_items / boe_licences as read-only actuals and owns only the
-- two tables below.
--
-- Apply with:  supabase db execute --file sql/001_scenarios.sql
--          or: paste into the Supabase SQL editor
-- ---------------------------------------------------------------------------

-- A saved "what-if" against one BOE. Every adjustable input is nullable and
-- means "inherit the actual value from the BOE" when null, so a freshly
-- created scenario reproduces the actual costing exactly until something is
-- deliberately changed. That property is what makes a scenario diffable
-- against actuals rather than being a disconnected copy.
create table if not exists boe_scenarios (
  id                   uuid primary key default gen_random_uuid(),
  be_no                text not null references boes(be_no) on delete cascade,
  name                 text not null,
  notes                text,

  -- 'derived' : duty floats with value, using effective rates back-computed
  --             from this BOE's own actual duty amounts.
  -- 'locked'  : duty stays exactly at the amounts customs actually charged.
  duty_mode            text not null default 'derived'
                       check (duty_mode in ('derived', 'locked')),

  exchange_rate        numeric,

  -- Freight. freight_total_inr is always the number the engine consumes.
  -- The basis/rate/quantity trio is an optional calculator that produces it
  -- (air INR/kg on chargeable weight, sea INR/CBM or per container) and is
  -- kept so a saved scenario can explain where its freight number came from.
  freight_mode         text not null default 'AIR'
                       check (freight_mode in ('AIR', 'SEA', 'ROAD', 'COURIER', 'OTHER')),
  freight_basis        text not null default 'LUMP_SUM'
                       check (freight_basis in ('LUMP_SUM', 'PER_KG', 'PER_CBM', 'PER_CONTAINER')),
  freight_rate         numeric,
  freight_quantity     numeric,
  freight_total_inr    numeric,

  -- The rest of the expense pool. Mirrors the C-SHEET header cells, plus the
  -- three that the spreadsheet captured but never actually costed.
  insurance_inr        numeric,
  clearance_inr        numeric,
  other_charges_inr    numeric,
  misc_charges_inr     numeric,
  supplier_freight_inr numeric,
  bank_charges_inr     numeric,
  own_bank_charges_inr numeric,

  margin_pct           numeric not null default 2,

  created_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists boe_scenarios_be_no_idx on boe_scenarios (be_no);

-- Two scenarios on the same BOE may not share a name -- the comparison view
-- identifies columns by name, and "Simulation 2" twice is unreadable.
create unique index if not exists boe_scenarios_be_no_name_idx
  on boe_scenarios (be_no, lower(name));


-- Per-item overrides. Sparse on purpose: a row exists only for an item the
-- user actually touched, and null columns within it still inherit. Keyed by
-- (invsno, itemsn) rather than boe_items.id so a scenario survives the
-- parent BOE being re-uploaded after a parser fix -- save_boe() deletes and
-- reinserts boe_items wholesale, which would strand any id-based reference.
create table if not exists boe_scenario_items (
  id             bigint generated always as identity primary key,
  scenario_id    uuid not null references boe_scenarios(id) on delete cascade,
  invsno         integer not null,
  itemsn         integer not null,

  unit_price_usd numeric,
  qty            numeric,

  -- FOC: the buyer pays nothing for this item. The goods still physically
  -- ship and are still declared to customs, so the item keeps its declared
  -- value for freight/insurance apportionment. foc_bears_duty then decides
  -- whether duty is charged on that declared value or waived entirely.
  is_foc         boolean not null default false,
  foc_bears_duty boolean not null default true,

  unique (scenario_id, invsno, itemsn)
);

create index if not exists boe_scenario_items_scenario_idx
  on boe_scenario_items (scenario_id);


-- keep updated_at honest
create or replace function boe_scenarios_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists boe_scenarios_touch on boe_scenarios;
create trigger boe_scenarios_touch
  before update on boe_scenarios
  for each row execute function boe_scenarios_touch_updated_at();


-- ---------------------------------------------------------------------------
-- Row level security
--
-- The portal talks to Supabase with the anon key from the browser, the same
-- way the existing dashboard does. These policies are deliberately open so
-- the portal works on day one against the current setup. They are NOT a
-- security model: anyone holding the anon key can read and write scenarios.
-- Tighten to authenticated-only once sign-in is added -- see README, "Auth".
-- ---------------------------------------------------------------------------
alter table boe_scenarios      enable row level security;
alter table boe_scenario_items enable row level security;

drop policy if exists boe_scenarios_all on boe_scenarios;
create policy boe_scenarios_all on boe_scenarios
  for all using (true) with check (true);

drop policy if exists boe_scenario_items_all on boe_scenario_items;
create policy boe_scenario_items_all on boe_scenario_items
  for all using (true) with check (true);
