# BOE Costing Portal — User Guide

Look up any import record by reference, see what each item actually cost to
land, and model what-if scenarios against it.

Everything on screen is derived from the Bill of Entry itself. You upload the
ICEGATE PDF once; the portal reads it and does the rest.

## The three screens

| Screen | What it is for |
| --- | --- |
| **Import records** (home) | every BOE on file, filterable and sortable |
| **Record** | one BOE: its shipment facts, its actual landed costing, its licences and documents |
| **Simulate** | what-if scenarios costed against that record, side by side |

## 1. Uploading a Bill of Entry

From the records list, choose **+ Upload BOE**, then drag the ICEGATE PDF onto
the panel or click to browse. PDF only.

Reading takes a few seconds — a long BOE with several invoices takes longer.
When it finishes you are told the BE number and how many items and licence
rows were saved, with a button to open the record.

**Re-uploading the same BOE is safe.** Its items and licences are replaced,
not duplicated. This is how you pick up a parser improvement on a record that
was imported earlier: parsing happens at upload, so a stored record keeps
whatever was read at the time.

Two things worth knowing:

- Figures you have **confirmed** as actual are never overwritten by a
  re-upload. Anything still marked provisional is brought in line with the new
  parse.
- If the upload fails with *could not reach the parser service*, the reader
  service is down rather than the file being bad. Running locally, start it
  and try again; on the deployed site there is nothing for you to start — a
  very large or scanned PDF is the usual cause.

## 2. Finding a record

The records list shows supplier, BOE number, date and invoice value, ten rows
to a page, newest first.

- **Filter** in the row of boxes under the headings: supplier name and BOE
  number match on any part of the text; date and value are ranges, and you can
  fill in just one end. Filters combine.
- **Sort** by clicking any column heading; click again to reverse it. Records
  with no date sort last either way.
- **Clear filters** appears once any filter is set, and the count above the
  table reads *n records of m*, so you always know how much is hidden.

Click a row to open the record.

## 3. Reading a record

The six tiles across the top are the headline figures: exchange rate, invoice
value, freight, other expenses, duty in cost, and average cost per piece with
the total quantity beneath it.

**Green means confirmed, red means provisional.** Exchange rate and freight
are the two figures routinely estimated at costing time that settle later, so
each carries its status. Red is not an error — it means nobody has yet
confirmed that number is the one finally paid. Silence is not confirmation, so
anything never marked as actual reads as provisional.

Below the tiles:

- **Shipment** — supplier, invoice number and date, BE date, AWB / HAWB,
  importer.
- **Actual costing** — one row per item, with quantity, rate, freight prorata,
  duty in cost, expenses, landed total and cost per piece, totalled at the
  foot. Freight is its own column rather than folded into expenses, so freight
  impact is readable on its own.
- **Licences** — the licence rows the item duty was debited against, with the
  total debited in the heading. Shown only when the BOE has them.
- **Documents** — the BOE PDF and any supporting files. Links are signed and
  expire an hour after the page loads; reload the page to renew them.

**View BOE PDF** opens the source document every figure was read from — reach
for it whenever a number looks wrong. **Download Excel** gives you the C-SHEET
workbook with live formulas.

### What "duty in cost" includes

BCD and SWS. **IGST is deliberately excluded**: it is a creditable input tax,
so it is cash flow rather than cost. It is still reported separately.

Expenses are apportioned by value, not spread evenly: each item takes a share
of one expense pool in proportion to its declared value. Change any expense
and every item's slice moves in proportion.

## 4. Running a simulation

Open a record and choose **Simulate costing**.

A new scenario **starts as an exact copy of the actual costing** — every input
is empty, and empty means *inherit the actual*. Only what you deliberately
change moves a number, so any difference you see is a difference you made.

**1. Create.** Choose **+ New simulation**. The inputs panel opens on the left.

**2. Set the inputs.** The tables update as you type.

| Control | What it does |
| --- | --- |
| Name, Notes | how the scenario is labelled everywhere, and what it is testing |
| **Duty: Fixed** (default) | duty stays at exactly what customs charged, whatever else changes |
| **Duty: Float with value** | duty is recomputed from this BOE's effective rates, so a price or exchange-rate change moves it too |
| Exchange rate | INR per USD |
| Freight mode | Air / Sea / Road / Courier / Other — **a label only; it changes no figure** |
| Freight basis | lump sum, or per kg / per CBM / per container |
| Freight rate × quantity | fill in **both** and the total is computed for you and overrides the typed total; fill in one and your typed total still stands |
| Other expenses | insurance, clearance, misc (freight 2), supplier freight, bank charges, own bank charges, others |
| Margin % | feeds the selling-price columns of the Excel export; it is not shown in the on-screen tables |

The green / red tick under exchange rate and freight marks that figure as a
confirmed actual rather than the provisional one carried over from the BOE.

**3. Adjust individual items** in the *Item adjustments* table. An empty price
or quantity box shows the actual as its placeholder, so an untouched row still
reads as the number it will use.

- **Rate / Qty** — type over either to override just that item.
- **FOC** — marks an item free of charge. Its declared value stays in the
  apportionment base, because the goods still ship and are still assessed, so
  freight does not shift onto the paid items. A second tick decides whether
  duty still applies to it.
- **Duplicate** — adds an extra row that exists only in this scenario, with
  its own description, price and quantity. Its duty always derives from the
  row it was copied from, even when duty is fixed: locking a copy to the
  original's amounts would charge the same customs payment twice.
- **Reset** — drops your overrides on that row and returns it to the actual.

**4. Save.** An amber dot on the tab and an *unsaved* badge mark changes not
yet stored. Unsaved changes still appear in every table and comparison, so
what you compare is always what is on screen. **Close inputs** folds the panel
away and keeps your changes; **Save** stores them. Editing a saved scenario
overwrites it — scenarios do not keep a version history.

**5. Compare.** The strip at the top shows the scenario against the actual:
average cost per piece, landed total, exchange rate, freight prorata, duty in
cost, expenses and goods payable, each with its change. Red is more expensive,
green is cheaper. The **All scenarios** table at the foot lists the actual and
every scenario together.

**Duplicate** copies a whole scenario as the starting point for the next
variant. **Delete** removes it, and asks first.

### If a scenario says "duty locked"

An item with no assessable value on record has nothing to back-compute a duty
rate from. Rather than report nil duty, the portal holds that item at its
actual duty and tells you how many items are affected.

## 5. Exporting

**Download Excel** on a record gives the actual costing as the C-SHEET
workbook. The same button on a simulation gives that scenario in **the same
workbook, the same layout, the same live formulas** — with a red banner naming
the scenario, so a what-if can never be mistaken for the actual record.

## 6. If a figure looks wrong

1. Open **View BOE PDF** and check the figure on the form. Everything on the
   record was read from it.
2. Check whether the figure is marked **provisional** — it may simply not have
   been confirmed yet.
3. If the parser misread the form, re-upload the BOE once the fix is in; a fix
   does not reach records already stored.
4. Costs read slightly higher than the old spreadsheet on some BOEs. That is
   expected, and it is a fix: misc charges, supplier freight, bank charges and
   own bank charges were captured and displayed by the spreadsheet but left
   out of its cost-per-piece formula. All four are in the pool here.
