"""
Refresh the BOE <-> Tally item lookup (migration 015) from Supabase and TallyPrime.

    python scripts/tally_link/refresh.py            dry run: match and report, write nothing
    python scripts/tally_link/refresh.py --apply    ... and load the result into Supabase

Run it on the machine where TallyPrime is open (:9000) and the Supabase CLI is
logged in (`supabase login`); both companies' current books must be open in
Tally. Reads go to both; the only writes are the two tables from migration
015, and only with --apply.

What a run does
  1. boes / boe_items from Supabase; stock items and purchase vouchers from
     every open Tally company whose name starts with a known prefix.
  2. Ties each import voucher to its BOE: by the BOE number in the narration;
     when that number is missing, or names a BOE the lines do not fit, by
     supplier, date and every line's qty and rate.
  3. Pairs BOE lines with voucher lines (matcher.py).
  4. --apply: upserts boe_item_tally_link, then rebuilds tally_item_map from
     every stored link.

Safe to re-run. Rows a person has marked confirmed or rejected are never
overwritten. Old links are replaced only for BOEs whose vouchers were found
this run, so a BOE whose year is no longer open in Tally keeps its links.
"""
from __future__ import annotations

import argparse
import collections
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matcher  # noqa: E402
import tally    # noqa: E402

PROJECT_REF = "lqurlldfpesbjhrkkczv"           # BOE-Costing
COMPANY_PREFIXES = {"FV": "Ferrari Video", "HZ": "Headphone Zone"}
# The supplier-name words that say nothing about who the supplier is.
GENERIC_WORDS = {"ltd", "limited", "co", "company", "technology", "inc", "llc", "pte", "the", "and", "electronic",
                 "electronics", "audio", "music", "hongkong", "hong", "kong", "shenzhen", "dongguan", "trading", "group",
                 "acoustics", "international", "sdn", "bhd", "corporation", "pvt", "private"}
BATCH = 400

# --------------------------------------------------------------------------- Supabase (via the CLI's login)


def sb(sql: str, ref: str) -> list[dict]:
    exe = shutil.which("supabase")
    if not exe:
        sys.exit("supabase CLI not found on PATH")
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        path = f.name
    try:
        p = subprocess.run([exe, "db", "query", "--linked", "--project-ref", ref, "-o", "json", "-f", path],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
    finally:
        os.unlink(path)
    out = p.stdout
    try:
        return json.loads(out[out.index("{"):])["rows"]
    except (ValueError, KeyError):
        sys.exit(f"Supabase query failed:\n{out[-2000:]}\n{p.stderr[-2000:]}")


def dollar(data) -> str:
    s = json.dumps(data, ensure_ascii=False)
    assert "$json$" not in s
    return f"$json${s}$json$::jsonb"

# --------------------------------------------------------------------------- Tally


def pull_tally(cache: Path | None):
    """Stock item names and purchase vouchers for each company code, from every matching open company."""
    def cached(name, fetch):
        p = cache / name if cache else None
        if p and p.exists():
            return fetch(p.read_text(encoding="utf-8"))[0]
        data, raw = fetch(None)
        if p:
            p.write_text(raw, encoding="utf-8")
        return data

    today = datetime.date.today().strftime("%Y%m%d")
    items, vouchers, seen = collections.defaultdict(set), collections.defaultdict(list), []
    for c in tally.companies():
        code = next((k for k, pre in COMPANY_PREFIXES.items() if c["name"].startswith(pre)), None)
        if not code:
            continue
        seen.append(c["name"])
        tag = re.sub(r"\W+", "_", c["name"]).strip("_")
        print(f"  {c['name']}: stock items ...", flush=True)
        items[code] |= cached(f"items_{tag}.xml", lambda raw: tally.stock_item_names(c["name"], raw))
        print(f"  {c['name']}: purchase vouchers {c['from']}..{today} (the slow one) ...", flush=True)
        vs = cached(f"purchases_{tag}.xml", lambda raw: tally.purchase_vouchers(c["name"], c["from"], today, raw))
        vouchers[code] += [dict(v, co=code) for v in vs]
    if not seen:
        sys.exit("No Ferrari Video / Headphone Zone company is open in Tally.")
    return items, vouchers, seen

# --------------------------------------------------------------------------- linking


def is_import(v: dict) -> bool:
    """A supplier's import voucher -- not the inter-company copy one company books from the other."""
    own = any(v["party"].lower().startswith(p.lower()) for p in COMPANY_PREFIXES.values())
    return not own and (v["type"] == "Purchase Import" or any("$" in i["rate"] for i in v["inv"]))


def words(s: str) -> set[str]:
    return {w for w in re.sub(r"[^a-z ]", " ", (s or "").lower()).split() if len(w) > 2 and w not in GENERIC_WORDS}


def assign_vouchers(boes: dict, items: dict, vouchers: dict):
    company = lambda b: "HZ" if "HEADPHONE" in (b["importer_name"] or "").upper() else "FV"
    d8 = lambda s: datetime.datetime.strptime(s, "%Y%m%d").date()
    qr = {be: collections.Counter((round(float(x["qty"] or 0), 3), round(float(x["unit_price_usd"] or 0), 2)) for x in its)
          for be, its in items.items()}

    def fit(v, be):
        if be not in qr or not v["inv"]:
            return 0.0
        return sum(1 for i in v["inv"]
                   if (round(matcher.tally_qty(i["qty"]) or 0, 3), round(matcher.tally_rate(i["rate"]) or 0, 2)) in qr[be]) / len(v["inv"])

    assign, notes = collections.defaultdict(list), []
    for code, vs in vouchers.items():
        for v in vs:
            if not is_import(v):
                continue
            v = dict(v, key=f"{code}/{v['type']}/{v['no']}")
            cands = [be for be, b in boes.items() if company(b) == code
                     and abs((datetime.date.fromisoformat(b["be_date"]) - d8(v["date"])).days) <= 30]
            named = [b for b in matcher.boe_nos(v["narr"]) if b in boes]
            if named:
                f = max(fit(v, b) for b in named)
                if f >= 0.5:
                    for b in named:
                        assign[b].append(v)
                    continue
                alt = max(((fit(v, b), b) for b in cands if b not in named), default=(0, None))
                if alt[0] >= 0.8:
                    assign[alt[1]].append(v)
                    notes.append(f"{v['key']} ({v['party']}): narration says BOE {'/'.join(named)}, lines match BOE {alt[1]}")
                    continue
                for b in named:
                    assign[b].append(v)
                continue
            alt = max(((fit(v, b), b) for b in cands if words(boes[b]["supplier_name"]) & words(v["party"])), default=(0, None))
            if alt[0] >= 0.8:
                assign[alt[1]].append(v)
                notes.append(f"{v['key']} ({v['party']}): no BOE no in narration, lines match BOE {alt[1]}")
            else:
                notes.append(f"{v['key']} ({v['party']}): no BOE in the portal for {v['narr'][:60]!r}")
    return assign, notes, company


def build_links(boes, items, assign, company):
    rows, summary = [], collections.Counter()
    for be, b in boes.items():
        vs = sorted(assign.get(be, []), key=lambda v: (v["date"], v["no"]))
        lines = [dict(i, vch=v, line_no=n) for v in vs for n, i in enumerate(v["inv"], 1)]
        bi = [dict(x, qty=float(x["qty"] or 0), unit_price_usd=float(x["unit_price_usd"] or 0)) for x in items.get(be, [])]
        summary["boes"] += 1
        summary["boes_with_voucher"] += bool(vs)
        summary["boe_lines"] += len(bi)
        if not lines:
            summary["lines_not_in_tally"] += len(bi)
            continue
        links, ub, _, T = matcher.match_boe(bi, lines)
        summary["lines_not_in_tally"] += len(ub)
        for L in links:
            summary[f"lines_{L['status']}"] += len(L["b"])
            note = "; ".join(L["conflicts"] + [f"names look swapped - BOE text fits '{x}'" for x in L["swap"]]) or None
            for i in L["b"]:
                for j in L["t"]:
                    v = lines[j]["vch"]
                    rows.append({"be_no": be, "invsno": bi[i]["invsno"], "itemsn": bi[i]["itemsn"], "boe_description": bi[i]["description"],
                                 "company": v["co"], "voucher_type": v["type"], "voucher_no": v["no"],
                                 "voucher_date": f"{v['date'][:4]}-{v['date'][4:6]}-{v['date'][6:]}", "voucher_line": lines[j]["line_no"],
                                 "tally_item": T[j]["item"], "tally_qty": T[j]["q"], "tally_rate": T[j]["r"], "link_kind": L["kind"],
                                 "status": L["status"], "name_score": L["text"], "note": note})
    keys = collections.Counter((r["be_no"], r["invsno"], r["itemsn"], r["company"], r["voucher_type"], r["voucher_no"], r["voucher_line"])
                               for r in rows)
    if keys and max(keys.values()) > 1:
        sys.exit("internal error: duplicate link keys")
    return rows, summary


def build_alias(links: list[dict], masters: dict) -> list[dict]:
    """Roll links up to supplier + BOE description -> Tally item. A description linked one-to-one to
    different items on different BOEs is ambiguous, so those rows are marked review."""
    sup = lambda s: re.sub(r"\s+", " ", re.sub(r"[.,]", " ", s or "")).strip().lower()
    key = lambda s: re.sub(r"\s+", " ", (s or "").strip().lower())
    groups = {}
    for L in links:
        k = (sup(L["supplier_name"]), key(L["boe_description"]), L["tally_item"])
        g = groups.setdefault(k, {"supplier_name": L["supplier_name"], "boe_description": L["boe_description"], "cth": L["cth"],
                                  "tally_item": L["tally_item"], "kinds": set(), "review": False, "lines": set(), "be_nos": set(),
                                  "booked_in": set(), "score": 0.0, "notes": set()})
        g["kinds"].add(L["link_kind"])
        g["review"] |= L["status"] == "review"
        g["lines"].add((L["be_no"], L["invsno"], L["itemsn"]))
        g["be_nos"].add(L["be_no"])
        g["booked_in"].add(L["company"])
        g["score"] = max(g["score"], float(L["name_score"] or 0))
        if L["note"]:
            g["notes"].add(L["note"])
    one_to_one = collections.defaultdict(set)
    for (s, d, t), g in groups.items():
        if g["kinds"] <= {"1:1", "amount", "name"}:
            one_to_one[(s, d)].add(t)
    rows = []
    for (s, d, t), g in groups.items():
        others = sorted(one_to_one[(s, d)] - {t}) if g["kinds"] <= {"1:1", "amount", "name"} else []
        notes = sorted(g["notes"]) + (["same BOE text also linked to: " + "; ".join(others)] if others else [])
        rows.append({"supplier_name": g["supplier_name"], "boe_description": g["boe_description"], "cth": g["cth"],
                     "tally_item": t, "in_fv_master": t in masters.get("FV", set()), "in_hz_master": t in masters.get("HZ", set()),
                     "booked_in": sorted(g["booked_in"]), "link_kind": "/".join(sorted(g["kinds"])),
                     "status": "review" if (g["review"] or others) else "auto", "evidence_lines": len(g["lines"]),
                     "be_nos": sorted(g["be_nos"]), "name_score": round(g["score"], 3), "note": " | ".join(notes) or None})
    return rows

# --------------------------------------------------------------------------- load

LINK_UPSERT = """insert into boe_item_tally_link (be_no, invsno, itemsn, boe_description, company, voucher_type, voucher_no,
  voucher_date, voucher_line, tally_item, tally_qty, tally_rate, link_kind, status, name_score, note)
select be_no, invsno, itemsn, boe_description, company, voucher_type, voucher_no, voucher_date, voucher_line, tally_item,
       tally_qty, tally_rate, link_kind, status, name_score, note
from jsonb_to_recordset({data}) as x(be_no text, invsno int, itemsn int, boe_description text, company text, voucher_type text,
  voucher_no text, voucher_date date, voucher_line int, tally_item text, tally_qty numeric, tally_rate numeric, link_kind text,
  status text, name_score numeric, note text)
on conflict (be_no, invsno, itemsn, company, voucher_type, voucher_no, voucher_line) do update set
  boe_description = excluded.boe_description, voucher_date = excluded.voucher_date, tally_item = excluded.tally_item,
  tally_qty = excluded.tally_qty, tally_rate = excluded.tally_rate, link_kind = excluded.link_kind,
  status = case when boe_item_tally_link.status in ('confirmed', 'rejected') then boe_item_tally_link.status else excluded.status end,
  name_score = excluded.name_score, note = excluded.note, updated_at = now();"""

# Postgres does the final grouping, through the same key functions the lookup uses.
ALIAS_UPSERT = """with x as (
  select * from jsonb_to_recordset({data}) as x(supplier_name text, boe_description text, cth text, tally_item text,
    in_fv_master boolean, in_hz_master boolean, booked_in text[], link_kind text, status text, evidence_lines int, be_nos text[],
    name_score numeric, note text)
), g as (
  select tally_supplier_key(supplier_name) as sk, tally_map_key(boe_description) as dk, tally_item,
         min(supplier_name) as supplier_name, min(boe_description) as boe_description, min(cth) as cth,
         bool_or(in_fv_master) as in_fv_master, bool_or(in_hz_master) as in_hz_master,
         string_agg(distinct link_kind, '/') as link_kind, bool_or(status = 'review') as review,
         sum(evidence_lines)::int as evidence_lines, max(name_score) as name_score, string_agg(distinct note, ' | ') as note
  from x group by 1, 2, 3
), bi as (
  select tally_supplier_key(supplier_name) as sk, tally_map_key(boe_description) as dk, tally_item,
         array_agg(distinct c order by c) as booked_in
  from x, unnest(x.booked_in) as c group by 1, 2, 3
), bn as (
  select tally_supplier_key(supplier_name) as sk, tally_map_key(boe_description) as dk, tally_item,
         array_agg(distinct n order by n) as be_nos
  from x, unnest(x.be_nos) as n group by 1, 2, 3
)
insert into tally_item_map (supplier_name, boe_description, cth, tally_item, in_fv_master, in_hz_master, booked_in,
  link_kind, status, evidence_lines, be_nos, name_score, note)
select g.supplier_name, g.boe_description, g.cth, g.tally_item, g.in_fv_master, g.in_hz_master, bi.booked_in,
       g.link_kind, case when g.review then 'review' else 'auto' end, g.evidence_lines, bn.be_nos, g.name_score, g.note
from g join bi using (sk, dk, tally_item) join bn using (sk, dk, tally_item)
on conflict (supplier_key, desc_key, tally_item) do update set
  cth = excluded.cth, in_fv_master = excluded.in_fv_master, in_hz_master = excluded.in_hz_master, booked_in = excluded.booked_in,
  link_kind = excluded.link_kind, evidence_lines = excluded.evidence_lines, be_nos = excluded.be_nos,
  name_score = excluded.name_score, note = excluded.note, updated_at = now(),
  status = case when tally_item_map.status in ('confirmed', 'rejected') then tally_item_map.status else excluded.status end;"""


def apply(links, boes_linked, masters, ref):
    run_start = sb("select now() as t", ref)[0]["t"]
    for k in range(0, len(links), BATCH):
        sb(LINK_UPSERT.replace("{data}", dollar(links[k:k + BATCH])), ref)
        print(f"  links {min(k + BATCH, len(links))}/{len(links)}", flush=True)
    gone = sb(f"""with d as (delete from boe_item_tally_link
                   where status in ('auto', 'review') and updated_at < '{run_start}'::timestamptz
                     and be_no = any(array(select jsonb_array_elements_text({dollar(sorted(boes_linked))}))) returning 1)
                  select count(*) as n from d""", ref)[0]["n"]
    print(f"  stale links removed: {gone}")

    stored = sb("""select l.be_no, l.invsno, l.itemsn, l.boe_description, l.company, l.tally_item, l.link_kind, l.status,
                          l.name_score, l.note, b.supplier_name, i.cth
                   from boe_item_tally_link l
                   join boes b on b.be_no = l.be_no
                   left join boe_items i on i.be_no = l.be_no and i.invsno = l.invsno and i.itemsn = l.itemsn
                   where l.status <> 'rejected'""", ref)
    alias = build_alias(stored, masters)
    by_sup = collections.defaultdict(list)                      # a batch never splits a supplier
    for a in alias:
        by_sup[re.sub(r"\s+", " ", re.sub(r"[.,]", " ", a["supplier_name"] or "")).strip().lower()].append(a)
    batch, done = [], 0
    for s in sorted(by_sup):
        batch += by_sup[s]
        if len(batch) >= BATCH:
            sb(ALIAS_UPSERT.replace("{data}", dollar(batch)), ref)
            done += len(batch)
            batch = []
            print(f"  alias {done}/{len(alias)}", flush=True)
    if batch:
        sb(ALIAS_UPSERT.replace("{data}", dollar(batch)), ref)
        print(f"  alias {len(alias)}/{len(alias)}")
    gone = sb(f"""with d as (delete from tally_item_map
                   where status in ('auto', 'review') and updated_at < '{run_start}'::timestamptz returning 1)
                  select count(*) as n from d""", ref)[0]["n"]
    print(f"  stale alias rows removed: {gone}")
    for r in sb("""select 'boe_item_tally_link' as t, status, count(*) as n from boe_item_tally_link group by status
                   union all select 'tally_item_map', status, count(*) from tally_item_map group by status order by 1, 2""", ref):
        print(f"  {r['t']:20} {r['status']:9} {r['n']}")

# --------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="load the result into Supabase (default: dry run)")
    ap.add_argument("--cache", type=Path, help="keep Tally's raw XML here and reuse it on the next run")
    ap.add_argument("--project-ref", default=PROJECT_REF)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if args.cache:
        args.cache.mkdir(parents=True, exist_ok=True)

    print("Supabase: boes, boe_items ...", flush=True)
    boes = {b["be_no"]: b for b in sb("select be_no, be_date, importer_name, supplier_name from boes", args.project_ref)}
    items = collections.defaultdict(list)
    for it in sb("select be_no, invsno, itemsn, cth, description, qty, unit_price_usd from boe_items "
                 "order by be_no, global_sno, invsno, itemsn", args.project_ref):
        items[it["be_no"]].append(it)
    print(f"  {len(boes)} BOEs, {sum(map(len, items.values()))} lines")

    print("Tally:", flush=True)
    masters, vouchers, seen = pull_tally(args.cache)

    assign, notes, company = assign_vouchers(boes, items, vouchers)
    links, summary = build_links(boes, items, assign, company)

    print(f"\nBOEs {summary['boes']}, with a Tally voucher {summary['boes_with_voucher']}")
    print(f"BOE lines {summary['boe_lines']}: auto {summary['lines_auto']}, review {summary['lines_review']}, "
          f"not in Tally {summary['lines_not_in_tally']}")
    print(f"link rows {len(links)}")
    if notes:
        print("\nVouchers worth a look:")
        for n in notes:
            print("  " + n)
    unbooked = sorted(be for be in boes if be not in assign)
    if unbooked:
        print(f"\nBOEs with no Tally voucher yet: {', '.join(unbooked)}")

    if not args.apply:
        print("\nDry run - nothing written. Re-run with --apply to load.")
        return
    print("\nLoading into Supabase ...", flush=True)
    apply(links, {r["be_no"] for r in links}, masters, args.project_ref)


if __name__ == "__main__":
    main()
