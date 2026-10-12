"""
Pair BOE lines with the Tally voucher lines they were booked as.

The BOE and Tally name the same item differently, but a voucher line carries
the BOE line's own qty and invoice-currency rate. So numbers decide first and
names break ties. Each pass works on what the previous ones left:

  1. 1:1     qty and rate equal; the best name wins a tie
  2. split   one BOE line -> several Tally lines (one per colour) at the same
             rate, whose qtys add up to the BOE qty
  3. merge   several BOE lines -> one Tally line; qtys and amounts add up (the
             Tally rate is then the weighted average)
  4. amount  same qty x rate, booked as different units (10 x 0.05 as 1 x 0.50)
  5. group   N BOE lines <-> M Tally lines at one rate, qty totals equal
  6. name    name alone, rate within 2%  (always review)

A link is `review` rather than `auto` when the names disagree on colour, size,
plug or mic; when two items look swapped (the numbers of one booked against
the other); or when the names barely overlap.
"""
from __future__ import annotations

import difflib
import itertools
import re

# --------------------------------------------------------------------------- narration

# BE No:8491577 · BOE no: 3702038 · BE,NO : · BE .No. · BE.NO ; · B.E. No
_BOE_RX = re.compile(r"\bB\s*\.?\s*O?\s*\.?\s*E\s*[\s.,]*(?:No|Number|#)?[\s.:;,\-]*(\d{7})\b", re.I)
# "Bill No : 8470454 Bill Date" -- a BOE number typed as the bill number
_BILL_RX = re.compile(r"\bBill\s*No\s*[:.\-]?\s*(\d{7})\b(?=.*Bill\s*Date)", re.I)


def boe_nos(narration: str) -> list[str]:
    """BOE numbers named in a voucher narration."""
    found = set(_BOE_RX.findall(narration or "")) or set(_BILL_RX.findall(narration or ""))
    return sorted(found)

# --------------------------------------------------------------------------- Tally amounts

_NUM = r"-?[\d,]*\.?\d+"


def _num(s: str, pat: str) -> float | None:
    m = re.search(pat, s or "")
    return float(m.group(1).replace(",", "")) if m else None


def tally_qty(s: str) -> float | None:            # " 350 Nos"
    return _num(s, r"(" + _NUM + r")")


def tally_rate(s: str) -> float | None:           # "U$9.50 = Rs. 899.97/Nos" -> 9.50
    return _num(s, r"^[^\d\-]*(" + _NUM + r")")


def tally_amt(s: str) -> float:                   # "-U$3325.00 @ Rs. 94.73/U$ = -Rs. ..." -> 3325.00
    return abs(_num(s, r"^-?[^\d\-]*(" + _NUM + r")") or 0)

# --------------------------------------------------------------------------- names

_PREFIX = re.compile(r"^\s*(wired earphones?|wireless earphones?|earphones?|spare parts? (?:for|of) [\w ]+?:|parts? (?:for|of) [\w ]+?:|"
                     r"accessor(?:y|ies) (?:for|of) [\w ]+?:|accessories|headphones?:?)\s*[-:]?\s*", re.I)
_STOP = {"the", "for", "of", "in", "and", "a", "an", "sku", "x", "in-ear", "inear", "ear", "headphone", "headphones", "earphone",
         "earphones", "accessory", "accessories", "version", "with", "pcs", "pc", "part", "nbr", "en", "no", "inv", "dt", "series",
         "edition"}
_COLOURS = {"black", "white", "silver", "blue", "red", "green", "gold", "grey", "gray", "purple", "orange", "pink", "yellow", "cyan",
            "brown", "beige", "mocha", "transparent", "clear", "navy", "teal"}
_SIZES = {"s": "s", "small": "s", "m": "m", "medium": "m", "l": "l", "large": "l", "ll": "ll", "xl": "xl"}
_PLUGS = {"35mm": "35", "44mm": "44", "25mm": "25", "typec": "c", "lightning": "ltn", "xlr": "xlr"}


def _prep(s: str) -> str:
    s = _PREFIX.sub("", s or "").lower()
    s = re.sub(r"\[[^\]]*\]", " ", s)                                   # "[FiiO]" brand tags
    s = re.sub(r"usb\s*-?\s*type\s*-?\s*c|usb\s*-?\s*c\b|type\s*-?\s*c", " typec ", s)
    s = re.sub(r"3\.5\s*mm|\b3\.5\b", " 35mm ", s)
    s = re.sub(r"4\.4\s*mm|\b4\.4\b", " 44mm ", s)
    s = re.sub(r"2\.5\s*mm|\b2\.5\b", " 25mm ", s)
    s = re.sub(r"(?<=\w)['’.](?=\w)", "", s)                            # Wan'er -> waner, S.G -> sg
    return re.sub(r"\bgray\b", "grey", s)


def norm_tokens(s: str) -> list[str]:
    return [t for t in re.sub(r"[^a-z0-9]+", " ", _prep(s)).split() if t not in _STOP]


def _compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _prep(s))


def _attrs(s: str) -> dict[str, set[str]]:
    toks = set(re.sub(r"[^a-z0-9]+", " ", _prep(s)).split())
    a = {"colour": toks & _COLOURS, "size": {_SIZES[t] for t in toks if t in _SIZES and t != "m"},
         "plug": {_PLUGS[t] for t in toks if t in _PLUGS}}
    if re.search(r"\bwith\s*out\s*mic|\bno\s*mic|\bnon\s*mic", s or "", re.I):
        a["mic"] = {"no"}
    elif re.search(r"\bmic\b|microphone", s or "", re.I):
        a["mic"] = {"yes"}
    else:
        a["mic"] = set()
    return a


def conflicts(boe_desc: str, tally_name: str) -> list[str]:
    """Attributes both names state and disagree on: colour black vs silver, size L vs M, ..."""
    a, b = _attrs(boe_desc), _attrs(tally_name)
    return [f"{k}: {'/'.join(sorted(a[k]))} vs {'/'.join(sorted(b[k]))}"
            for k in ("colour", "size", "plug", "mic") if a[k] and b[k] and not (a[k] & b[k])]


def model_hit(boe_desc: str, tally_name: str) -> bool:
    """A model code from the BOE inside the Tally name: DX9D -> dx9, E70V -> e70."""
    c = _compact(tally_name)
    for t in norm_tokens(boe_desc):
        if re.search(r"\d", t) and re.search(r"[a-z]", t) and len(t) >= 3:
            for cut in (t, t[:-1], t[:-2]):
                if len(cut) >= 3 and re.search(r"\d", cut) and cut in c:
                    return True
    return False


def text_sim(boe_desc: str, tally_name: str) -> float:
    a, b = norm_tokens(boe_desc), norm_tokens(tally_name)
    if not a or not b:
        return 0.0
    cb = _compact(tally_name)
    cover = sum(1 for t in set(a) if t in set(b) or (len(t) >= 3 and t in cb)) / len(set(a))
    ratio = difflib.SequenceMatcher(None, " ".join(a), " ".join(b)).ratio()
    s = 0.6 * cover + 0.4 * ratio
    if model_hit(boe_desc, tally_name):
        s = max(s, 0.6)
    return round(s, 3)


def part_sim(boe_desc: str, tally_name: str) -> float:
    """For split/merge/group: a variant's own words found in a BOE line that lists several variants."""
    a, b = set(norm_tokens(boe_desc)), [t for t in norm_tokens(tally_name) if t not in _COLOURS]
    if not a or not b:
        return text_sim(boe_desc, tally_name)
    ca = _compact(boe_desc)
    back = sum(1 for t in b if t in a or (len(t) >= 2 and t in ca)) / len(b)
    return round(max(text_sim(boe_desc, tally_name), back), 3)


def _close(x, y, rel=0.005, abs_=0.005) -> bool:
    return x is not None and y is not None and abs(x - y) <= max(abs_, rel * abs(y))

# --------------------------------------------------------------------------- matching


def match_boe(boe_items: list[dict], tally_lines: list[dict]):
    """boe_items: [{description, qty, unit_price_usd, ...}]; tally_lines: [{item, qty, rate, amount, ...}].

    Returns (links, unmatched_boe_idx, unmatched_tally_idx, T) where each link is
    {kind, b: [boe idx], t: [tally idx], text, conflicts, swap, status} and T holds
    the Tally lines with parsed q / r / a.
    """
    B = [dict(b, q=float(b["qty"] or 0), r=float(b["unit_price_usd"] or 0)) for b in boe_items]
    for b in B:
        b["a"] = round(b["q"] * b["r"], 2)
    T = [dict(t, q=tally_qty(t["qty"]), r=tally_rate(t["rate"]), a=tally_amt(t["amount"])) for t in tally_lines]
    ub, ut, links = set(range(len(B))), set(range(len(T))), []
    _s, _p = {}, {}

    def S(i, j):
        if (i, j) not in _s:
            _s[(i, j)] = text_sim(B[i]["description"], T[j]["item"])
        return _s[(i, j)]

    def P(i, j):
        if (i, j) not in _p:
            _p[(i, j)] = part_sim(B[i]["description"], T[j]["item"])
        return _p[(i, j)]

    def add(kind, bi, tj):
        f = S if kind in ("1:1", "amount", "name") else P
        txt = (min(max(f(i, j) for i in bi) for j in tj) if len(tj) >= len(bi)
               else min(max(f(i, j) for j in tj) for i in bi))
        conf = sorted({c for i in bi for j in tj for c in conflicts(B[i]["description"], T[j]["item"])})
        links.append({"kind": kind, "b": list(bi), "t": list(tj), "text": round(txt, 3), "conflicts": conf, "swap": []})
        ub.difference_update(bi)
        ut.difference_update(tj)

    # 1. one-to-one on qty + rate
    c = [(S(i, j) - 0.5 * bool(conflicts(B[i]["description"], T[j]["item"])), i, j)
         for i in ub for j in ut if _close(T[j]["q"], B[i]["q"], 0, 1e-6) and _close(T[j]["r"], B[i]["r"])]
    for _, i, j in sorted(c, reverse=True):
        if i in ub and j in ut:
            add("1:1", [i], [j])

    # 2. split
    for i in sorted(ub, key=lambda i: -B[i]["q"]):
        cand = [j for j in ut if _close(T[j]["r"], B[i]["r"]) and P(i, j) >= 0.3]
        if not 2 <= len(cand) <= 16:
            continue
        best = None
        for n in range(2, min(len(cand), 8) + 1):
            for combo in itertools.combinations(cand, n):
                if abs(sum(T[j]["q"] for j in combo) - B[i]["q"]) < 1e-6:
                    sc = sum(P(i, j) for j in combo) / n
                    if not best or sc > best[0]:
                        best = (sc, combo)
            if best:
                break
        if best:
            add("split", [i], list(best[1]))

    # 3. merge
    for j in sorted(ut, key=lambda j: -(T[j]["q"] or 0)):
        cand = [i for i in ub if P(i, j) >= 0.3 and B[i]["q"] <= (T[j]["q"] or 0)]
        if not 2 <= len(cand) <= 16:
            continue
        best = None
        for n in range(2, min(len(cand), 8) + 1):
            for combo in itertools.combinations(cand, n):
                if (abs(sum(B[i]["q"] for i in combo) - T[j]["q"]) < 1e-6
                        and _close(sum(B[i]["a"] for i in combo), T[j]["a"], 0.002, 0.05)):
                    sc = sum(P(i, j) for i in combo) / n
                    if not best or sc > best[0]:
                        best = (sc, combo)
            if best:
                break
        if best:
            add("merge", list(best[1]), [j])

    # 4. same amount, different units
    c = [(S(i, j), i, j) for i in ub for j in ut
         if B[i]["a"] > 0 and _close(T[j]["a"], B[i]["a"], 0.001, 0.01) and S(i, j) >= 0.3]
    for _, i, j in sorted(c, reverse=True):
        if i in ub and j in ut:
            add("amount", [i], [j])

    # 5. group at one rate
    by_rate: dict[float, list[set]] = {}
    for i in ub:
        by_rate.setdefault(round(B[i]["r"], 2), [set(), set()])[0].add(i)
    for j in ut:
        if T[j]["r"] is not None:
            by_rate.setdefault(round(T[j]["r"], 2), [set(), set()])[1].add(j)
    for bs, ts in by_rate.values():
        if not bs or not ts:
            continue
        bs = {i for i in bs if any(P(i, j) >= 0.3 for j in ts)} or bs
        ts = {j for j in ts if any(P(i, j) >= 0.3 for i in bs)} or ts
        if abs(sum(B[i]["q"] for i in bs) - sum(T[j]["q"] for j in ts)) < 1e-6:
            add("group", sorted(bs), sorted(ts))

    # 6. name only
    c = [(S(i, j), i, j) for i in ub for j in ut if _close(T[j]["r"], B[i]["r"], 0.02) and S(i, j) >= 0.55]
    for _, i, j in sorted(c, reverse=True):
        if i in ub and j in ut:
            add("name", [i], [j])

    # Swap check: two 1:1 links whose names fit better crossed over -- the numbers
    # of one item were booked against the other (Burson Soloist / Conductor).
    one = [L for L in links if L["kind"] == "1:1"]
    for x, y in itertools.combinations(one, 2):
        i1, j1, i2, j2 = x["b"][0], x["t"][0], y["b"][0], y["t"][0]
        if (B[i1]["q"], B[i1]["r"]) == (B[i2]["q"], B[i2]["r"]):
            continue                                                    # identical numbers: the name already decided
        if any(f(i1, j2) > f(i1, j1) + 0.05 and f(i2, j1) > f(i2, j2) + 0.05
               and f(i1, j2) + f(i2, j1) > f(i1, j1) + f(i2, j2) + 0.15 for f in (S, P)):
            x["swap"].append(T[j2]["item"])
            y["swap"].append(T[j1]["item"])

    for L in links:
        L["status"] = _status(L, B, T)
    return links, sorted(ub), sorted(ut), T


def _status(L, B, T) -> str:
    if L["conflicts"] or L["swap"]:
        return "review"
    if L["kind"] == "name":
        return "review"
    if L["kind"] == "1:1":
        i, j = L["b"][0], L["t"][0]
        return "auto" if (L["text"] >= 0.35 or model_hit(B[i]["description"], T[j]["item"])) else "review"
    return "auto" if L["text"] >= 0.4 else "review"
