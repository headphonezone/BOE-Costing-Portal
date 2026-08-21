-- Structured fields pulled from supporting documents (Invoice, Packing
-- List, COO, Other) by backend/doc_extract.py. One row per uploaded
-- document, keyed by storage_path (same re-upload dedup key already used
-- by boe_documents).
create table if not exists boe_document_extractions (
  id bigint generated always as identity primary key,
  be_no text not null references boes(be_no) on delete cascade,
  storage_path text not null unique,
  doc_type text not null,
  doc_number text,
  doc_date date,
  total_value numeric,
  currency text,
  total_packages integer,
  gross_weight_kg numeric,
  net_weight_kg numeric,
  certificate_no text,
  origin_country text,
  line_items jsonb,
  raw_text text,
  extracted_at timestamptz not null default now()
);

create index if not exists boe_document_extractions_be_no_idx
  on boe_document_extractions (be_no);
