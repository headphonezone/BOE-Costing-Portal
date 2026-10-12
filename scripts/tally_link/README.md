# Tally item lookup

Links each BOE line in the portal to the Tally stock item it was booked as,
so either name can be looked up from the other. The tables come from
[`sql/015_tally_item_map.sql`](../../sql/015_tally_item_map.sql); this folder
fills them.

| | |
|---|---|
| `boe_item_tally_link` | one row per BOE line ↔ Tally voucher line |
| `tally_item_map` | the alias: supplier + BOE description → Tally item |
| `boe_item_tally_lookup` | view: every BOE line with its Tally item(s) |

## Refreshing

Run it after new BOEs are uploaded and their purchases are booked in Tally:

```
python scripts/tally_link/refresh.py            # dry run: report only
python scripts/tally_link/refresh.py --apply    # load into Supabase
```

Needs, on the same machine:

- **TallyPrime** on `:9000` with the current year's Ferrari Video and
  Headphone Zone companies open. Every open company whose name starts with
  either is read.
- **Supabase CLI**, logged in (`supabase login`). Queries go through the CLI's
  Management API login, so no key file is involved.

Python 3.10+, standard library only. Reading Headphone Zone's purchase
vouchers takes about five minutes. `--cache DIR` keeps Tally's raw XML so a
second run (say, the `--apply` after a dry run) skips the wait. Delete the
folder to read fresh.

Re-running is safe. Rows marked `confirmed` or `rejected` are never
overwritten. A BOE's old links are replaced only when its vouchers were found
this run, so a past year that is no longer open in Tally keeps its links.

## How a line is linked

1. **Voucher.** The BOE number in the narration (`BOE no: 3702038`,
   `BE No :8491577`, `BE.NO ;` ...). If the number is missing, or names a BOE
   the lines don't fit, the voucher goes to the BOE whose supplier, date
   (±30 days) and line qtys and rates match.
2. **Lines.** Equal qty and invoice-currency rate first, with the name
   breaking ties. A BOE line booked as one Tally line per colour (`split`),
   several BOE lines booked as one (`merge`), and the same amount in different
   units (`amount`) are linked when the figures add up. See
   [`matcher.py`](matcher.py).

Only links the matcher can stand behind are saved (`status = 'auto'`). A pair
whose numbers agree but whose names don't -- a different colour, size, plug or
mic, or two items whose numbers look swapped -- is a review match: the run
counts it and leaves that BOE line unlinked. Likewise a BOE description linked
to different Tally items on different BOEs gets no alias row, since it can't
say which one a new BOE means.

The dry run also lists vouchers worth a look: a narration naming the wrong
BOE, a narration with no BOE number, and imports whose BOE isn't in the portal.

## Looking things up

```sql
-- a BOE, line by line
select itemsn, description, tally_item, status
from boe_item_tally_lookup where be_no = '3702038' order by global_sno;

-- a new BOE's description -> Tally item
select tally_item, status from tally_item_map
where supplier_key = tally_supplier_key('HONGKONG BENCHE TECHNOLOGY CO.,LIMITED')
  and desc_key     = tally_map_key('Wired Earphone - Castor - Bass Version - With Mic');

-- a Tally item -> every BOE description it was imported under
select supplier_name, boe_description, be_nos from tally_item_map
where tally_item = 'KZ - Castor - Black - In-Ear Headphone (Bass Version)';
```

Descriptions repeat less than you'd hope: only about 15% of BOE lines reuse
a description from an earlier BOE word for word. For a BOE already booked,
`boe_item_tally_lookup` is the exact answer. `tally_item_map` is for
pre-filling a new one.
