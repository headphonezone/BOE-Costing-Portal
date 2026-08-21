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
├── backend/          parser service (Python, FastAPI)
│   ├── main.py             HTTP endpoints
│   ├── boe_parser.py       ICEGATE PDF → structured data  ← the crown jewel
│   ├── supabase_client.py  persistence
│   ├── doc_extract.py      invoice / packing list / COO extraction
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env                credentials (gitignored)
│
├── frontend/         the portal (TypeScript, Next.js 16)
│   ├── src/lib/costing.ts       the costing model  ← read this first
│   ├── src/lib/costing.test.ts  35 tests pinning it down
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
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill in your Supabase project URL and keys. Both files point at the *same*
project. The backend prefers the `service_role` key (it runs server-side and
Storage uploads need it); the frontend must use the `anon` key, because that
one reaches the browser.

**2. Create the database.** Run every file in `sql/` in numeric order in the
Supabase SQL editor. All statements are `if not exists`, so re-running is safe.

**3. Install dependencies.**

```bash
pip install -r backend/requirements.txt
cd frontend && npm install
```

**4. Run it.**

```bash
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1   # Windows
./scripts/dev.sh                                           # macOS / Linux
```

Or start them separately:

```bash
# parser — from this folder
python -m uvicorn backend.main:app --port 8000

# portal — from frontend/
npm run dev
```

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

1. **The expense pool is bigger.** The template computes `I9 = I8+I7+I6+I5`,
   omitting Supplier Freight, Bank Charges and Own Bank Charges — captured in
   `K6:K8`, displayed, then silently dropped from cost per piece. Here they
   are included, so **portal figures read higher than the old spreadsheet**
   wherever those are non-zero. That difference is the bug being fixed.

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
- **Four parser bugs**, confirmed against a real BOE:
  1. `parse_scheme_g` reads an item's **quantity** as its BCD-amount-foregone,
     because the Part III row matches the column shape it looks for. Harmless
     when cash BCD is non-zero; **on a licence-paid BOE it would write the
     wrong BCD.**
  2. The diagonal "ASSESSED COPY" watermark bleeds letters into item
     descriptions (`Super Charger 5AE`).
  3. Page footers get appended to the last description on a page
     (`Playmate 2 RemoSte Page 2 Of 7`).
  4. `importer_name` is never extracted.
- **Margin is computed but not displayed.** `margin_pct` drives
  `sellingPerPiece` / `totalSelling`, which nothing currently renders.
- **No Excel export.** The old Python Excel writer was deliberately not
  carried over; `costing.ts` is the single source of truth for the maths.
- **Scenarios do not version.** Editing one overwrites it.
