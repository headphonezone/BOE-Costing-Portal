-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 012: keep misc charges as the invoice
-- stated them
--
-- A BOE prints its misc charges in the invoice's own currency on most records
-- and in rupees on a few; the parser tells the two apart by which reading
-- agrees with the form's own assessable value. Only the rupee result was kept,
-- so the C-SHEET carried a fixed rupee figure that did not move when the
-- exchange rate on the sheet was changed -- unlike every other converted
-- number there.
--
-- This stores the figure as printed, so the workbook can multiply it by its
-- own rate cell. Null, or zero, means the BOE stated its misc charges in
-- rupees and there is nothing to convert. boes.misc_charges_inr stays the
-- rupee total and remains what the costing reads.
--
-- Additive and nullable: nothing reads it until the parser fills it in, so
-- this is safe to apply before the code that writes it ships. Idempotent.
-- ---------------------------------------------------------------------------

alter table boes add column if not exists misc_charges_fc numeric;

comment on column boes.misc_charges_fc is
  'Misc charges in the invoice currency, as printed on the BOE. Null or 0 when the BOE stated them in rupees; boes.misc_charges_inr stays the rupee total.';


-- ---------------------------------------------------------------------------
-- Verify
--
--   select be_no, misc_charges_fc, misc_charges_inr, exchange_rate
--   from boes where misc_charges_inr > 0 order by be_no;
--
-- On a BOE that stated its misc charges in the invoice currency,
-- misc_charges_fc * exchange_rate = misc_charges_inr.
-- ---------------------------------------------------------------------------
