-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 013: Yes Bank debit advice
--
-- An import advance remittance debit advice (uploaded against a BOE once the
-- BOE itself is known -- see boe_debit_advices below) carries the FX rate the
-- bank actually charged, plus bank charges not otherwise on the BOE:
--
--   debit_advice_bank_charges = bill_commission + correspondent_bank_charges
--                                + (gst_on_ccy_fees / 0.18)
--
-- The division recovers the pre-GST base of a currency-conversion spread fee
-- that the advice never prints directly, only its GST. This is kept as its
-- own field, separate from the existing operator-typed bank_charges /
-- own_bank_charges, so the two can coexist and be told apart in the UI and
-- in costing.ts's expense pool.
--
-- Additive and nullable: nothing reads these columns until a debit advice is
-- uploaded, so this is safe to apply before that code ships. Idempotent.
-- ---------------------------------------------------------------------------

alter table boe_variable_fields add column if not exists debit_advice_bank_charges numeric;
alter table boe_variable_fields add column if not exists debit_advice_bank_charges_status text;

comment on column boe_variable_fields.debit_advice_bank_charges is
  'Bill Commission + Correspondent Bank Charges + (GST on CCY Purchase/Sale Fees / 0.18), computed from an uploaded Yes Bank debit advice. Separate from bank_charges/own_bank_charges.';


-- One row per debit advice uploaded against a BOE. This both indexes the
-- Drive file (via boe_documents, doc_type = 'DEBIT_ADVICE') and holds enough
-- of a snapshot to undo the upload: a mistaken upload has to put
-- exchange_rate and debit_advice_bank_charges back exactly where they were,
-- not just to some default.
create table if not exists boe_debit_advices (
  id                              bigint generated always as identity primary key,
  be_no                           text not null references boes(be_no) on delete cascade,
  storage_path                    text not null,  -- Drive file ID, same as boe_documents.storage_path
  file_name                       text,

  bill_amount                     numeric,
  bill_currency                   text,
  fx_rate                         numeric,
  bill_commission                 numeric,
  correspondent_bank_charges      numeric,
  gst_on_ccy_fees                 numeric,
  computed_bank_charges           numeric,

  -- What this was checked against and whether it matched. matched_invoice_total
  -- is boes.inv_value_usd at upload time, kept here rather than re-read later
  -- so the audit trail survives that value later changing on re-parse.
  invoice_value_matched           boolean,
  matched_invoice_total           numeric,
  overridden                      boolean not null default false,

  -- Snapshot of what exchange_rate / debit_advice_bank_charges were
  -- immediately before this upload applied its values -- what "undo" (the
  -- DELETE /boe/{be_no}/debit-advice/{id} endpoint) restores.
  prev_exchange_rate                     numeric,
  prev_exchange_rate_status              text,
  prev_debit_advice_bank_charges         numeric,
  prev_debit_advice_bank_charges_status  text,

  uploaded_at                     timestamptz not null default now()
);

create index if not exists boe_debit_advices_be_no_idx on boe_debit_advices (be_no);

-- Same lockdown as every other import table since sql/005/006: readable by a
-- signed-in user, writable only by the parser's service_role (which bypasses
-- RLS entirely). Without this, the portal's direct Supabase read in
-- actuals.ts (DebitAdviceSection's history table) gets nothing back, not an
-- error -- RLS with no policy denies silently.
alter table boe_debit_advices enable row level security;

drop policy if exists boe_debit_advices_read on boe_debit_advices;
create policy boe_debit_advices_read on boe_debit_advices for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- Verify
--
--   select be_no, bill_amount, fx_rate, computed_bank_charges,
--          invoice_value_matched, overridden
--   from boe_debit_advices order by uploaded_at desc;
-- ---------------------------------------------------------------------------
