"""
All Supabase access for the backend: saving a fully-parsed BOE, reading it
back for the dashboard, updating variable fields (with history), and
storing supporting documents. Credentials come from environment variables
only -- never hardcoded, since this ships in a container.
"""
import os
import re
from datetime import datetime

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DOCS_BUCKET = "boe-documents"

_client = create_client(SUPABASE_URL, SUPABASE_KEY)


def _to_iso_date(raw: str | None) -> str | None:
    """Converts the two date formats seen in BOE PDFs to ISO (YYYY-MM-DD)."""
    if not raw:
        return None
    raw = raw.strip()
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', raw)  # DD/MM/YYYY
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    mon = {'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
           'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'}
    m = re.match(r'(\d{1,2})-([A-Z]{3})-(\d{2})$', raw.upper())  # DD-MON-YY
    if m:
        return f"20{m.group(3)}-{mon.get(m.group(2), '01')}-{m.group(1).zfill(2)}"
    return None


def save_boe(header: dict, meta: dict, items: list, duties: dict,
             bcd_forgone: dict, licences: list, assess_values: dict) -> str:
    """
    Upserts the full parsed BOE (header + every item + every licence row)
    into Supabase. Returns the BE No used as the key. Nothing here is
    specific to any one BOE's shape -- every field comes from whatever the
    parser actually found on this particular PDF.
    """
    be_no = header.get('be_no') or ''
    if not be_no:
        raise ValueError("No BE No found on this PDF -- cannot save without a key")

    total_duty = sum(
        (duties.get((it['invsno'], it['itemsn']), {}).get('bcd', 0) or 0)
        + (duties.get((it['invsno'], it['itemsn']), {}).get('sws', 0) or 0)
        + (duties.get((it['invsno'], it['itemsn']), {}).get('igst', 0) or 0)
        for it in items
    )
    total_assess_value = sum(assess_values.values()) if assess_values else None

    boe_row = {
        'be_no': be_no,
        'be_date': _to_iso_date(header.get('be_date')),
        'importer_name': meta.get('importer_name'),
        'supplier_name': meta.get('supplier'),
        'inv_no': meta.get('inv_no'),
        'inv_date': _to_iso_date(meta.get('inv_date')),
        'inv_value_usd': meta.get('inv_value'),
        'freight_inr': meta.get('freight'),
        'insurance_inr': meta.get('insurance'),
        'misc_charges_inr': meta.get('misc_charges_inr'),
        'exchange_rate': header.get('exchange_rate'),
        'hawb_no': header.get('hawb_no'),
        'total_assess_value': total_assess_value,
        'total_duty': round(total_duty, 2) if total_duty else None,
        'updated_at': datetime.utcnow().isoformat(),
    }
    _client.table('boes').upsert(boe_row, on_conflict='be_no').execute()

    # Replace this BOE's items/licences wholesale -- re-uploading the same
    # PDF (e.g. after a parser fix) should reflect the latest parse, not
    # accumulate duplicates alongside stale rows.
    _client.table('boe_items').delete().eq('be_no', be_no).execute()
    _client.table('boe_licences').delete().eq('be_no', be_no).execute()

    item_rows = []
    for it in items:
        key = (it['invsno'], it['itemsn'])
        d = duties.get(key, {})
        item_rows.append({
            'be_no': be_no,
            'global_sno': it.get('global_sno'),
            'invsno': it['invsno'],
            'itemsn': it['itemsn'],
            'description': it.get('desc'),
            'unit_price_usd': it.get('price'),
            'qty': it.get('qty'),
            'assess_value': assess_values.get(key) if assess_values else None,
            'bcd': d.get('bcd', 0),
            'bcd_forgone': bcd_forgone.get(key),
            'sws': d.get('sws', 0),
            'igst': d.get('igst', 0),
            'total_duty': round((d.get('bcd', 0) or 0) + (d.get('sws', 0) or 0) + (d.get('igst', 0) or 0), 2),
        })
    if item_rows:
        _client.table('boe_items').insert(item_rows).execute()

    lic_rows = [{
        'be_no': be_no,
        'invsno': lic['invsno'],
        'itemsn': lic['itmsno'],
        'lic_no': lic['lic_no'],
        'debit_duty': lic['debit_duty'],
    } for lic in licences]
    if lic_rows:
        _client.table('boe_licences').insert(lic_rows).execute()

    return be_no


def upload_document(be_no: str, file_name: str, file_bytes: bytes, doc_type: str = 'BOE') -> str:
    """Uploads a supporting document to Storage and indexes it. Returns the storage path."""
    storage_path = f"{be_no}/{doc_type}/{file_name}"
    content_type = "application/pdf" if file_name.lower().endswith(".pdf") else "application/octet-stream"
    _client.storage.from_(DOCS_BUCKET).upload(
        storage_path, file_bytes,
        file_options={"upsert": "true", "content-type": content_type},
    )
    # The Storage file itself upserts cleanly (same path overwrites), but
    # the index row doesn't -- without this, re-uploading the same BOE
    # (e.g. after a parser fix) would pile up duplicate boe_documents rows
    # all pointing at the same storage_path.
    _client.table('boe_documents').delete().eq('be_no', be_no).eq('storage_path', storage_path).execute()
    _client.table('boe_documents').insert({
        'be_no': be_no,
        'doc_type': doc_type,
        'file_name': file_name,
        'storage_path': storage_path,
    }).execute()
    return storage_path


def save_document_extraction(be_no: str, storage_path: str, doc_type: str, fields: dict) -> None:
    """
    Upserts the structured fields pulled from one supporting document (see
    doc_extract.py). Keyed by storage_path -- same re-upload dedup pattern
    as boe_documents, so replacing a document replaces its extraction too
    instead of piling up stale rows.
    """
    row = {
        'be_no': be_no,
        'storage_path': storage_path,
        'doc_type': doc_type,
        **fields,
    }
    _client.table('boe_document_extractions').upsert(row, on_conflict='storage_path').execute()


def delete_boe(be_no: str) -> bool:
    """
    Permanently deletes a BOE and everything tied to it: item rows, licence
    rows, variable fields, field-history entries, the boe_documents index,
    and the underlying files in Storage. Returns False if no such BOE
    exists (caller should 404 rather than pretend anything happened).
    """
    existing = _client.table('boes').select('be_no').eq('be_no', be_no).limit(1).execute().data
    if not existing:
        return False

    # boe_documents already stores the exact storage_path used at upload
    # time, so just delete those known paths instead of re-deriving or
    # walking Storage folders.
    docs = _client.table('boe_documents').select('storage_path').eq('be_no', be_no).execute().data
    paths = [d['storage_path'] for d in docs if d.get('storage_path')]
    if paths:
        _client.storage.from_(DOCS_BUCKET).remove(paths)

    _client.table('boe_field_history').delete().eq('be_no', be_no).execute()
    _client.table('boe_variable_fields').delete().eq('be_no', be_no).execute()
    _client.table('boe_document_extractions').delete().eq('be_no', be_no).execute()
    _client.table('boe_documents').delete().eq('be_no', be_no).execute()
    _client.table('boe_licences').delete().eq('be_no', be_no).execute()
    _client.table('boe_items').delete().eq('be_no', be_no).execute()
    _client.table('boes').delete().eq('be_no', be_no).execute()
    return True


def list_boes() -> list:
    resp = _client.table('boes').select('*').order('updated_at', desc=True).execute()
    return resp.data


def get_boe(be_no: str) -> dict | None:
    boe = _client.table('boes').select('*').eq('be_no', be_no).limit(1).execute().data
    if not boe:
        return None
    items = _client.table('boe_items').select('*').eq('be_no', be_no).order('global_sno').execute().data
    licences = _client.table('boe_licences').select('*').eq('be_no', be_no).execute().data
    documents = _client.table('boe_documents').select('*').eq('be_no', be_no).execute().data
    extractions = _client.table('boe_document_extractions').select('*').eq('be_no', be_no).execute().data
    variable_fields = _client.table('boe_variable_fields').select('*').eq('be_no', be_no).limit(1).execute().data
    history = _client.table('boe_field_history').select('*').eq('be_no', be_no)\
        .order('changed_at', desc=True).execute().data
    extractions_by_path = {e['storage_path']: e for e in extractions}
    for doc in documents:
        doc['extraction'] = extractions_by_path.get(doc['storage_path'])
    return {
        'boe': boe[0],
        'items': items,
        'licences': licences,
        'documents': documents,
        'variable_fields': variable_fields[0] if variable_fields else None,
        'field_history': history,
    }


FIELDS = [
    "exchange_rate", "freight_charges", "clearing_charges",
    "supplier_freight", "bank_charges", "own_bank_charges",
]


def update_field(be_no: str, field_name: str, value: float, status: str) -> None:
    """
    Updates one variable field and logs the change to boe_field_history --
    this is what lets the dashboard always show the provisional value a
    field had before it was marked fixed, not just the latest number.
    """
    if field_name not in FIELDS:
        raise ValueError(f"Unknown field: {field_name}")

    existing = _client.table('boe_variable_fields').select('*').eq('be_no', be_no).limit(1).execute().data
    old_value = existing[0].get(field_name) if existing else None
    old_status = existing[0].get(f'{field_name}_status') if existing else None

    row = {'be_no': be_no, field_name: value, f'{field_name}_status': status}
    _client.table('boe_variable_fields').upsert(row, on_conflict='be_no').execute()

    _client.table('boe_field_history').insert({
        'be_no': be_no,
        'field_name': field_name,
        'old_value': old_value,
        'old_status': old_status,
        'new_value': value,
        'new_status': status,
    }).execute()
