# BOE Costing Portal

Look up any import record by reference, see its landed costing, and model
what-if scenarios against it.

Self-contained. Everything needed to run the whole system is in this folder —
both services, all configuration, the database schema, and a sample Bill of
Entry to test with. Nothing outside it is required.

---

## Layout

```
BOE-Costing-Portal/
├── parser/           parser service — its own Vercel project
│   ├── vercel.json         no framework, everything → api/index
│   ├── requirements.txt
│   ├── Dockerfile          run it as a container instead (optional)
│   ├── api/index.py        Vercel entry point
│   └── backend/            the service itself
│       ├── main.py             HTTP endpoints
│       ├── boe_parser.py       ICEGATE PDF → structured data  ← crown jewel
│       ├── supabase_client.py  persistence
│       ├── doc_extract.py      invoice / packing list / COO extraction
│       └── .env                credentials (gitignored)
│
├── frontend/         the portal — its own Vercel project (Next.js 16)
│   ├── src/lib/costing.ts       the costing model  ← read this first
│   ├── src/lib/costing.test.ts  the tests pinning it down
│   ├── src/app/                 pages
│   ├── src/components/          UI
│   └── .env.local               config (gitignored)
│
├── sql/              database schema, run in numeric order
├── samples/          drop a BOE PDF here to test with (gitignored)
└── scripts/          dev.ps1 / dev.sh — start both services
```

---

## Setup

**1. Configure both services.**

```bash
cp parser/backend/.env.example parser/backend/.env
cp frontend/.env.example      frontend/.env.local
```

Fill in your Supabase project URL and keys. Both files point at the *same*
project. The backend prefers the `service_role` key (it runs server-side and
Storage uploads need it); the frontend must use the `anon` key, because that
one reaches the browser.

**2. Create the database.** Run every file in `sql/` in numeric order in the
Supabase SQL editor. All statements are `if not exists`, so re-running is safe.

**3. Install dependencies.**

```bash
pip install -r parser/requirements.txt
cd frontend && npm install
```

**4. Run it.**

```bash
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1   # Windows
./scripts/dev.sh                                           # macOS / Linux
```

Or start them separately:

```bash
# parser — from parser/
python -m uvicorn backend.main:app --port 8000

# portal — from frontend/
npm run dev
```

### Deploying

Two Vercel projects, both from this repo:

| Project | Root Directory | Framework | Config |
| --- | --- | --- | --- |
| portal | `frontend` | Next.js | none — zero-config |
| parser | `parser` | **Other** | `parser/vercel.json` |

Two things forced this shape, both learned the hard way:

1. A Next.js app and a Python function both claim `/api/*`, and inside one
   project Next wins — requests are answered by Next's own 404 and 500 pages
   and never reach Python. The parser needs a project with no framework.
2. A `vercel.json` at the **repository root** is applied to the portal too,
   whatever root directory it is configured with, and a parser config there
   produces an empty portal deployment — `X-Vercel-Error: NOT_FOUND` on every
   path. Adding `frontend/vercel.json` does not shadow it.

Hence `parser/` is entirely self-contained and nothing sits at the repository
root. Neither project can affect the other.

Set `NEXT_PUBLIC_API_BASE_URL` on the portal to the parser's URL, and
`ALLOWED_ORIGINS` on the parser to the portal's. `NEXT_PUBLIC_*` values are
compiled in at build time, so changing one needs a redeploy, not a restart.

Then open the portal. Drop a real BOE PDF into `samples/` and upload it to
check the whole pipeline end to end — see `samples/README.md`. Bills of Entry
are commercial records, so nothing in that folder is committed.

| Command | |
| --- | --- |
| `npm test` (in `frontend/`) | costing engine tests — needs no database |
| `npm run build` | production build |
| `npm run lint` | ESLint |

---

## Why two services

The portal is TypeScript and cannot read a PDF. `boe_parser.py` extracts by
**x-coordinate** with pdfplumber, which is what makes it survive watermark
bleed, OCR spelling variants and multi-invoice numbering. Rewriting that in
TypeScript would mean re-deriving every one of those edge cases.

So one Python process must exist. It is needed for **exactly one action**:

| | Needs the parser? |
| --- | --- |
| **PDF upload** | ✅ the only one |
| Manual entry | ❌ writes straight to Supabase |
| Records list, filters | ❌ |
| Costing, simulations | ❌ |

Manual entry deliberately bypasses the backend — it is the fallback for when
parsing fails, so it must not depend on the thing that failed.

The two connect through one line in `frontend/.env.local`:

```
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Point that anywhere the same code runs — localhost, Cloud Run, another
machine. The portal does not care which.

---

## The costing model

Ported from the C-SHEET of the Excel template the team has always costed
against. Landed cost is **value-proportional apportionment of one expense
pool**:

```
declared INR   Fi = usd_rate × qty × exchange_rate
share          si = Fi / ΣF
expenses/pcs   Hi = expense_pool × si
duty in cost   Gi = BCD + SWS
cost/piece     Ii = (Fi + Gi + Hi) / qty
```

Change any expense and every item's slice moves in proportion. Change an
item's price and the shares themselves are recomputed before the split.

**IGST is excluded from cost** — it is a creditable input tax, so it is cash
flow, not cost. It is still reported separately as part of the cyber receipt.

### Two deliberate departures from the spreadsheet

1. **The expense pool is bigger.** The template shipped with
   `I9 = I8+I7+I6+I5`, omitting Misc Charges (`K5`, labelled "Freight
   Charges - 2") and Supplier Freight, Bank Charges and Own Bank Charges
   (`K6:K8`) — all four captured, displayed, then silently dropped from cost
   per piece. All four are in the pool here, so **figures read higher than the
   original spreadsheet** wherever any is non-zero. That difference is the bug
   being fixed.

   The Excel export writes `I9 = I5+I6+I7+I8+K5+K6+K7+K8`, so the workbook and
   the screen agree. `costing.test.ts` pins that parity — the C-SHEET formulas
   are evaluated by hand there and checked against this engine, because the
   two implementations are shown to the same user from the same page.

### Exporting a simulation

`POST /boe/{be_no}/excel/simulation` returns the **same C-SHEET workbook** the
record page exports for the actual BOE, filled with a scenario's figures. Same
layout, same live formulas; a red banner in `A10` names the scenario so a
what-if can never be mistaken for the actual record.

The maths is not redone server-side. The portal posts the `CostingResult` it
is already displaying and the backend only lays it into the template — the
same reason `costing.ts` is the single source of truth everywhere else. Three
things a scenario needs that an actual BOE does not:

| | |
| --- | --- |
| `margin_pct` | column J, instead of the actual's hardcoded `102%` |
| `other_charges` | `I8`, which an actual BOE has no field for |
| `foc_keys` | cost per piece becomes `=(G+H)/C`, dropping the goods value: an FOC item is paid for by nobody, but its value stays in `F` so it still absorbs freight and duty — mirroring `payableInr` |

`bcd_forgone` is deliberately not passed. `costing.ts` has already resolved
each item's BCD to whichever of cash or licence-foregone applies, so letting
D-DETAILS substitute a foregone amount for a zero BCD would overwrite duty a
scenario waived on purpose.

2. **Duty can float.** The BOE records duty *amounts*, never *rates*, so
   effective rates are back-computed from what customs actually charged. A
   scenario can hold duty **fixed** (the default) or let it **float** with
   value. Switching mode with nothing else changed must not move any number —
   that invariant is a test.

### Scenarios

Every input is nullable and means *inherit the actual*, so a new scenario
reproduces the actual costing exactly until something is deliberately changed.

- **FOC** items keep their declared value in the apportionment base — the
  goods still ship and are still assessed — so freight does not shift onto the
  paid items. A second toggle decides whether duty applies.
- **Duplicated items** are extra rows that exist only in the scenario. They
  always derive duty from their source's rates, *even when duty is fixed*:
  locking a copy to the source's actual amounts would charge the same customs
  payment twice.
- **Freight** can be typed as a total or computed as rate × weight / volume /
  containers. `freight_mode` (Air/Sea/…) is a **label only** — it changes no
  number.

---

## Known gaps

- **No authentication.** RLS is enabled with fully open policies so the portal
  works today. Anyone with the anon key can read and write. Put IAP or
  Supabase Auth in front before this leaves the office.
- **`sql/000_base_tables.sql` is a reconstruction.** Those tables were created
  by hand and their DDL was never checked in anywhere. Column names were read
  back from the live database; types are inferred from the code. Good enough
  to stand up a fresh environment, but verify before trusting it for a
  migration.
- **Margin is computed but not displayed.** `margin_pct` drives
  `sellingPerPiece` / `totalSelling`, which nothing currently renders on
  screen — though both reach the Excel export.
- **`cth` and `uqc` are never populated.** Both are in the schema and in
  `BoeItem`, and the item regex in `parse_page2` already matches them — it
  just doesn't capture them. Nothing displays them either.
- **Supporting-document extraction is heuristic.** `doc_extract.py` is regex
  over arbitrary supplier PDFs with no shared template, so treat its output as
  a hint. `raw_text` is always kept for exactly that reason.
- **`reference-data.ts` is unused.** The supplier master, clearing agents and
  freight forwarders lifted from the F-SHEET are imported nowhere; manual
  entry takes a free-text supplier.
- **Scenarios do not version.** Editing one overwrites it.

## Fixed parser bugs

Seven bugs found against real BOEs and fixed. Kept here because each says
something about the form that the next one will need.

0. **Freight quoted in a foreign currency was read as rupees.** The three
   figures on the valuation row are not all INR, and which ones are varies by
   BOE. The row beneath them says so:

   ```
   43091.68  636.82  4588   DP  Rule 4 - Transaction Value
   14.Cur    USD     USD    INR
   ```

   That row was never read, and freight was taken as INR whatever it said. On
   BE 3168452 that turned USD 636.82 of freight into 636.82 rupees — ₹60,530
   missing from the expense pool of a ₹4.2M consignment, under-costing all 38
   items. It survived because the first sample BOE happened to quote freight
   in INR. `parse_exchange_rates()` now reads every rate the BOE states (it
   prints one per currency in play) and freight and insurance are converted by
   their own stated currency.

   Both sample BOEs now reconcile against the assessable value the form itself
   declares — the check that would have caught this on day one, and the reason
   it is worth keeping: computed vs. `14.ASS. VALUE`, to the paisa.

   **A parser fix does not reach a BOE already in the database.** Parsing
   happens at upload, so a stored record keeps whatever was read at the time;
   re-upload it to pick up the fix. That was not enough on its own either:
   `boe_variable_fields.freight_charges` shadows `boes.freight_inr` in
   `resolveActualInputs`, and `save_boe()` did not touch it, so a corrected
   parse was still overridden by the stale figure. `save_boe()` now calls
   `refresh_provisional_fields()`, which brings any field still marked
   *provisional* back in line with the new parse and logs the change to
   `boe_field_history`. Fields marked *fixed* have been confirmed by a person
   and are never overwritten.

1. **Bleed from the page furniture.** The form prints all its content between
   7pt and 14pt. Two things outside that band land in the text layer anyway:
   the diagonal "ASSESSED COPY" watermark at ~51–57pt, and the section labels
   printed sideways down the margins, which arrive as single stacked
   characters at 2.2–6.9pt. Both fuse with real tokens — `Charger 5A` read as
   `Charger 5AE`, `Remote` as `RemoSte`, licence numbers as `2607E000174`, and
   `Type-C Cable` trailed by `T E.E D M`. Once fused, no text matching can
   separate them. `strip_watermark()` keeps only characters inside the body
   band, *before* they are assembled into words, so no parser downstream has
   to guess. Everything now reads from `extract_clean_text()`.

2. **A workaround that ate real letters.** Sideways-label bleed used to be
   swept up by deleting every lone capital from a description. That also
   deleted real ones: `Type C - Mic` became `Type - Mic` and `Type-C Cable`
   became `Type-Cable`, collapsing the Type-C and 3.5mm variants of the same
   earphone into identical descriptions on a 38-item BOE. Filtering by
   character size removes the bleed at its source, so the strip is gone.

3. **Quantity recorded as assessable value.** `extract_assess_values_from_pages`
   took the first row after an item carrying two numbers of three digits or
   more. An item declared `250 PCS 250 NOS` puts two such numbers on its
   *quantity* row, and being the earlier row it won — so eight items on BE
   3168452 recorded their quantity as their assessable value. Rows carrying a
   unit code are now skipped: that is what makes a row a quantity row, and
   29.ASSESS VALUE never sits on one.
4. **`parse_scheme_g` invented duty.** It matched Section G's column shape
   across every page, and a Part III item row has that same shape — invsno and
   itmsno in the same columns, `NOEXCISE` where the scheme name goes, and any
   number in the description landing in the amount column. On the sample it
   produced a BCD-foregone of `2.0` from the "02" in *Silent Power 02 Power
   Modules*, on a BOE whose Section G is empty. Harmless while cash BCD is
   non-zero, but on a licence-paid BOE — the only kind where Section G matters
   — it would have written a description fragment in as the real BCD. Now
   confined to the Section G band, tracked across pages.
5. **Page footers ran into descriptions** (`Playmate 2 Remote Page 2 Of 7`).
   The last item on a page has no next-item line to stop at, so the
   continuation loop now also stops at `Page N Of M` and the ICETRAK line.
6. **`importer_name` was never extracted.** `save_boe()` read a key no parser
   ever set, so the column was null on every record ever saved.
   `parse_importer()` reads Part I's "1.IMPORTER NAME & ADDRESS".
