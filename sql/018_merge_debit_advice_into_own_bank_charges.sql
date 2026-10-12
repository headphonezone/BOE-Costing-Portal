-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 018: fold debit advice charges into
-- own_bank_charges
--
-- debit_advice_bank_charges (migration 013) stops being a separate field.
-- A debit advice's computed bank charges now write into own_bank_charges --
-- the same field manual entry on the record page already uses (see the
-- "Confirm actual figures" editor) -- rather than a bucket of their own.
-- One field, two ways to fill it, whichever happened most recently wins,
-- the same way exchange_rate already works.
--
-- This moves every BOE's already-confirmed debit_advice_bank_charges value
-- into own_bank_charges before the application code stops reading the old
-- column, so nothing already confirmed silently drops out of costing. The
-- guard (own_bank_charges is null or 0) only migrates where there is
-- nothing to lose by overwriting -- every row on live matched this when
-- checked (76 rows, all either 0 or null) -- but if a row somehow has both
-- a real manual own_bank_charges AND a debit advice applied, it is left
-- alone for manual review rather than silently combined or overwritten.
--
-- debit_advice_bank_charges itself is not dropped (additive-only, as
-- always) -- just stops being written or read by the application. The
-- "Verify" query below should return zero rows after this runs; a nonzero
-- result means a row had a real own_bank_charges value and needs a manual
-- decision about how to combine the two.
-- ---------------------------------------------------------------------------

update boe_variable_fields
set own_bank_charges = debit_advice_bank_charges,
    own_bank_charges_status = debit_advice_bank_charges_status,
    debit_advice_bank_charges = null,
    debit_advice_bank_charges_status = null
where debit_advice_bank_charges is not null
  and (own_bank_charges is null or own_bank_charges = 0);


-- ---------------------------------------------------------------------------
-- Verify
--
--   -- Expect zero rows: anything here needs manual review (see guard above).
--   select be_no, debit_advice_bank_charges, own_bank_charges
--   from boe_variable_fields where debit_advice_bank_charges is not null;
-- ---------------------------------------------------------------------------
