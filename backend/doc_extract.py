"""
Best-effort structured-field extraction for supporting documents (Invoice,
Packing List, COO, and anything else uploaded alongside a BOE). Unlike
boe_parser.py -- which targets one fixed ICEGATE form layout -- these are
arbitrary supplier-generated PDFs with no shared template, so every field
here is a heuristic regex search over the extracted text rather than a
positional parse. raw_text is always kept so nothing is lost when a field
isn't found: it's the fallback for manual lookup and for improving these
patterns later against real documents.
"""
import io
import re

import pdfplumber

_MONTHS = {'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
           'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'}


def extract_pdf_text(pdf_bytes: bytes) -> str:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return '\n'.join(p.extract_text() or '' for p in pdf.pages)


def _find_date(text: str) -> str | None:
    """Returns an ISO (YYYY-MM-DD) date from the first recognizable date in text."""
    m = re.search(r'(\d{1,2})[-/](\d{1,2})[-/](\d{4})', text)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    m = re.search(r'(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})', text)
    if m:
        d, mon, y = m.groups()
        mon_num = _MONTHS.get(mon.upper())
        if mon_num:
            year = y if len(y) == 4 else f"20{y}"
            return f"{year}-{mon_num}-{d.zfill(2)}"
    return None


def _find_after_label(text: str, label_pat: str, value_pat: str = r'([A-Z0-9][A-Z0-9\-/]{2,24})') -> str | None:
    # label_pat may itself contain a top-level "A|B" alternation (e.g. two
    # possible label phrasings) -- it must be wrapped in a non-capturing
    # group here, otherwise "|" splits the *entire* interpolated pattern
    # instead of staying scoped to the label, silently detaching value_pat
    # from one side of the alternation.
    m = re.search(rf'(?:{label_pat})[:\-\s]{{0,10}}{value_pat}', text, re.IGNORECASE)
    return m.group(1).strip() if m else None


def _find_amount(text: str, label_pat: str) -> tuple[float | None, str | None]:
    """Finds a currency amount near a label, e.g. 'TOTAL: USD 5,690.50'. Returns (amount, currency)."""
    m = re.search(
        # non-greedy gap: a greedy [^\d\n]{0,25} would swallow the currency
        # code itself (all non-digit chars), leaving nothing for the
        # optional currency group to match and silently dropping it.
        rf'(?:{label_pat})[^\d\n]{{0,25}}?([A-Z]{{3}})?\s*([\d,]+\.\d{{1,2}})',
        text, re.IGNORECASE,
    )
    if not m:
        return None, None
    currency, amount = m.group(1), m.group(2)
    return float(amount.replace(',', '')), currency


def parse_invoice(text: str) -> dict:
    doc_number = _find_after_label(text, r'INVOICE\s*(?:NO\.?|NUMBER)')
    doc_date = _find_date(text)
    total_value, currency = _find_amount(text, r'(?:GRAND\s+)?TOTAL(?:\s+AMOUNT)?|INVOICE\s+VALUE')

    # Best-effort line items: rows shaped like "<desc> <qty> <unit_price> <amount>"
    # (mirrors the pattern used for the actual BOE item table, but far more
    # permissive since invoice layouts vary by supplier).
    line_items = []
    for m in re.finditer(
        r'^(.{3,80}?)\s+([\d.]+)\s+([\d,.]+)\s+([\d,.]+)\s*$',
        text, re.MULTILINE,
    ):
        desc, qty, unit_price, amount = m.groups()
        if re.search(r'\d{4,}', desc):  # skip lines that are mostly numbers/codes, not a description
            continue
        try:
            line_items.append({
                'description': desc.strip(),
                'qty': float(qty),
                'unit_price': float(unit_price.replace(',', '')),
                'amount': float(amount.replace(',', '')),
            })
        except ValueError:
            continue

    return {
        'doc_number': doc_number, 'doc_date': doc_date,
        'total_value': total_value, 'currency': currency,
        'line_items': line_items[:100] or None,
    }


def parse_packing_list(text: str) -> dict:
    doc_number = _find_after_label(text, r'PACKING\s*LIST\s*(?:NO\.?|NUMBER)')
    doc_date = _find_date(text)

    total_packages = None
    m = re.search(r'(?:TOTAL\s*)?(?:NO\.?\s*OF\s*)?(?:PACKAGES|CARTONS|PKGS)\D{0,10}(\d+)', text, re.IGNORECASE)
    if m:
        total_packages = int(m.group(1))

    def _weight(label: str) -> float | None:
        m = re.search(rf'{label}\D{{0,10}}([\d,]+\.?\d*)\s*(?:KGS?|KG)?', text, re.IGNORECASE)
        return float(m.group(1).replace(',', '')) if m else None

    return {
        'doc_number': doc_number, 'doc_date': doc_date,
        'total_packages': total_packages,
        'gross_weight_kg': _weight(r'GROSS\s*WEIGHT'),
        'net_weight_kg': _weight(r'NET\s*WEIGHT'),
    }


def parse_coo(text: str) -> dict:
    certificate_no = _find_after_label(text, r'CERTIFICATE\s*(?:NO\.?|NUMBER)')
    doc_date = _find_date(text)
    origin_country = None
    # value class is spaces only (not \s) so it can't cross into the next
    # line -- real docs mix Title Case and ALL CAPS labels, hence IGNORECASE.
    m = re.search(r'COUNTRY\s*OF\s*ORIGIN[:\-\s]{0,10}([A-Za-z][A-Za-z ]{2,30})', text, re.IGNORECASE)
    if m:
        origin_country = m.group(1).strip()

    return {
        'doc_number': certificate_no, 'doc_date': doc_date,
        'certificate_no': certificate_no, 'origin_country': origin_country,
    }


def parse_other(text: str) -> dict:
    return {'doc_date': _find_date(text)}


_PARSERS = {
    'INVOICE': parse_invoice,
    'PACKING_LIST': parse_packing_list,
    'COO': parse_coo,
}


def extract_document(doc_type: str, file_name: str, file_bytes: bytes) -> dict | None:
    """
    Runs the doc_type-appropriate parser over a supporting document. Returns
    None for non-PDF files (nothing to extract text from) or for a BOE
    itself (already fully parsed by boe_parser.py -- re-running here would
    just duplicate that work with a much weaker heuristic parser).
    """
    if doc_type == 'BOE' or not file_name.lower().endswith('.pdf'):
        return None

    text = extract_pdf_text(file_bytes)
    parser = _PARSERS.get(doc_type, parse_other)
    fields = parser(text)
    fields['raw_text'] = text
    return fields
