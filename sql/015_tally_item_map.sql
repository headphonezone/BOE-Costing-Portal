-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 015: link BOE items to Tally stock items
--
-- A Bill of Entry names an item the way customs saw it ("Wired Earphone-KZ -
-- Duonic - Silver - Without Switch - 3.5mmMic"); Tally names the same item the
-- way the books do ("KZ - Duonic - 1 - Silver - Without Switch - 3.5mm Mic -
-- In-Ear Headphone"). These tables record which is which, so either name can
-- be looked up from the other.
--
-- How the links were found. The purchase voucher's narration carries the BOE
-- number (Ferrari Video: Purchase Import, Headphone Zone: Purchase). Within
-- that BOE each line is paired with a voucher line on qty and invoice-currency
-- rate, with the item name breaking ties; a BOE line booked as several Tally
-- lines (one per colour), or several BOE lines booked as one, is linked when
-- the quantities add up.
--
--   boe_item_tally_link   one row per BOE line <-> Tally voucher line.
--                         The exact answer for an item already booked.
--   tally_item_map        the alias: supplier + BOE description -> Tally item,
--                         rolled up across every BOE that used it. The lookup
--                         for a new BOE whose description has been seen before.
--   boe_item_tally_lookup every boe_items row with its Tally item(s), if any.
--
-- Keyed on (be_no, invsno, itemsn), not boe_items.id: the parser deletes and
-- re-inserts a BOE's items on every re-upload, so their ids do not survive.
--
-- status: auto      -- qty, rate and name agree
--         review    -- numbers agree but the names disagree (colour, size,
--                      swapped items) or barely overlap
--         confirmed / rejected -- set by a person
--
-- Additive: new objects only, nothing existing is read or changed. Reads need
-- a session, as everywhere since 006; writes are service_role only.
-- Idempotent.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Normalised keys
--
-- Descriptions differ in case and spacing from one BOE to the next; supplier
-- names in punctuation as well ("CO.,LIMITED" / "CO LIMITED"). Both sides of
-- a lookup go through the same function, so they agree by construction.
-- ---------------------------------------------------------------------------
create or replace function tally_map_key(s text) returns text
language sql immutable parallel safe as $$
  select lower(regexp_replace(btrim(coalesce(s, '')), '\s+', ' ', 'g'))
$$;

create or replace function tally_supplier_key(s text) returns text
language sql immutable parallel safe as $$
  select tally_map_key(regexp_replace(coalesce(s, ''), '[.,]', ' ', 'g'))
$$;


-- ---------------------------------------------------------------------------
-- 2. Line-level links
-- ---------------------------------------------------------------------------
create table if not exists boe_item_tally_link (
  id               bigint generated always as identity primary key,
  be_no            text    not null references boes(be_no) on delete cascade,
  invsno           integer not null,
  itemsn           integer not null,
  boe_description  text,              -- as it read when linked, to spot a re-parse that renumbered items
  company          text    not null check (company in ('FV', 'HZ')),
  voucher_type     text    not null,
  voucher_no       text    not null,
  voucher_date     date,
  voucher_line     integer not null,  -- 1-based position in the voucher's inventory entries
  tally_item       text    not null,  -- exact Tally stock item name
  tally_qty        numeric,
  tally_rate       numeric,           -- invoice currency, as booked
  link_kind        text    not null check (link_kind in ('1:1', 'split', 'merge', 'group', 'amount', 'name')),
  status           text    not null default 'auto' check (status in ('auto', 'review', 'confirmed', 'rejected')),
  name_score       numeric,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (be_no, invsno, itemsn, company, voucher_type, voucher_no, voucher_line)
);

create index if not exists boe_item_tally_link_item_idx on boe_item_tally_link (tally_item);
create index if not exists boe_item_tally_link_vch_idx  on boe_item_tally_link (company, voucher_type, voucher_no);

comment on table boe_item_tally_link is
  'Each BOE line linked to the Tally voucher line it was booked as. Keyed on (be_no, invsno, itemsn) because boe_items ids change on re-upload. company: FV = Ferrari Video Chennai, HZ = Headphone Zone Pvt Ltd Chennai.';


-- ---------------------------------------------------------------------------
-- 3. The alias
-- ---------------------------------------------------------------------------
create table if not exists tally_item_map (
  id               bigint generated always as identity primary key,
  supplier_name    text not null,
  supplier_key     text generated always as (tally_supplier_key(supplier_name)) stored,
  boe_description  text not null,
  desc_key         text generated always as (tally_map_key(boe_description)) stored,
  cth              text,
  tally_item       text not null,     -- exact Tally stock item name
  in_fv_master     boolean,           -- exists in Ferrari Video's stock items when loaded
  in_hz_master     boolean,           -- exists in Headphone Zone's stock items when loaded
  booked_in        text[],            -- companies whose vouchers used it: {FV}, {HZ} or both
  link_kind        text,              -- how the evidence linked: 1:1, split, merge, ... ('/'-joined when mixed)
  status           text not null default 'auto' check (status in ('auto', 'review', 'confirmed', 'rejected')),
  evidence_lines   integer not null default 1,
  be_nos           text[],
  name_score       numeric,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (supplier_key, desc_key, tally_item)
);

create index if not exists tally_item_map_lookup_idx on tally_item_map (supplier_key, desc_key);
create index if not exists tally_item_map_item_idx   on tally_item_map (tally_item);

comment on table tally_item_map is
  'Alias: supplier + BOE description -> Tally stock item, rolled up from boe_item_tally_link. Look up with supplier_key = tally_supplier_key(<supplier>) and desc_key = tally_map_key(<description>). One description can map to several items (a BOE line covering several colours).';


-- ---------------------------------------------------------------------------
-- 4. Lookup view: every BOE line, with its Tally item(s) where linked
--
-- security_invoker, so the caller's RLS applies to the tables underneath.
-- ---------------------------------------------------------------------------
create or replace view boe_item_tally_lookup with (security_invoker = true) as
select b.be_no, b.be_date, b.importer_name, b.supplier_name,
       i.invsno, i.itemsn, i.global_sno, i.cth, i.description, i.qty, i.unit_price_usd,
       l.company, l.voucher_type, l.voucher_no, l.voucher_line,
       l.tally_item, l.tally_qty, l.tally_rate, l.link_kind, l.status
from boe_items i
join boes b on b.be_no = i.be_no
left join boe_item_tally_link l
       on l.be_no = i.be_no and l.invsno = i.invsno and l.itemsn = i.itemsn;


-- ---------------------------------------------------------------------------
-- 5. Access
-- ---------------------------------------------------------------------------
alter table boe_item_tally_link enable row level security;
alter table tally_item_map      enable row level security;

drop policy if exists boe_item_tally_link_read on boe_item_tally_link;
create policy boe_item_tally_link_read on boe_item_tally_link for select to authenticated using (true);

drop policy if exists tally_item_map_read on tally_item_map;
create policy tally_item_map_read on tally_item_map for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- Verify
--
--   -- a BOE, line by line
--   select itemsn, description, tally_item, status
--   from boe_item_tally_lookup where be_no = '3702038' order by global_sno;
--
--   -- a new BOE's description
--   select tally_item, status, evidence_lines from tally_item_map
--   where supplier_key = tally_supplier_key('HONGKONG BENCHE TECHNOLOGY CO.,LIMITED')
--     and desc_key = tally_map_key('Wired Earphone - Castor - Bass Version - With Mic');
--
--   -- every BOE description a Tally item has been imported under
--   select supplier_name, boe_description, be_nos from tally_item_map
--   where tally_item = 'KZ - Castor - Black - In-Ear Headphone (Bass Version)';
-- ---------------------------------------------------------------------------
