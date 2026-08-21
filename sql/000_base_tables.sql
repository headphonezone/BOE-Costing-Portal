-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- base tables (the actual import records)
--
-- These hold the parsed Bill of Entry data. The parser service writes them;
-- the portal reads them.
--
-- PROVENANCE: these tables were created by hand in Supabase and their DDL was
-- never checked into any repository. Column names below were read back from
-- the live database; the TYPES are reconstructed from backend/supabase_client.py
-- and the values actually stored. So this file is accurate enough to stand up a
-- fresh environment, but it is a reconstruction, not the original DDL -- verify
-- against production before trusting it for a migration.
--
-- Every statement is `if not exists`, so running this against the existing
-- database changes nothing.
--
-- Order: run 000, then 001, 002, 003.
-- ---------------------------------------------------------------------------

-- One row per Bill of Entry. Keyed by BE number, which is what every other
-- table references and what the whole application looks records up by.
create table if not exists boes (
  be_no                text primary key,
  be_date              date,
  port_code            text,
  importer_name        text,
  supplier_name        text,
  inv_no               text,
  inv_date             date,
  inv_value_usd        numeric,
  freight_inr          numeric,
  insurance_inr        numeric,
  misc_charges_inr     numeric,
  exchange_rate        numeric,
  hawb_no              text,
  total_assess_value   numeric,
  total_duty           numeric,
  raw_pdf_storage_path text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Line items. A BOE can carry several invoices, each restarting its item
-- numbering at 1, so (invsno, itemsn) is the natural key within a BOE and
-- global_sno is the sequence across the whole document.
create table if not exists boe_items (
  id             bigint generated always as identity primary key,
  be_no          text not null references boes(be_no) on delete cascade,
  global_sno     integer,
  invsno         integer not null,
  itemsn         integer not null,
  cth            text,
  description    text,
  unit_price_usd numeric,
  qty            numeric,
  uqc            text,
  assess_value   numeric,
  -- Duty paid in cash. Zero when the item cleared against a licence, in which
  -- case bcd_forgone carries the real figure (Part IV Section G).
  bcd            numeric,
  bcd_forgone    numeric,
  sws            numeric,
  igst           numeric,
  total_duty     numeric
);

create index if not exists boe_items_be_no_idx on boe_items (be_no);

-- Import licences an item's duty was debited against. Reference only -- the
-- BCD figure itself comes from Section G, not from re-summing these.
create table if not exists boe_licences (
  id           bigint generated always as identity primary key,
  be_no        text not null references boes(be_no) on delete cascade,
  invsno       integer not null,
  itemsn       integer not null,
  lic_no       text,
  lic_date     date,
  code         text,
  port         text,
  debit_value  numeric,
  debit_duty   numeric
);

create index if not exists boe_licences_be_no_idx on boe_licences (be_no);

-- Index of files in the boe-documents storage bucket: the BOE PDF itself plus
-- any supporting invoice, packing list or certificate of origin.
create table if not exists boe_documents (
  id           bigint generated always as identity primary key,
  be_no        text not null references boes(be_no) on delete cascade,
  doc_type     text,
  file_name    text,
  storage_path text not null,
  uploaded_at  timestamptz not null default now()
);

create index if not exists boe_documents_be_no_idx on boe_documents (be_no);

-- The six cost figures that are estimated at costing time and settle later.
-- One row per BOE. Each carries a value and a 'provisional' | 'fixed' status,
-- which is what the portal colours green or red.
create table if not exists boe_variable_fields (
  be_no                     text primary key references boes(be_no) on delete cascade,
  exchange_rate             numeric,
  exchange_rate_status      text,
  freight_charges           numeric,
  freight_charges_status    text,
  clearing_charges          numeric,
  clearing_charges_status   text,
  supplier_freight          numeric,
  supplier_freight_status   text,
  bank_charges              numeric,
  bank_charges_status       text,
  own_bank_charges          numeric,
  own_bank_charges_status   text,
  updated_at                timestamptz not null default now()
);

-- Audit trail for the above. This is what lets the dashboard show what a
-- figure *was* before it was confirmed, not merely its latest value.
create table if not exists boe_field_history (
  id          bigint generated always as identity primary key,
  be_no       text not null references boes(be_no) on delete cascade,
  field_name  text not null,
  old_value   numeric,
  old_status  text,
  new_value   numeric,
  new_status  text,
  changed_at  timestamptz not null default now()
);

create index if not exists boe_field_history_be_no_idx on boe_field_history (be_no);
