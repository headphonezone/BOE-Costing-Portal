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


def extract_pdf_text(pdf_bytes: bytes, password: str | None = None) -> str:
    with pdfplumber.open(io.BytesIO(pdf_bytes), password=password) as pdf:
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


def _parse_yes_bank_debit_advice(text: str) -> dict:
    """
    A Yes Bank import advance remittance debit advice: an advance payment
    made to a supplier before the BOE arrives, whose FX rate becomes the
    BOE's confirmed exchange rate and whose bank charges get added to
    costing separately from the operator-typed bank_charges field.

    A field that doesn't match comes back None rather than raising -- the
    caller decides whether a missing bill_amount or fx_rate means the upload
    can't proceed.
    """
    # Yes Bank's older advice template prints its own placeholder labels on
    # the page, in the same black text as everything else: "USD L-CCY_
    # 3,725.00 _", "(USD _/INR _) : 95.3 EXRATE_", "INR _ 750.00 Dr. R_".
    # So the gap between a currency code and its number may hold anything
    # but a digit -- never a newline, so a label can't borrow the next
    # line's figure. The newer template has no such tokens and the gap is
    # just whitespace.
    gap = r'[^\d\n]*?'

    bill_amount, bill_currency = None, None
    m = re.search(rf'BILL\s+AMOUNT\s*:?\s*([A-Z]{{3}})\b{gap}([\d,]+\.\d{{2}})', text, re.IGNORECASE)
    if m:
        bill_currency, bill_amount = m.group(1).upper(), float(m.group(2).replace(',', ''))

    fx_rate = None
    m = re.search(r'FX\s+RATE\s*\([^)\n]*\)\s*:?\s*([\d.]+)', text, re.IGNORECASE)
    if m:
        fx_rate = float(m.group(1))

    def _line_amount(label_pat: str) -> float | None:
        m = re.search(rf'{label_pat}\s+[A-Z]{{3}}\b{gap}([\d,]+\.\d{{2}})', text, re.IGNORECASE)
        return float(m.group(1).replace(',', '')) if m else None

    bill_commission = _line_amount(r'BILL\s+COMMISSION')
    gst_on_ccy_fees = _line_amount(r'GST\s+ON\s+CCY\s+PURCHASE\s*/\s*SALE\s+FEES')
    correspondent_bank_charges = _line_amount(r'CORRESPONDENT\s+BANK\s+CHARGES')

    return {
        'doc_date': _find_date(text),
        'bill_amount': bill_amount,
        'bill_currency': bill_currency,
        'fx_rate': fx_rate,
        'bill_commission': bill_commission,
        'gst_on_ccy_fees': gst_on_ccy_fees,
        'correspondent_bank_charges': correspondent_bank_charges,
    }


def _sbi_charge_amount(text: str, label_pat: str) -> float | None:
    # The AMOUNT (INR) column is the first number after the label -- GST(INR)
    # and TOTAL(INR) follow it on the same row.
    m = re.search(rf'{label_pat}\s+([\d,]+\.?\d*)', text, re.IGNORECASE)
    return float(m.group(1).replace(',', '')) if m else None


def _parse_sbi_advance_payment_advice(text: str) -> dict:
    """
    An SBI "Advice of Advance Payment": an advance payment made before the
    BOE arrives. Its "DETAILS OF CHARGES" table prints Remittance/SWIFT/
    MTT/Other charges as AMOUNT (INR) + GST(INR) = TOTAL(INR) columns; only
    the pre-GST AMOUNT column is taken for each (their GST is shown but not
    added, same GST-exclusive rule as Yes Bank). Service tax Cess GST has no
    such breakdown -- the printed figure is itself a GST amount needing
    reversal, the same trick as Yes Bank's GST-on-CCY-fees line.
    """
    bill_amount, bill_currency = None, None
    m = re.search(r'Adv\.?\s*Payment\s+Amount\s*:?\s*([A-Z]{3})\s+([\d,]+\.\d{2})', text, re.IGNORECASE)
    if m:
        bill_currency, bill_amount = m.group(1).upper(), float(m.group(2).replace(',', ''))

    fx_rate = None
    m = re.search(r'\bRate\s*:?\s*([\d.]+)', text, re.IGNORECASE)
    if m:
        fx_rate = float(m.group(1))

    return {
        'doc_date': _find_date(text),
        'bill_amount': bill_amount,
        'bill_currency': bill_currency,
        'fx_rate': fx_rate,
        'remittance_charge': _sbi_charge_amount(text, r'Remittance\s+charges'),
        'swift_charge': _sbi_charge_amount(text, r'SWIFT\s+charges'),
        'mtt_charge': _sbi_charge_amount(text, r'MTT\s+charges'),
        'other_charge': _sbi_charge_amount(text, r'Other\s+charges'),
        'service_tax_cess_gst': _sbi_charge_amount(text, r'Service\s+tax\s+Cess\s+GST'),
    }


def _parse_sbi_bill_payment_advice(text: str) -> dict:
    """
    An SBI "Import Collection Bill Payment Advice": paying off a bill against
    documents already collected, rather than an advance -- same job (an FX
    rate and bank charges to apply to a BOE), different layout again. Its
    charges table has seven lines instead of four; all seven are summed
    (each pre-GST, AMOUNT (INR) column) plus Service tax Cess reversed out
    of its GST the same way as the advance-payment advice's Service tax Cess
    GST line. "Amount paid" (the actual amount debited) is preferred over
    "Bill Amount" for bill_amount -- the two agree on a full payment, but
    only "Amount paid" is right if a bill is ever settled partially.
    """
    bill_amount, bill_currency = None, None
    m = re.search(r'Amount\s+paid\s*:?\s*([A-Z]{3})\s+([\d,]+\.\d{2})', text, re.IGNORECASE)
    if not m:
        m = re.search(r'Bill\s+Amount\s*:?\s*([A-Z]{3})\s+([\d,]+\.\d{2})', text, re.IGNORECASE)
    if m:
        bill_currency, bill_amount = m.group(1).upper(), float(m.group(2).replace(',', ''))

    fx_rate = None
    m = re.search(r'Rate\s+of\s+Conversion\s*:?\s*([\d.]+)', text, re.IGNORECASE)
    if m:
        fx_rate = float(m.group(1))

    # Reused rather than adding four more DB columns for one document layout:
    # mtt_charge <- Merchanting Trade Charges (MTT = Merchanting Trade),
    # remittance_charge <- Commission Charges (the primary transaction fee,
    # the same role Remittance charges plays on the advance-payment advice),
    # other_charge <- Postage Charges + Other Charges + Commission Charges
    # (Non Conversion) bundled together, since none of those three has its
    # own column and all three are typically 0.
    mtt_charge = _sbi_charge_amount(text, r'Merchanting\s+Trade\s+Charges')
    postage = _sbi_charge_amount(text, r'Postage\s+Charges') or 0.0
    other = _sbi_charge_amount(text, r'Other\s+Charges') or 0.0
    commission_non_conv = _sbi_charge_amount(text, r'Commission\s+Charges\s*\(Non\s+Conversion\)') or 0.0

    return {
        'doc_date': _find_date(text),
        'bill_amount': bill_amount,
        'bill_currency': bill_currency,
        'fx_rate': fx_rate,
        # The negative lookahead excludes "Commission Charges(Non Conversion)"
        # -- re.search would already stop at the plain "Commission Charges"
        # line first since it appears earlier in the document, but this holds
        # even if a future layout variant reorders the two.
        'remittance_charge': _sbi_charge_amount(text, r'Commission\s+Charges(?!\s*\()'),
        'swift_charge': _sbi_charge_amount(text, r'Swift\s+Charge'),
        'mtt_charge': mtt_charge,
        'other_charge': round(postage + other + commission_non_conv, 2),
        'service_tax_cess_gst': _sbi_charge_amount(text, r'Service\s+tax\s+Cess(?!\s+GST)'),
    }


def _parse_sbi_debit_advice(text: str) -> dict:
    """
    SBI has (at least) two debit advice layouts -- an advance payment and an
    import collection bill payment -- so this dispatches on which one the
    text actually is, by its own heading, rather than needing the operator
    to pick between them in the UI: one "SBI" option covers both.
    """
    if re.search(r'IMPORT\s+COLLECTION\s+BILL\s+PAYMENT\s+ADVICE', text, re.IGNORECASE):
        return _parse_sbi_bill_payment_advice(text)
    return _parse_sbi_advance_payment_advice(text)


_DEBIT_ADVICE_PARSERS = {
    'YES_BANK': _parse_yes_bank_debit_advice,
    'SBI': _parse_sbi_debit_advice,
}


def parse_debit_advice(text: str, bank: str = 'YES_BANK') -> dict:
    """Dispatches to the bank-specific debit advice parser."""
    parser = _DEBIT_ADVICE_PARSERS.get(bank)
    if parser is None:
        raise ValueError(f"Unknown debit advice bank: {bank}")
    return parser(text)


_PARSERS = {
    'INVOICE': parse_invoice,
    'PACKING_LIST': parse_packing_list,
    'COO': parse_coo,
    'DEBIT_ADVICE': parse_debit_advice,
}


def extract_document(doc_type: str, file_name: str, file_bytes: bytes, password: str | None = None) -> dict | None:
    """
    Runs the doc_type-appropriate parser over a supporting document. Returns
    None for non-PDF files (nothing to extract text from) or for a BOE
    itself (already fully parsed by boe_parser.py -- re-running here would
    just duplicate that work with a much weaker heuristic parser).
    """
    if doc_type == 'BOE' or not file_name.lower().endswith('.pdf'):
        return None

    text = extract_pdf_text(file_bytes, password=password)
    parser = _PARSERS.get(doc_type, parse_other)
    fields = parser(text)
    fields['raw_text'] = text
    return fields
