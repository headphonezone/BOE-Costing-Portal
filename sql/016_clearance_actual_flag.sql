-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 016: provisional / actual marker on a
-- scenario's clearance
--
-- Clearance joins exchange rate and freight (migration 002) as a figure that
-- is estimated at the time of costing and only settles later: with nothing
-- entered it is costed at the 10,000 default (DEFAULT_CLEARANCE_INR in
-- frontend/src/lib/costing.ts), which is a guess until the clearing agent's
-- bill arrives. The flag records which state it is in, so a scenario never
-- presents that guess as a settled number.
--   false (default) -- provisional
--   true            -- the actual cost, confirmed
--
-- Display-only, like the other two: it changes how the number is presented,
-- never how it is calculated.
--
-- Additive and idempotent. Apply BEFORE deploying the portal code that reads
-- it, or saving a scenario fails on the unknown column.
-- ---------------------------------------------------------------------------

alter table boe_scenarios
  add column if not exists clearance_is_actual boolean not null default false;
