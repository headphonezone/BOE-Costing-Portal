"""
FastAPI parser service for the BOE Costing Portal.

Reads an ICEGATE Bill of Entry PDF and writes the parsed record to Supabase.
This is the one job the portal cannot do in TypeScript: the extraction is
positional, done with pdfplumber by x-coordinate, so it has to be Python.

Self-contained -- boe_parser sits alongside this module and credentials come
from backend/.env, so this folder runs without anything outside it.
"""
import io
import os
import re

from dotenv import load_dotenv

# Loaded before supabase_client is imported, because that module reads its
# credentials from the environment at import time.
# backend/.env locally; on Vercel the platform supplies these and the file is
# simply absent, which load_dotenv treats as a no-op.
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402
import pdfplumber  # noqa: E402

from . import boe_parser as bp  # noqa: E402
from . import supabase_client as db  # noqa: E402
from . import doc_extract  # noqa: E402

app = FastAPI(title="BOE Costing API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_boe_pdf(pdf_bytes: bytes) -> dict:
    """Runs the full parse pipeline (same steps as the Streamlit app)."""
    pages_text = []
    all_duties = {}
    all_bcd_forgone = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pg in pdf.pages:
            d = bp.extract_duties_from_page(pg)
            if d:
                all_duties.update(d)
        all_bcd_forgone = bp.parse_scheme_g_from_pages(pdf.pages)
        # Watermark bleed is stripped here, once, so every text parser below
        # reads the page as it was actually printed. See strip_watermark().
        for p in pdf.pages:
            pages_text.append(bp.extract_clean_text(p))

    header = bp.parse_header(pages_text[0])
    header['hawb_no'] = bp.parse_hawb(pages_text[0])
    header['importer_name'] = bp.parse_importer(pages_text[0])
    ex_rate = header.get('exchange_rate', 1.0)
    # A BOE can quote invoice, freight and insurance in different currencies,
    # so the whole rate table goes through, not just the USD rate.
    rates = bp.parse_exchange_rates(pages_text[0])

    meta, items = bp.parse_all_items(pages_text[1:], ex_rate, rates)

    inv_summary_list = bp.parse_invoice_summary_multi(pages_text[0])
    if inv_summary_list and not meta.get('inv_no'):
        meta['inv_no'] = inv_summary_list[0]['inv_no']
        meta['inv_value'] = inv_summary_list[0]['inv_value']

    licences = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pg in pdf.pages:
            licences.extend(bp.parse_licences_from_page(pg))
    seen = set()
    unique_lics = []
    for lic in licences:
        key = (lic['invsno'], lic['itmsno'], lic['lic_no'], lic['debit_duty'])
        if key not in seen:
            seen.add(key)
            unique_lics.append(lic)
    licences = unique_lics

    assess_values = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        part3_pages, in_p3 = [], False
        for pg in pdf.pages:
            pg_text = pg.extract_text() or ''
            if 'PART - III' in pg_text:
                in_p3 = True
            if in_p3:
                part3_pages.append(pg)
            if in_p3 and 'PART - IV' in pg_text:
                break
        assess_values = bp.extract_assess_values_from_pages(part3_pages)

    be_no_all = bp.parse_be_no_from_pages(pages_text)
    header['be_no'] = be_no_all or header.get('be_no', '')

    return {
        'header': header, 'meta': meta, 'items': items,
        'duties': all_duties, 'bcd_forgone': all_bcd_forgone,
        'licences': licences, 'assess_values': assess_values,
    }


@app.post("/boe/upload")
async def upload_boe(file: UploadFile = File(...)):
    pdf_bytes = await file.read()
    try:
        parsed = _parse_boe_pdf(pdf_bytes)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse PDF: {e}")

    if not parsed['header'].get('be_no'):
        raise HTTPException(422, "Could not find a BE No on this PDF")

    be_no = db.save_boe(
        parsed['header'], parsed['meta'], parsed['items'], parsed['duties'],
        parsed['bcd_forgone'], parsed['licences'], parsed['assess_values'],
    )
    db.upload_document(be_no, file.filename or f"{be_no}.pdf", pdf_bytes, doc_type='BOE')

    return {
        'be_no': be_no,
        'items_saved': len(parsed['items']),
        'licences_saved': len(parsed['licences']),
    }


@app.post("/boe/{be_no}/documents")
async def upload_supporting_document(be_no: str, doc_type: str = "OTHER", file: UploadFile = File(...)):
    existing = db.get_boe(be_no)
    if not existing:
        raise HTTPException(404, f"No BOE found for {be_no}")
    file_bytes = await file.read()
    file_name = file.filename or "document"
    path = db.upload_document(be_no, file_name, file_bytes, doc_type=doc_type)

    extraction = None
    try:
        fields = doc_extract.extract_document(doc_type, file_name, file_bytes)
        if fields is not None:
            db.save_document_extraction(be_no, path, doc_type, fields)
            extraction = fields
    except Exception:
        # A malformed/unreadable supporting doc shouldn't block the upload
        # itself -- the file is already safely stored either way.
        pass

    return {'storage_path': path, 'extraction': extraction}


@app.get("/boe")
def list_boes():
    return db.list_boes()


@app.get("/boe/{be_no}")
def get_boe(be_no: str):
    result = db.get_boe(be_no)
    if not result:
        raise HTTPException(404, f"No BOE found for {be_no}")
    return result


@app.delete("/boe/{be_no}")
def delete_boe(be_no: str):
    deleted = db.delete_boe(be_no)
    if not deleted:
        raise HTTPException(404, f"No BOE found for {be_no}")
    return {'ok': True}


class FieldUpdate(BaseModel):
    field_name: str
    value: float
    status: str  # 'provisional' | 'fixed'


@app.patch("/boe/{be_no}/field")
def update_field(be_no: str, update: FieldUpdate):
    if update.status not in ('provisional', 'fixed'):
        raise HTTPException(422, "status must be 'provisional' or 'fixed'")
    try:
        db.update_field(be_no, update.field_name, update.value, update.status)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {'ok': True}


class SimulationItem(BaseModel):
    invsno: int
    itemsn: int
    description: str = ''
    qty: float = 0
    unit_price_usd: float = 0
    is_foc: bool = False
    bcd: float = 0
    sws: float = 0
    igst: float = 0
    assess_value: float | None = None


class SimulationExport(BaseModel):
    """
    A costing already computed by the portal, ready to be laid into the
    C-SHEET template.

    Nothing here is recalculated server-side, and that is the point:
    frontend/src/lib/costing.ts is the single source of truth for the maths,
    and the one time a second implementation existed it drifted. The
    workbook's own formulas reproduce these inputs -- costing.test.ts pins
    that parity -- so the sheet stays live and still agrees with the screen.
    """
    label: str = 'Simulation'
    exchange_rate: float = 1.0
    margin_pct: float = 2.0
    freight: float = 0
    insurance: float = 0
    clearance: float = 0
    other_charges: float = 0
    misc: float = 0
    supplier_freight: float = 0
    bank_charges: float = 0
    own_bank_charges: float = 0
    items: list[SimulationItem] = []


@app.post("/boe/{be_no}/excel/simulation")
def download_simulation_excel(be_no: str, sim: SimulationExport):
    """
    The same C-SHEET workbook the actual record exports, filled with a
    scenario's figures instead. Same layout, same formulas, same columns --
    the only visible difference is the banner naming the scenario.
    """
    from fastapi.responses import StreamingResponse

    detail = db.get_boe(be_no)
    if not detail:
        raise HTTPException(404, f"No BOE found for {be_no}")
    if not sim.items:
        raise HTTPException(422, "A simulation needs at least one item")

    boe = detail['boe']

    # D-DETAILS places rows by global_sno, and C-SHEET row 12+i reads
    # D-DETAILS row 10+i, so the numbering has to be a contiguous 1..n in the
    # order the rows are shown. Duplicated scenario rows would otherwise
    # leave gaps and shift every duty reference below them.
    items, duties, assess_values, foc_keys = [], {}, {}, set()
    for i, it in enumerate(sim.items, start=1):
        key = (it.invsno, it.itemsn)
        items.append({
            'global_sno': i, 'invsno': it.invsno, 'itemsn': it.itemsn,
            'desc': it.description, 'price': it.unit_price_usd, 'qty': it.qty,
        })
        duties[key] = {'bcd': it.bcd, 'sws': it.sws, 'igst': it.igst}
        if it.assess_value is not None:
            assess_values[key] = it.assess_value
        if it.is_foc:
            foc_keys.add(key)
    duties['_be_no'] = be_no
    duties['_be_date'] = boe.get('be_date') or ''

    header = {'exchange_rate': sim.exchange_rate, 'hawb_no': boe.get('hawb_no'),
              'be_no': be_no, 'be_date': boe.get('be_date')}
    meta = {'supplier': boe.get('supplier_name'), 'inv_no': boe.get('inv_no'),
            'inv_value': boe.get('inv_value_usd'), 'inv_date': boe.get('inv_date'),
            'freight': sim.freight, 'insurance': sim.insurance,
            'misc_charges_inr': sim.misc}

    # Every scenario figure is deliberate, so all of them show as confirmed
    # rather than provisional -- the yellow/green shading on an actual sheet
    # tracks whether an operator has settled a number, which is a question
    # that does not apply to a what-if.
    variable_fields = {f: {'value': v, 'status': 'fixed'} for f, v in (
        ('exchange_rate', sim.exchange_rate),
        ('freight_charges', sim.freight),
        ('clearing_charges', sim.clearance),
        ('supplier_freight', sim.supplier_freight),
        ('bank_charges', sim.bank_charges),
        ('own_bank_charges', sim.own_bank_charges),
    )}

    # bcd_forgone is deliberately empty: costing.ts has already resolved each
    # item's BCD to whichever of cash or licence-foregone actually applies,
    # so letting _fill_d_details substitute a foregone amount for a zero BCD
    # would overwrite a duty the scenario waived on purpose.
    # D-DETAILS keys licences by the parser's 'itmsno'; the database column is
    # 'itemsn'. The actual-BOE export remaps them for the same reason.
    licences = [{
        'invsno': lic['invsno'], 'itmsno': lic['itemsn'],
        'lic_no': lic['lic_no'], 'debit_duty': lic['debit_duty'],
    } for lic in detail['licences']]

    excel_bytes = bp.fill_excel(
        header, meta, items, duties, {}, licences, assess_values,
        variable_fields,
        options={'title': f'SIMULATION - {sim.label} (not the actual record)',
                 'margin_pct': sim.margin_pct,
                 'other_charges': sim.other_charges,
                 'foc_keys': foc_keys},
    )

    safe = re.sub(r'[^A-Za-z0-9]+', '-', sim.label).strip('-') or 'simulation'
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=BOE_{be_no}_{safe}.xlsx"},
    )


@app.get("/boe/{be_no}/excel")
def download_excel(be_no: str):
    from fastapi.responses import StreamingResponse

    detail = db.get_boe(be_no)
    if not detail:
        raise HTTPException(404, f"No BOE found for {be_no}")

    boe = detail['boe']
    items = [{
        'global_sno': it['global_sno'], 'invsno': it['invsno'], 'itemsn': it['itemsn'],
        'desc': it['description'], 'price': it['unit_price_usd'], 'qty': it['qty'],
    } for it in detail['items']]
    duties = {(it['invsno'], it['itemsn']): {
        'bcd': it['bcd'], 'sws': it['sws'], 'igst': it['igst'],
    } for it in detail['items']}
    duties['_be_no'] = be_no
    duties['_be_date'] = boe.get('be_date') or ''
    bcd_forgone = {(it['invsno'], it['itemsn']): it['bcd_forgone']
                   for it in detail['items'] if it.get('bcd_forgone')}
    licences = [{
        'invsno': lic['invsno'], 'itmsno': lic['itemsn'],
        'lic_no': lic['lic_no'], 'debit_duty': lic['debit_duty'],
    } for lic in detail['licences']]
    assess_values = {(it['invsno'], it['itemsn']): it['assess_value']
                      for it in detail['items'] if it.get('assess_value') is not None}

    header = {'exchange_rate': boe.get('exchange_rate'), 'hawb_no': boe.get('hawb_no'), 'be_no': be_no,
              'be_date': boe.get('be_date')}
    meta = {'supplier': boe.get('supplier_name'), 'inv_no': boe.get('inv_no'),
            'inv_value': boe.get('inv_value_usd'), 'inv_date': boe.get('inv_date'),
            'freight': boe.get('freight_inr'), 'insurance': boe.get('insurance_inr'),
            'misc_charges_inr': boe.get('misc_charges_inr')}

    vf = detail['variable_fields'] or {}
    variable_fields = {
        f: {'value': vf.get(f, 0), 'status': vf.get(f'{f}_status', 'provisional')}
        for f in db.FIELDS
    } if vf else {}

    excel_bytes = bp.fill_excel(header, meta, items, duties, bcd_forgone, licences, assess_values, variable_fields)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=BOE_{be_no}.xlsx"},
    )
