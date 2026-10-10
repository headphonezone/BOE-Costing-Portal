-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 014: SBI debit advice format
--
-- Alongside the Yes Bank import advance remittance debit advice (migration
-- 013), an SBI "Advice of Advance Payment" carries the same two things --
-- an FX rate and bank charges -- but under a different layout and a
-- different charges formula:
--
--   sbi_bank_charges = remittance_charge + swift_charge + mtt_charge
--                       + other_charge + (service_tax_cess_gst / 0.18)
--
-- remittance/swift/mtt/other are each already pre-GST (the AMOUNT (INR)
-- column; the advice separately shows each one's own GST, which is not
-- added here -- same GST-exclusive rule as Yes Bank). Service tax Cess GST
-- has no such breakdown -- the printed figure needs reversing out, the same
-- trick as Yes Bank's GST-on-CCY-fees line.
--
-- bank records which format a row is, so the two sets of bank-specific
-- columns below are never both populated for the same row. Additive and
-- nullable: nothing reads these columns until an SBI advice is uploaded, so
-- this is safe to apply before that code ships. Idempotent.
-- ---------------------------------------------------------------------------

alter table boe_debit_advices add column if not exists bank text not null default 'YES_BANK';

alter table boe_debit_advices add column if not exists remittance_charge numeric;
alter table boe_debit_advices add column if not exists swift_charge numeric;
alter table boe_debit_advices add column if not exists mtt_charge numeric;
alter table boe_debit_advices add column if not exists other_charge numeric;
alter table boe_debit_advices add column if not exists service_tax_cess_gst numeric;

comment on column boe_debit_advices.bank is
  'Which debit advice format this row was parsed as: YES_BANK or SBI. Decides which of the bank-specific columns on this row are populated.';


-- ---------------------------------------------------------------------------
-- Verify
--
--   select be_no, bank, bill_amount, fx_rate, computed_bank_charges
--   from boe_debit_advices order by uploaded_at desc;
-- ---------------------------------------------------------------------------
