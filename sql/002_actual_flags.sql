-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 002
--
-- Adds the provisional / actual marker to a scenario's exchange rate and
-- freight, and makes fixed duty the default.
--
-- Additive and idempotent. Safe to run on a database that already has
-- 001_scenarios.sql applied.
-- ---------------------------------------------------------------------------

-- Exchange rate and freight are the two figures that are routinely estimated
-- at the time of costing and only settle later. These flags record which
-- state each one is in, so a scenario can never quietly present an estimate
-- as a settled number.
--   false (default) -- provisional, taken from the BOE
--   true            -- the actual cost, confirmed
alter table boe_scenarios
  add column if not exists exchange_rate_is_actual boolean not null default false;

alter table boe_scenarios
  add column if not exists freight_is_actual boolean not null default false;


-- Duty is what customs actually charged. Holding it fixed while other inputs
-- move is the behaviour that matches how the team reasons about a shipment,
-- so it is now the default for a new scenario. Existing scenarios keep
-- whatever mode they were saved with.
alter table boe_scenarios
  alter column duty_mode set default 'locked';
