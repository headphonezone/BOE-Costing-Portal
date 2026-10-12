"""
Read-only TallyPrime client: company list, stock item names, purchase vouchers.

XML + inline TDL over HTTP to :9000. Requests are strictly one at a time --
overlapping requests wedge Tally (it climbs past 3 GB and stops answering), so
nothing here runs in parallel.

Two quirks of Tally's output are handled here, not by callers:

  * It declares UTF-8 but sends stray single bytes -- 0xA0, a no-break space,
    inside item names. Decoding with errors="replace" turns those into U+FFFD
    and the name no longer matches the stock item. They are read as cp1252,
    which gives back the real character.
  * It emits UDF:Foo tags with no namespace declaration, which no XML parser
    accepts. The prefix is folded into the tag name.
"""
from __future__ import annotations

import codecs
import html
import re
import urllib.request
import xml.etree.ElementTree as ET

URL = "http://localhost:9000"

codecs.register_error("tally_cp1252", lambda e: (e.object[e.start:e.end].decode("cp1252", errors="replace"), e.end))


def _post(xml: str, timeout: int = 900) -> str:
    req = urllib.request.Request(URL, data=xml.encode("utf-8"), headers={"Content-Type": "text/xml"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    return raw.decode("utf-8", errors="tally_cp1252")


def _parse(xml: str) -> ET.Element:
    xml = re.sub(r"&#(?:[0-8]|1[0-9]|2[0-9]|3[01]);", "", xml)       # control-char refs XML forbids
    xml = re.sub(r"<(/?)([A-Za-z_]\w*):", r"<\1\2_", xml)            # UDF:Foo -> UDF_Foo
    xml = re.sub(r'\s[A-Za-z_]\w*:[\w.]+="[^"]*"', "", xml)
    return ET.fromstring(xml)


def collection(tdl: str, name: str, company: str | None = None,
               from_date: str | None = None, to_date: str | None = None) -> str:
    sv = "<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"
    if company:
        sv += f"<SVCURRENTCOMPANY>{html.escape(company)}</SVCURRENTCOMPANY>"
    if from_date:
        sv += f"<SVFROMDATE TYPE='Date'>{from_date}</SVFROMDATE><SVTODATE TYPE='Date'>{to_date}</SVTODATE>"
    return _post(f"<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>"
                 f"<ID>{name}</ID></HEADER><BODY><DESC><STATICVARIABLES>{sv}</STATICVARIABLES>"
                 f"<TDL><TDLMESSAGE>{tdl}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>")


def _text(e: ET.Element, tag: str) -> str:
    x = e.find(tag)
    return (x.text or "").strip() if x is not None and x.text else ""


def companies() -> list[dict]:
    """Every company open in Tally, with its books' date range (YYYYMMDD)."""
    tdl = ('<COLLECTION NAME="CmpList" ISMODIFY="No"><TYPE>Company</TYPE>'
           '<FETCH>NAME, STARTINGFROM, ENDINGAT</FETCH></COLLECTION>')
    root = _parse(collection(tdl, "CmpList"))
    return [{"name": c.get("NAME"), "from": _text(c, "STARTINGFROM"), "to": _text(c, "ENDINGAT")}
            for c in root.iter("COMPANY") if c.get("NAME")]


def stock_item_names(company: str, raw: str | None = None) -> tuple[set[str], str]:
    tdl = '<COLLECTION NAME="SI" ISMODIFY="No"><TYPE>StockItem</TYPE><FETCH>Name</FETCH></COLLECTION>'
    raw = raw or collection(tdl, "SI", company)
    return {s.get("NAME") for s in _parse(raw).iter("STOCKITEM") if s.get("NAME")}, raw


def purchase_vouchers(company: str, from_date: str, to_date: str, raw: str | None = None) -> tuple[list[dict], str]:
    """Every purchase-family voucher (Purchase, Purchase Import, Expenses, ...) with its inventory lines."""
    tdl = ('<COLLECTION NAME="PV" ISMODIFY="No"><TYPE>Voucher</TYPE>'
           '<FETCH>Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Narration, Reference, AllInventoryEntries</FETCH>'
           '<FILTER>IsPurch</FILTER></COLLECTION>'
           '<SYSTEM TYPE="Formulae" NAME="IsPurch">$$IsPurchase:$VoucherTypeName</SYSTEM>')
    raw = raw or collection(tdl, "PV", company, from_date, to_date)
    out = []
    for v in _parse(raw).iter("VOUCHER"):
        out.append({"date": _text(v, "DATE"), "type": _text(v, "VOUCHERTYPENAME"), "no": _text(v, "VOUCHERNUMBER"),
                    "party": _text(v, "PARTYLEDGERNAME"), "narr": _text(v, "NARRATION"),
                    "inv": [{"item": _text(i, "STOCKITEMNAME"), "qty": _text(i, "BILLEDQTY"),
                             "rate": _text(i, "RATE"), "amount": _text(i, "AMOUNT")}
                            for i in v.findall("ALLINVENTORYENTRIES.LIST")]})
    return out, raw
