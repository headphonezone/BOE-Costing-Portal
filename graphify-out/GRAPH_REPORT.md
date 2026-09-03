# Graph Report - .  (2026-08-21)

## Corpus Check
- Corpus is ~29,291 words - fits in a single context window. You may not need a graph.

## Summary
- 359 nodes · 612 edges · 20 communities (15 shown, 5 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.78)
- Token cost: 56,922 input · 8,562 output

## Community Hubs (Navigation)
- BOE PDF Parsing Engine
- Costing Engine and Simulation
- BOE Listing and Input Controls
- TypeScript Compiler Config
- Record Upload and Manual Entry
- Architecture and Known Issues
- BOE Detail and Comparison Views
- Frontend Runtime Dependencies
- Costing Model Design Rationale
- Dev Tooling Dependencies
- Supporting Document Extraction
- Backend Supabase Persistence
- Reference Master Data
- Next.js Root Layout
- Dev Launcher Script
- ESLint Configuration
- Next.js Configuration
- PostCSS Configuration

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `inr` - 15 edges
3. `_parse_boe_pdf()` - 13 edges
4. `SimulationWorkbench()` - 10 edges
5. `computeCosting()` - 10 edges
6. `itemKey()` - 9 edges
7. `resolveActualInputs()` - 9 edges
8. `resolveScenarioInputs()` - 9 edges
9. `usd` - 9 edges
10. `boe_parser.py - ICEGATE PDF to structured data` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Bills of Entry Are Never Committed` --semantically_similar_to--> `No Authentication (open RLS policies)`  [INFERRED] [semantically similar]
  samples/README.md → README.md
- `No Excel Export` --semantically_similar_to--> `openpyxl`  [INFERRED] [semantically similar]
  README.md → backend/requirements.txt
- `BOE Costing Portal` --conceptually_related_to--> `Next.js Agent Rules Block`  [INFERRED]
  README.md → frontend/AGENTS.md
- `python-multipart` --shares_data_with--> `boe_parser.py - ICEGATE PDF to structured data`  [INFERRED]
  backend/requirements.txt → README.md
- `boe_parser.py - ICEGATE PDF to structured data` --conceptually_related_to--> `fastapi`  [INFERRED]
  README.md → backend/requirements.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Landed Cost Computation Chain** — readme_costing_model, readme_expense_pool_apportionment, readme_igst_exclusion, readme_expanded_expense_pool, readme_costing_ts [EXTRACTED 1.00]
- **PDF Upload Pipeline (the only path needing the parser)** — samples_readme_upload_boe_page, readme_boe_parser, backend_requirements_pdfplumber, readme_x_coordinate_extraction, readme_supabase_persistence, readme_api_base_url [EXTRACTED 1.00]
- **Four Confirmed Parser Defects** — readme_parse_scheme_g_bug, readme_watermark_bleed_bug, readme_page_footer_bug, readme_importer_name_missing, readme_parser_bugs [EXTRACTED 1.00]

## Communities (20 total, 5 thin omitted)

### Community 0 - "BOE PDF Parsing Engine"
Cohesion: 0.06
Nodes (52): extract_assess_values_from_pages(), extract_duties_from_page(), _fill_c_sheet(), _fill_d_details(), fill_excel(), format_date(), get_row_words(), get_template_bytes() (+44 more)

### Community 1 - "Costing Engine and Simulation"
Cohesion: 0.09
Nodes (40): ItemPatch, ScenarioItemsTable(), SimulationWorkbench(), buildPool(), compareCosting(), computeActual(), ComputeArgs, computeCosting() (+32 more)

### Community 2 - "BOE Listing and Input Controls"
Cohesion: 0.08
Nodes (25): HomePage(), BoeTable(), EMPTY, Filters, SortDir, SortKey, NumberField(), FREIGHT_BASES (+17 more)

### Community 3 - "TypeScript Compiler Config"
Cohesion: 0.07
Nodes (27): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+19 more)

### Community 4 - "Record Upload and Manual Entry"
Cohesion: 0.14
Nodes (17): Mode, ManualBoeForm(), PdfUploadPanel(), Result, State, boeExists(), createBoeManually(), emptyDraft() (+9 more)

### Community 5 - "Architecture and Known Issues"
Cohesion: 0.11
Nodes (25): fastapi, pdfplumber, python-dotenv, python-multipart, supabase (Python client), uvicorn[standard], NEXT_PUBLIC_API_BASE_URL, sql/000_base_tables.sql is a Reconstruction (+17 more)

### Community 6 - "BOE Detail and Comparison Views"
Cohesion: 0.20
Nodes (18): BoePage(), SimulatePage(), Cell, ComparisonStrip(), CostingTable(), FigureStatus, StatTile(), StatusChip() (+10 more)

### Community 7 - "Frontend Runtime Dependencies"
Cohesion: 0.10
Nodes (19): dependencies, next, react, react-dom, @supabase/supabase-js, name, private, scripts (+11 more)

### Community 8 - "Costing Model Design Rationale"
Cohesion: 0.13
Nodes (19): openpyxl, generate-agent-files.js, Next.js Agent Rules Block, node_modules/next/dist/docs Version Guides, frontend CLAUDE.md - @AGENTS.md include, C-SHEET Excel Template, Landed Costing Model, costing.ts - the costing engine (+11 more)

### Community 9 - "Dev Tooling Dependencies"
Cohesion: 0.11
Nodes (19): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node (+11 more)

### Community 10 - "Supporting Document Extraction"
Cohesion: 0.25
Nodes (13): extract_document(), extract_pdf_text(), _find_after_label(), _find_amount(), _find_date(), parse_coo(), parse_invoice(), parse_other() (+5 more)

### Community 11 - "Backend Supabase Persistence"
Cohesion: 0.15
Nodes (11): delete_boe(), All Supabase access for the backend: saving a fully-parsed BOE, reading it back…, Upserts the structured fields pulled from one supporting document (see…, Permanently deletes a BOE and everything tied to it: item rows, licence rows,…, Converts the two date formats seen in BOE PDFs to ISO (YYYY-MM-DD)., Updates one variable field and logs the change to boe_field_history -- this is…, Upserts the full parsed BOE (header + every item + every licence row) into…, save_boe() (+3 more)

### Community 12 - "Reference Master Data"
Cohesion: 0.22
Nodes (8): CLEARING_AGENTS, CURRENCIES, DELIVERY_TERMS, DUTY_PAYMENT_BASIS, FREIGHT_FORWARDERS, LOCATIONS, PAYMENT_TERMS, SUPPLIERS

## Ambiguous Edges - Review These
- `boe_parser.py - ICEGATE PDF to structured data` → `sql/000_base_tables.sql is a Reconstruction`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `C-SHEET Excel Template` → `openpyxl`  [AMBIGUOUS]
  backend/requirements.txt · relation: conceptually_related_to

## Knowledge Gaps
- **88 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+83 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `boe_parser.py - ICEGATE PDF to structured data` and `sql/000_base_tables.sql is a Reconstruction`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `C-SHEET Excel Template` and `openpyxl`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `inr` connect `BOE Detail and Comparison Views` to `Costing Engine and Simulation`, `BOE Listing and Input Controls`, `Record Upload and Manual Entry`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Dev Tooling Dependencies` to `Frontend Runtime Dependencies`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _88 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `BOE PDF Parsing Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `Costing Engine and Simulation` be split into smaller, more focused modules?**
  _Cohesion score 0.08784313725490196 - nodes in this community are weakly interconnected._