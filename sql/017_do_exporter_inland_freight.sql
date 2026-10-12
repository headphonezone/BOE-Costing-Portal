-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 017: DO Charges and Exporter Inland Freight
--
-- Two new expense-pool fields, same pattern as supplier_freight/bank_charges:
-- a confirmable actual-costing field (boe_variable_fields, provisional/fixed
-- like every other one) and a scenario override column that inherits from it
-- when null. Despite being entered in the simulation form's Freight section,
-- both count toward the general expense pool (Expenses column), not the
-- freight bucket -- same as Supplier Freight already does.
--
-- Additive and nullable: nothing reads these columns until the app writes to
-- them, so this is safe to apply before that code ships. Idempotent.
-- ---------------------------------------------------------------------------

alter table boe_variable_fields add column if not exists do_charges numeric;
alter table boe_variable_fields add column if not exists do_charges_status text;
alter table boe_variable_fields add column if not exists exporter_inland_freight numeric;
alter table boe_variable_fields add column if not exists exporter_inland_freight_status text;

comment on column boe_variable_fields.do_charges is
  'Delivery Order charges. Operator-typed actual-costing field, provisional/fixed like freight_charges etc.';
comment on column boe_variable_fields.exporter_inland_freight is
  'Freight the exporter incurs inland before export. Operator-typed actual-costing field, provisional/fixed like freight_charges etc.';

alter table boe_scenarios add column if not exists do_charges_inr numeric;
alter table boe_scenarios add column if not exists exporter_inland_freight_inr numeric;


-- ---------------------------------------------------------------------------
-- Verify
--
--   select be_no, do_charges, do_charges_status,
--          exporter_inland_freight, exporter_inland_freight_status
--   from boe_variable_fields where do_charges is not null or exporter_inland_freight is not null;
-- ---------------------------------------------------------------------------
