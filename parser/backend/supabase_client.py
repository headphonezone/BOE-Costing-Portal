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

from . import drive_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

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
        'importer_name': header.get('importer_name') or meta.get('importer_name'),
        'supplier_name': meta.get('supplier'),
        'inv_no': meta.get('inv_no'),
        'inv_date': _to_iso_date(meta.get('inv_date')),
        'inv_value_usd': meta.get('inv_value'),
        'freight_inr': meta.get('freight'),
        'insurance_inr': meta.get('insurance'),
        'misc_charges_inr': meta.get('misc_charges_inr'),
        'misc_charges_fc': meta.get('misc_charges_fc'),
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
            'cth': it.get('cth'),
            'uqc': it.get('uqc'),
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

    # Re-uploading after a parser fix has to reach the figures the dashboard
    # actually costs against, not just boes.*.
    refresh_provisional_fields(
        be_no,
        exchange_rate=header.get('exchange_rate'),
        freight_charges=meta.get('freight'),
    )

    return be_no


# The variable fields the parser itself derives from the BOE. The rest
# (clearing charges, bank charges, ...) are only ever typed in by an operator,
# so a re-parse has nothing to say about them.
_PARSED_FIELDS = ('exchange_rate', 'freight_charges')


def refresh_provisional_fields(be_no: str, exchange_rate=None, freight_charges=None) -> list:
    """
    Brings the operator-facing variable fields back in line with a fresh parse.

    A field still marked 'provisional' holds whatever the parser last read and
    nobody has confirmed it, so re-parsing the same BOE -- which is what
    re-uploading after a parser fix is for -- should correct it. A field marked
    'fixed' has been confirmed by a person against the real paperwork and is
    never overwritten here.

    Without this a parser fix could never reach a BOE that had already been
    uploaded. resolveActualInputs() reads boe_variable_fields.freight_charges
    in preference to boes.freight_inr, so a stale provisional figure shadows
    the corrected parse permanently -- which is exactly what happened to BE
    3168452, where a re-upload alone would have left the wrong freight in
    place. Returns the field names actually changed.
    """
    existing = _client.table('boe_variable_fields').select('*').eq('be_no', be_no).limit(1).execute().data
    if not existing:
        # Nothing is shadowing the parsed values, so there is nothing to
        # correct. Deliberately not creating a row: absence already means
        # "use what the BOE says".
        return []

    row = existing[0]
    incoming = {'exchange_rate': exchange_rate, 'freight_charges': freight_charges}
    changed = []

    for field in _PARSED_FIELDS:
        value = incoming.get(field)
        if value is None:
            continue
        if row.get(f'{field}_status') == 'fixed':
            continue
        old = row.get(field)
        if old is not None and abs(float(old) - float(value)) < 0.005:
            continue
        # Goes through update_field so the change lands in boe_field_history
        # like every other edit, rather than silently mutating the row.
        update_field(be_no, field, float(value), 'provisional')
        changed.append(field)

    return changed


def upload_document(be_no: str, file_name: str, file_bytes: bytes, doc_type: str = 'BOE') -> str:
    """
    Uploads a supporting document to Google Drive and indexes it. Returns the
    Drive file ID (stored in boe_documents.storage_path -- the column name
    predates the Drive move and still means "where the file lives").
    """
    storage_path = drive_client.upload_document(be_no, file_name, file_bytes, doc_type)
    # drive_client.upload_document already replaces the Drive file in place
    # on a re-upload, but the index row doesn't dedup itself -- without this,
    # re-uploading the same BOE (e.g. after a parser fix) would pile up
    # duplicate boe_documents rows all pointing at the same storage_path.
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
    and the underlying files in Drive (trashed there, not permanently
    deleted -- see drive_client.trash_document). Returns False if no such
    BOE exists (caller should 404 rather than pretend anything happened).
    """
    existing = _client.table('boes').select('be_no').eq('be_no', be_no).limit(1).execute().data
    if not existing:
        return False

    # boe_documents already stores the exact Drive file ID used at upload
    # time, so just trash those known IDs instead of re-deriving them.
    docs = _client.table('boe_documents').select('storage_path').eq('be_no', be_no).execute().data
    for doc in docs:
        if doc.get('storage_path'):
            drive_client.trash_document(doc['storage_path'])

    _client.table('boe_field_history').delete().eq('be_no', be_no).execute()
    _client.table('boe_variable_fields').delete().eq('be_no', be_no).execute()
    _client.table('boe_document_extractions').delete().eq('be_no', be_no).execute()
    _client.table('boe_documents').delete().eq('be_no', be_no).execute()
    _client.table('boe_licences').delete().eq('be_no', be_no).execute()
    _client.table('boe_items').delete().eq('be_no', be_no).execute()
    _client.table('boes').delete().eq('be_no', be_no).execute()
    return True


def get_document_by_storage_path(storage_path: str) -> dict | None:
    """
    Looks up a boe_documents row by its Drive file ID, so the view/download
    endpoint only ever streams a file this app actually indexed -- not an
    arbitrary Drive file ID someone might guess or pass in.
    """
    rows = _client.table('boe_documents').select('*').eq('storage_path', storage_path).limit(1).execute().data
    return rows[0] if rows else None


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
    debit_advices = _client.table('boe_debit_advices').select('*').eq('be_no', be_no)\
        .order('uploaded_at', desc=True).execute().data
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
        'debit_advices': debit_advices,
    }


FIELDS = [
    "exchange_rate", "freight_charges", "clearing_charges",
    "supplier_freight", "bank_charges", "own_bank_charges",
    "do_charges", "exporter_inland_freight",
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


# Yes Bank prints the GST charged on the currency-conversion spread fee but
# never the fee itself, so it's recovered by dividing the GST back out.
GST_RATE = 0.18

# How far the running total of every debit advice on a BOE (this upload
# included) may exceed the invoice value (boes.inv_value_usd, already summed
# across every invoice on a multi-invoice BOE) before it counts as a
# mismatch. Kept tiny rather than the ~2.0 tolerance used elsewhere in the
# parser: a genuine overpayment should never happen, so anything looser would
# wave through a wrong BOE or a duplicate upload. Being UNDER the invoice
# value is never a mismatch -- an advance is supposed to be partial, with a
# balance payment (another debit advice) expected later.
INVOICE_VALUE_MATCH_TOLERANCE = 0.01


def compute_debit_advice_charges(fields: dict, bank: str = 'YES_BANK') -> float | None:
    """
    Yes Bank: Bill Commission + Correspondent Bank Charges + (GST on CCY
    Purchase/Sale Fees / 0.18).

    SBI: Remittance + SWIFT + MTT + Other charges (each already pre-GST) +
    (Service tax Cess GST / 0.18) -- that line has no separate GST
    breakdown of its own, so the printed figure needs the same reversal.

    None if the one GST-flavoured figure each formula can't do without
    wasn't found on the document.
    """
    if bank == 'SBI':
        service_tax = fields.get('service_tax_cess_gst')
        if service_tax is None:
            return None
        remittance = fields.get('remittance_charge') or 0.0
        swift = fields.get('swift_charge') or 0.0
        mtt = fields.get('mtt_charge') or 0.0
        other = fields.get('other_charge') or 0.0
        return round(remittance + swift + mtt + other + (service_tax / GST_RATE), 2)

    gst_ccy = fields.get('gst_on_ccy_fees')
    if gst_ccy is None:
        return None
    bill_commission = fields.get('bill_commission') or 0.0
    correspondent = fields.get('correspondent_bank_charges') or 0.0
    return round(bill_commission + correspondent + (gst_ccy / GST_RATE), 2)


def check_invoice_value_match(be_no: str, bill_amount: float | None) -> tuple[bool, float | None, float | None]:
    """
    Compares the RUNNING TOTAL of every debit advice on this BOE -- every one
    already saved, plus the one about to be (bill_amount) -- against the
    BOE's invoice value. A partial advance is expected to land under that
    total, with a balance payment (another debit advice) following later, so
    only exceeding it counts as a mismatch -- most likely a wrong BOE or a
    duplicate upload, not a normal partial payment.

    Returns (matched, invoice_total, running_total) so the caller can show
    the actual numbers in a mismatch warning.
    """
    boe = _client.table('boes').select('inv_value_usd').eq('be_no', be_no).limit(1).execute().data
    invoice_total = boe[0].get('inv_value_usd') if boe else None

    existing = _client.table('boe_debit_advices').select('bill_amount').eq('be_no', be_no).execute().data
    existing_total = sum(r.get('bill_amount') or 0.0 for r in existing)

    if bill_amount is None or invoice_total is None:
        return False, invoice_total, existing_total

    running_total = round(existing_total + bill_amount, 2)
    matched = running_total <= invoice_total + INVOICE_VALUE_MATCH_TOLERANCE
    return matched, invoice_total, running_total


def _debit_advice_aggregates(be_no: str) -> tuple[float | None, float]:
    """
    The combined exchange rate and bank charges across every debit advice
    currently on this BOE: a simple average of fx_rate (one advance at one
    rate, a balance payment at another, blended evenly) and a plain sum of
    computed_bank_charges (every advice's bank charges add up, they don't
    overwrite each other). (None, 0.0) when no advices remain -- the caller
    then falls back to the BOE's own parsed rate, same as if no debit advice
    had ever been uploaded.
    """
    rows = _client.table('boe_debit_advices').select('fx_rate,computed_bank_charges').eq('be_no', be_no).execute().data
    rates = [r['fx_rate'] for r in rows if r.get('fx_rate') is not None]
    avg_rate = round(sum(rates) / len(rates), 4) if rates else None
    total_charges = round(sum(r.get('computed_bank_charges') or 0.0 for r in rows), 2)
    return avg_rate, total_charges


def _apply_debit_advice_aggregates(be_no: str) -> None:
    """
    Recomputes the combined exchange rate / bank charges from whatever debit
    advices currently exist for this BOE and writes them as the confirmed
    ('fixed') variable fields -- called after every upload and every undo, so
    the two are always rebuilt from the current set rather than patched
    incrementally.

    The charges total writes to own_bank_charges -- the same field manual
    entry on the BOE record page uses, not a separate debit-advice-only
    bucket. One field, two ways to fill it; whichever happened most recently
    wins, same as exchange_rate already works. (A one-time migration moved
    every BOE's existing debit_advice_bank_charges into own_bank_charges
    before this changed -- see sql/018_merge_debit_advice_into_own_bank_charges.sql.)
    """
    avg_rate, total_charges = _debit_advice_aggregates(be_no)
    if avg_rate is not None:
        update_field(be_no, 'exchange_rate', avg_rate, 'fixed')
    else:
        _restore_field(be_no, 'exchange_rate', None, None)
    if total_charges:
        update_field(be_no, 'own_bank_charges', total_charges, 'fixed')
    else:
        _restore_field(be_no, 'own_bank_charges', None, None)
    _sync_final_scenarios_exchange_rate(be_no, avg_rate is not None)


def _sync_final_scenarios_exchange_rate(be_no: str, confirmed: bool) -> None:
    """
    A "Final" simulation is meant to track the real costing, so it follows
    the actual exchange rate automatically rather than needing anyone to
    re-type it: cleared back to inherit (null) and marked actual once a
    debit advice confirms the rate, un-marked again if every debit advice on
    the BOE is later undone and the actual reverts to unconfirmed. Matches
    scenario name by substring, case-insensitive ("Simulation Final",
    "SIMULATION FINAL", "Final", ...) -- scenarios not named like that are
    untouched, so an in-progress draft never gets silently overwritten.
    """
    scenarios = _client.table('boe_scenarios').select('id,name').eq('be_no', be_no).execute().data
    final_ids = [s['id'] for s in scenarios if 'final' in (s.get('name') or '').lower()]
    if not final_ids:
        return
    patch = {'exchange_rate_is_actual': confirmed}
    if confirmed:
        patch['exchange_rate'] = None
    for sid in final_ids:
        _client.table('boe_scenarios').update(patch).eq('id', sid).execute()


def _restore_field(be_no: str, field_name: str, prev_value, prev_status) -> None:
    """
    Puts one variable field back to exactly what it held before a debit
    advice overwrote it -- including back to no value at all, which
    update_field can't express since it always writes a concrete number.
    Absence here means what it means everywhere else in this module:
    nothing is shadowing the parsed BOE value.
    """
    existing = _client.table('boe_variable_fields').select('*').eq('be_no', be_no).limit(1).execute().data
    old_value = existing[0].get(field_name) if existing else None
    old_status = existing[0].get(f'{field_name}_status') if existing else None

    row = {'be_no': be_no, field_name: prev_value, f'{field_name}_status': prev_status}
    _client.table('boe_variable_fields').upsert(row, on_conflict='be_no').execute()

    _client.table('boe_field_history').insert({
        'be_no': be_no, 'field_name': field_name,
        'old_value': old_value, 'old_status': old_status,
        'new_value': prev_value, 'new_status': prev_status,
    }).execute()


def save_debit_advice(be_no: str, storage_path: str, file_name: str, bank: str, fields: dict,
                       computed_bank_charges: float, matched: bool, invoice_total: float | None,
                       overridden: bool) -> dict:
    """
    Records the debit advice (one of possibly several on this BOE -- an
    advance and a later balance payment both land here, each possibly a
    different bank's format), snapshots whatever exchange_rate /
    own_bank_charges happened to hold just before this insert (kept for
    audit only -- undo no longer restores from this, see undo_debit_advice),
    then rebuilds both fields from every debit advice now on the BOE:
    exchange_rate becomes the average fx_rate across all of them,
    own_bank_charges the sum of all their charges (see
    _apply_debit_advice_aggregates for why own_bank_charges and not a
    separate field).
    """
    existing = _client.table('boe_variable_fields').select('*').eq('be_no', be_no).limit(1).execute().data
    row = existing[0] if existing else {}

    advice_row = {
        'be_no': be_no,
        'bank': bank,
        'storage_path': storage_path,
        'file_name': file_name,
        'bill_amount': fields.get('bill_amount'),
        'bill_currency': fields.get('bill_currency'),
        'fx_rate': fields.get('fx_rate'),
        # Yes Bank fields -- None on an SBI row.
        'bill_commission': fields.get('bill_commission'),
        'correspondent_bank_charges': fields.get('correspondent_bank_charges'),
        'gst_on_ccy_fees': fields.get('gst_on_ccy_fees'),
        # SBI fields -- None on a Yes Bank row.
        'remittance_charge': fields.get('remittance_charge'),
        'swift_charge': fields.get('swift_charge'),
        'mtt_charge': fields.get('mtt_charge'),
        'other_charge': fields.get('other_charge'),
        'service_tax_cess_gst': fields.get('service_tax_cess_gst'),
        'computed_bank_charges': computed_bank_charges,
        'invoice_value_matched': matched,
        'matched_invoice_total': invoice_total,
        'overridden': overridden,
        'prev_exchange_rate': row.get('exchange_rate'),
        'prev_exchange_rate_status': row.get('exchange_rate_status'),
        # Column name predates the own_bank_charges merge; still means
        # "whatever this BOE's bank-charges field held immediately before
        # this insert", just that field is own_bank_charges now.
        'prev_debit_advice_bank_charges': row.get('own_bank_charges'),
        'prev_debit_advice_bank_charges_status': row.get('own_bank_charges_status'),
    }
    created = _client.table('boe_debit_advices').insert(advice_row).execute().data[0]

    _apply_debit_advice_aggregates(be_no)

    return created


def undo_debit_advice(be_no: str, advice_id: int) -> bool:
    """
    Reverses one debit advice upload -- which may be one of several on this
    BOE, and not necessarily the most recent -- by removing it and rebuilding
    exchange_rate / own_bank_charges from whichever advices remain. With none
    left, both fall back to no confirmed value at all, same as if no debit
    advice had ever been uploaded for this BOE -- including overwriting
    own_bank_charges back to empty even if it held an unrelated manually
    typed value before any debit advice touched it; the two share one field,
    so there is no way to distinguish "no debit advice left" from "an
    operator's number that happens to coincide". Also trashes the
    Drive file (recoverable from the Shared Drive's trash, see
    drive_client.trash_document) and removes the boe_documents index row.
    Returns False if no such advice exists for this BOE.
    """
    existing = _client.table('boe_debit_advices').select('*').eq('id', advice_id).eq('be_no', be_no)\
        .limit(1).execute().data
    if not existing:
        return False
    advice = existing[0]

    _client.table('boe_debit_advices').delete().eq('id', advice_id).execute()
    _apply_debit_advice_aggregates(be_no)

    drive_client.trash_document(advice['storage_path'])
    _client.table('boe_documents').delete().eq('be_no', be_no).eq('storage_path', advice['storage_path']).execute()
    return True
