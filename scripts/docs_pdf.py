"""
Build the project documentation as print-ready PDFs.

    python scripts/docs_pdf.py

Markdown -> styled HTML -> headless Chrome -> PDF, then page numbers are
stamped on with reportlab. Chrome is used rather than a Python HTML renderer
because it is the only thing on a stock Windows box that lays out real CSS
paged media; nothing extra has to be installed.

Mermaid fences are not shipped to a JS renderer. Each is drawn here as inline
SVG instead, matched to a signature in the fence body, so the build needs no
network and no CDN -- and the fences stay valid mermaid, so the markdown still
renders on GitHub.
"""
from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = DOCS / "pdf"

TITLE = "BOE Costing Portal"

# `dense` trades a little air for page count. The user guide is meant to be a
# two-to-three page handout -- a four-page handout is a different object -- so
# it is set tighter rather than being cut short.
DOCUMENTS = [
    {
        "src": DOCS / "USER-GUIDE.md",
        "kind": "User Guide",
        "standfirst": "How to upload a Bill of Entry, read its landed costing, "
                      "and model what-if scenarios against it.",
        "toc": False,
        "dense": True,
    },
    {
        "src": DOCS / "OVERVIEW.md",
        "kind": "Technical Overview",
        "standfirst": "The short form: the six modules, the architecture, "
                      "the costing model and how it is verified.",
        "toc": False,
        "dense": True,
    },
    {
        "src": DOCS / "WHITEPAPER.md",
        "kind": "Technical Whitepaper",
        "standfirst": "The system module by module: access, the import register, "
                      "ingestion, the costing engine, simulation and export.",
        "toc": True,
        "dense": False,
    },
    {
        "src": DOCS / "PARSER.md",
        "kind": "Parser Reference",
        "standfirst": "How the parser reads an ICEGATE Bill of Entry: every field, "
                      "where it comes from, and what changes the answer.",
        "toc": True,
        "dense": False,
    },
]

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


# ---------------------------------------------------------------------------
# Diagrams
#
# Hand-drawn replacements for the mermaid fences, matched on a signature from
# the fence body so a diagram cannot silently attach to the wrong block.
# ---------------------------------------------------------------------------

INK = "#0f172a"
MUTED = "#475569"
LINE = "#cbd5e1"
FILL = "#f8fafc"
ACCENT_FILL = "#eef2ff"
ACCENT_LINE = "#6366f1"
DB_FILL = "#ecfdf5"
DB_LINE = "#059669"
ARROW = "#94a3b8"


def _box(x, y, w, h, lines, fill=FILL, stroke=LINE, bold_first=True):
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="1"/>'
    ]
    n = len(lines)
    # Vertically centre the whole stack inside the box.
    first = y + h / 2 - (n - 1) * 7 + 1
    for i, text in enumerate(lines):
        weight = "600" if (i == 0 and bold_first) else "400"
        size = 11.5 if (i == 0 and bold_first) else 10
        colour = INK if (i == 0 and bold_first) else MUTED
        out.append(
            f'<text x="{x + w / 2}" y="{first + i * 14}" text-anchor="middle" '
            f'font-size="{size}" font-weight="{weight}" fill="{colour}">{text}</text>'
        )
    return "".join(out)


def _arrow(x1, y1, x2, y2, label=None):
    out = [
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{ARROW}" stroke-width="1.4" '
        f'fill="none" marker-end="url(#ah)"/>'
    ]
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        out.append(
            f'<rect x="{mx - 16}" y="{my - 8}" width="32" height="14" fill="#ffffff"/>'
            f'<text x="{mx}" y="{my + 3}" text-anchor="middle" font-size="9.5" '
            f'fill="{MUTED}">{label}</text>'
        )
    return "".join(out)


def _elbow(x1, y1, x2, y2, label=None):
    """Down, across, then down into the target."""
    mid = (y1 + y2) / 2
    out = [
        f'<path d="M {x1} {y1} L {x1} {mid} L {x2} {mid} L {x2} {y2}" '
        f'stroke="{ARROW}" stroke-width="1.4" fill="none" marker-end="url(#ah)"/>'
    ]
    if label:
        out.append(
            f'<text x="{(x1 + x2) / 2}" y="{mid - 5}" text-anchor="middle" '
            f'font-size="9.5" fill="{MUTED}">{label}</text>'
        )
    return "".join(out)


def _note(x, y, text, anchor="middle"):
    return (
        f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="9.5" '
        f'fill="{MUTED}">{text}</text>'
    )


def _svg(width, height, body, caption):
    return (
        f'<figure class="diagram">'
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{caption}" '
        f'font-family="Segoe UI, Helvetica, Arial, sans-serif">'
        f'<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" '
        f'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
        f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{ARROW}"/></marker></defs>'
        f"{body}</svg>"
        f"<figcaption>{caption}</figcaption></figure>"
    )


def diagram_pipeline() -> str:
    b = []
    b.append(_box(255, 8, 210, 34, ["BOE PDF bytes"], ACCENT_FILL, ACCENT_LINE))
    b.append(_arrow(360, 42, 360, 66))
    b.append(_box(215, 68, 290, 44, ["strip_watermark", "keep 7\u201314 pt characters"]))

    b.append(_elbow(360, 112, 185, 142))
    b.append(_elbow(360, 112, 535, 142))
    b.append(_box(35, 144, 300, 44, ["extract_clean_text", "one string per page"]))
    b.append(_box(385, 144, 300, 44, ["get_row_words", "word + x0 + top per row"]))

    b.append(_arrow(185, 188, 185, 214))
    b.append(
        _box(
            25, 216, 320, 62,
            ["Page 1 &#183; Part I",
             "be_no, be_date, exchange rates,",
             "importer, HAWB, invoice summary"],
        )
    )
    b.append(_arrow(185, 278, 185, 300))
    b.append(
        _box(
            25, 302, 320, 62,
            ["Pages 2+ &#183; Part II",
             "supplier, invoice, valuation,",
             "item table"],
        )
    )

    b.append(_arrow(535, 188, 535, 214))
    b.append(
        _box(
            375, 216, 320, 62,
            ["Part III", "assess value,", "BCD / SWS / IGST"],
        )
    )
    b.append(_arrow(535, 278, 535, 300))
    b.append(
        _box(
            375, 302, 320, 62,
            ["Part IV", "Section F licences,", "Section G duty foregone"],
        )
    )

    b.append(_elbow(185, 364, 320, 400))
    b.append(_elbow(535, 364, 400, 400))
    b.append(
        _box(240, 402, 240, 44, ["merge", "on invsno + itemsn"], ACCENT_FILL, ACCENT_LINE)
    )
    b.append(_arrow(360, 446, 360, 470))
    b.append(_box(255, 472, 210, 34, ["save_boe"]))
    b.append(_arrow(360, 506, 360, 530))
    b.append(
        _box(
            180, 532, 360, 42,
            ["boes / boe_items / boe_licences"],
            DB_FILL, DB_LINE,
        )
    )
    return _svg(720, 584, "".join(b), "The parse pipeline, from PDF bytes to stored record.")


def diagram_bcd() -> str:
    b = []
    b.append(_box(15, 96, 120, 40, ["Item"], ACCENT_FILL, ACCENT_LINE))
    b.append(_arrow(135, 116, 168, 116))
    b.append(
        _box(
            170, 84, 190, 64,
            ["Part III", "cash BCD greater", "than zero?"],
        )
    )
    # Two labelled branches out of the decision.
    b.append(
        f'<path d="M 360 106 L 400 106 L 400 46 L 428 46" stroke="{ARROW}" '
        f'stroke-width="1.4" fill="none" marker-end="url(#ah)"/>'
        f'<text x="404" y="72" font-size="9.5" fill="{MUTED}">yes</text>'
    )
    b.append(
        f'<path d="M 360 126 L 400 126 L 400 190 L 428 190" stroke="{ARROW}" '
        f'stroke-width="1.4" fill="none" marker-end="url(#ah)"/>'
        f'<text x="404" y="166" font-size="9.5" fill="{MUTED}">no</text>'
    )
    b.append(
        _box(430, 20, 250, 52, ["BCD = cash amount", "Part III, x 100\u2013170"])
    )
    b.append(
        _box(430, 164, 250, 52, ["BCD = duty foregone", "Part IV, Section G"])
    )
    b.append(
        f'<path d="M 680 46 L 712 46 L 712 118 L 690 118" stroke="{ARROW}" '
        f'stroke-width="1.4" fill="none" marker-end="url(#ah)"/>'
        f'<path d="M 680 190 L 712 190 L 712 118" stroke="{ARROW}" '
        f'stroke-width="1.4" fill="none"/>'
    )
    b.append(
        _box(430, 96, 258, 44, ["effective BCD"], ACCENT_FILL, ACCENT_LINE)
    )
    return _svg(
        740, 236, "".join(b),
        "An item's real BCD comes from one of two places, never both."
    )


def diagram_modules() -> str:
    """Six modules, wrapped two to a row so the figure stays under a third of
    the text block -- a full-height column pushed itself onto its own page."""
    cells = [
        ("Module 1 &#183; Access and identity", "sign-in, sessions, roles"),
        ("Module 2 &#183; Import register", "every BOE on file, searchable"),
        ("Module 3 &#183; Ingestion", "PDF in, structured record out"),
        ("Module 4 &#183; Costing engine", "landed cost per piece"),
        ("Module 5 &#183; Simulation workbench", "what-if scenarios, lockable"),
        ("Module 6 &#183; Export", "the C-SHEET workbook"),
    ]
    col_x, w, h, pitch = (30, 390), 300, 54, 84
    b = []
    for i, (title, sub) in enumerate(cells):
        x = col_x[i % 2]
        y = 8 + (i // 2) * pitch
        # The gate is accented, so what everything else sits behind is visible
        # at a glance.
        fill, stroke = (ACCENT_FILL, ACCENT_LINE) if i == 0 else (FILL, LINE)
        b.append(_box(x, y, w, h, [title, sub], fill, stroke))
        if i % 2 == 0:
            b.append(_arrow(x + w, y + h / 2, col_x[1] - 2, y + h / 2))
        elif i < len(cells) - 1:
            # Wrap to the start of the next row.
            b.append(_elbow(x + w / 2, y + h, col_x[0] + w / 2, y + pitch))

    last_y = 8 + ((len(cells) - 1) // 2) * pitch + h
    b.append(_arrow(col_x[1] + w / 2, last_y, col_x[1] + w / 2, last_y + 22))
    b.append(
        _box(
            30, last_y + 22, 660, 42,
            ["Supabase — Postgres + private Storage"],
            DB_FILL, DB_LINE,
        )
    )
    return _svg(720, last_y + 72, "".join(b), "Six modules, and the gate they sit behind.")


def diagram_architecture() -> str:
    b = []
    b.append(_box(285, 8, 150, 34, ["browser"], ACCENT_FILL, ACCENT_LINE))
    b.append(_elbow(360, 42, 180, 98))
    b.append(_elbow(360, 42, 540, 98))
    b.append(_note(238, 66, "page loads", "end"))
    b.append(_note(482, 66, "upload &#183; Excel", "start"))

    b.append(
        _box(
            30, 100, 300, 68,
            ["portal", "Next.js 16 &#183; TypeScript",
             "costing.ts — the costing model"],
        )
    )
    b.append(
        _box(
            390, 100, 300, 68,
            ["parser service", "Python &#183; FastAPI",
             "pdfplumber, openpyxl, boe_parser.py"],
        )
    )

    b.append(_arrow(180, 168, 180, 236))
    b.append(_note(188, 198, "anon key &#183; read only", "start"))
    b.append(_arrow(540, 168, 540, 236))
    b.append(_note(548, 198, "service_role key &#183; read + write", "start"))

    b.append(
        _box(
            30, 238, 660, 50,
            ["Supabase — Postgres + private Storage bucket"],
            DB_FILL, DB_LINE,
        )
    )
    return _svg(
        720, 300, "".join(b),
        "Two deployable services and one database. Only the parser can write."
    )


def diagram_resolution() -> str:
    b = []
    b.append(
        _box(
            10, 24, 216, 62,
            ["boe_variable_fields", "operator-maintained,", "carries a status"],
            ACCENT_FILL, ACCENT_LINE,
        )
    )
    b.append(_arrow(226, 55, 282, 55))
    b.append(_note(254, 44, "else"))
    b.append(
        _box(
            284, 24, 216, 62,
            ["boes.*", "what the parser read", "from the form"],
        )
    )
    b.append(_arrow(500, 55, 556, 55))
    b.append(_note(528, 44, "else"))
    b.append(_box(558, 24, 150, 62, ["zero"]))
    return _svg(
        720, 100, "".join(b),
        "Where an expense figure comes from, in fixed order."
    )


DIAGRAMS = [
    ("M1[Module 1", diagram_modules),
    ("strip_watermark", diagram_pipeline),
    ("cash BCD greater than 0", diagram_bcd),
    ("B[browser]", diagram_architecture),
    ("boe_variable_fields", diagram_resolution),
]


def render_mermaid(source: str) -> str:
    for signature, build in DIAGRAMS:
        if signature in source:
            return build()
    # Unknown diagram: show the source rather than dropping it silently.
    print(f"  ! no drawing for mermaid block starting {source.splitlines()[0]!r}")
    return f'<pre class="mermaid-fallback"><code>{escape(source)}</code></pre>'


def escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------------------------------------------------------------------------
# Markdown
# ---------------------------------------------------------------------------

CSS = """
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }

:root {
  --ink: #0f172a; --muted: #475569; --line: #d8dee9;
  --accent: #1e3a5f; --rule: #e2e8f0; --code-bg: #f6f8fa;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font: 10.2pt/1.5 "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: var(--ink);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

/* --- title block --------------------------------------------------- */
.masthead { border-bottom: 2.5pt solid var(--accent); padding-bottom: 10pt; margin-bottom: 6pt; }
.masthead .eyebrow {
  font-size: 8pt; letter-spacing: .16em; text-transform: uppercase;
  color: var(--muted); font-weight: 600;
}
.masthead h1 {
  font-size: 22pt; line-height: 1.15; margin: 6pt 0 0;
  color: var(--accent); font-weight: 700; letter-spacing: -.01em;
}
.masthead .kind { font-size: 13pt; font-weight: 400; color: var(--muted); display: block; margin-top: 2pt; }
.masthead p.standfirst { margin: 9pt 0 0; font-size: 10.5pt; color: var(--muted); max-width: 46em; }
.masthead .meta { margin-top: 9pt; font-size: 8.5pt; color: var(--muted); }

/* --- contents ------------------------------------------------------ */
.toc { margin: 14pt 0 4pt; padding: 10pt 14pt; background: #f8fafc; border: .5pt solid var(--rule); border-radius: 5pt; }
.toc h2 { font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 0 0 6pt; border: 0; padding: 0; }
.toc ol { margin: 0; padding-left: 1.15em; columns: 2; column-gap: 22pt; font-size: 9.4pt; }
.toc li { margin: 1.5pt 0; break-inside: avoid; color: var(--muted); }

/* --- headings ------------------------------------------------------ */
h1 { font-size: 17pt; }
h2 {
  font-size: 13pt; font-weight: 700; color: var(--accent);
  margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: .75pt solid var(--rule);
  break-after: avoid; letter-spacing: -.005em;
}
h3 { font-size: 11pt; font-weight: 700; margin: 12pt 0 4pt; break-after: avoid; }
h4 { font-size: 10pt; font-weight: 700; margin: 12pt 0 4pt; break-after: avoid; color: var(--muted); }
p { margin: 0 0 6pt; orphans: 2; widows: 2; }

/* --- body ---------------------------------------------------------- */
ul, ol { margin: 0 0 7pt; padding-left: 1.35em; }
li { margin: 2pt 0; }
li > p { margin: 0 0 4pt; }
strong { font-weight: 650; }
a { color: var(--accent); text-decoration: none; border-bottom: .5pt solid var(--line); }
hr { border: 0; border-top: .75pt solid var(--rule); margin: 16pt 0; }

blockquote {
  margin: 9pt 0; padding: 7pt 12pt; border-left: 2.5pt solid var(--line);
  background: #f8fafc; color: var(--muted); font-size: 9.6pt; break-inside: avoid;
}
blockquote p:last-child { margin-bottom: 0; }

/* --- code ---------------------------------------------------------- */
code, kbd {
  font-family: Consolas, "SF Mono", Menlo, monospace; font-size: 8.9pt;
  background: var(--code-bg); padding: .8pt 3pt; border-radius: 2.5pt;
}
pre {
  background: var(--code-bg); border: .5pt solid var(--rule); border-radius: 4pt;
  padding: 8pt 10pt; margin: 9pt 0; overflow-x: auto;
  font-size: 8.6pt; line-height: 1.45; break-inside: avoid;
}
pre code { background: none; padding: 0; font-size: inherit; }
.mermaid-fallback { border-style: dashed; }

/* --- tables -------------------------------------------------------- */
table {
  width: 100%; border-collapse: collapse; margin: 8pt 0 10pt;
  font-size: 9.3pt; break-inside: auto;
}
thead { display: table-header-group; }
th {
  text-align: left; font-weight: 650; color: var(--accent);
  border-bottom: 1pt solid var(--line); padding: 5pt 7pt 5pt 0;
  font-size: 8.6pt; letter-spacing: .03em; text-transform: uppercase;
}
td { padding: 5pt 7pt 5pt 0; border-bottom: .5pt solid var(--rule); vertical-align: top; }
tr { break-inside: avoid; }
td:first-child, th:first-child { padding-left: 0; }
table code { font-size: 8.4pt; }

/* --- diagrams ------------------------------------------------------ */
figure.diagram { margin: 12pt 0 14pt; break-inside: avoid; text-align: center; }
figure.diagram svg { max-width: 100%; }
figcaption { margin-top: 5pt; font-size: 8.6pt; color: var(--muted); font-style: italic; }
"""

# Appended for `dense` documents only. Same design, one notch tighter.
DENSE_CSS = """
@page { margin: 16mm 16mm 16mm 16mm; }
body { font-size: 9.6pt; line-height: 1.45; }
.masthead { padding-bottom: 8pt; }
.masthead h1 { font-size: 20pt; }
h2 { font-size: 12pt; margin: 13pt 0 5pt; }
h3 { font-size: 10.4pt; margin: 10pt 0 4pt; }
p { margin: 0 0 5.5pt; }
ul, ol { margin: 0 0 6pt; }
li { margin: 1.5pt 0; }
table { font-size: 8.9pt; margin: 7pt 0 9pt; }
th, td { padding: 4pt 6pt 4pt 0; }
"""

# @page margins, in points, so the stamped footer lines up with the text block.
MARGIN_PT = {False: 51, True: 45}

HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<style>{css}</style></head><body>
<header class="masthead">
  <div class="eyebrow">{eyebrow}</div>
  <h1>{title}<span class="kind">{kind}</span></h1>
  <p class="standfirst">{standfirst}</p>
  <div class="meta">{meta}</div>
</header>
{toc}
{body}
</body></html>
"""


def build_md() -> MarkdownIt:
    md = MarkdownIt("commonmark").enable(["table", "strikethrough"])
    default_fence = md.renderer.rules.get("fence")

    def fence(self, tokens, idx, options, env):
        token = tokens[idx]
        if token.info.strip().lower() == "mermaid":
            return render_mermaid(token.content)
        return default_fence(tokens, idx, options, env)

    md.add_render_rule("fence", fence)
    return md


def strip_leading_h1(markdown_text: str) -> str:
    """The masthead carries the title, so the document's own H1 is dropped."""
    lines = markdown_text.splitlines()
    out, dropped = [], False
    for line in lines:
        if not dropped and line.startswith("# "):
            dropped = True
            continue
        out.append(line)
    # Also drop the standfirst paragraph and rule that followed it, if the
    # file opens that way -- the masthead shows both.
    while out and not out[0].strip():
        out.pop(0)
    return "\n".join(out)


def toc_html(body: str) -> str:
    headings = re.findall(r"<h2>(.*?)</h2>", body, flags=re.S)
    if len(headings) < 4:
        return ""
    items = []
    for h in headings:
        text = re.sub(r"<[^>]+>", "", h).strip()
        # Section numbers are already in the heading text; strip them so the
        # ordered list does not print the number twice.
        text = re.sub(r"^\d+\.\s*", "", text)
        items.append(f"<li>{text}</li>")
    return '<nav class="toc"><h2>Contents</h2><ol>' + "".join(items) + "</ol></nav>"


def find_chrome() -> str:
    for candidate in CHROME_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    found = shutil.which("chrome") or shutil.which("chromium") or shutil.which("msedge")
    if found:
        return found
    sys.exit("No Chrome or Edge found: cannot render PDFs.")


def stamp_page_numbers(pdf_path: Path, label: str, margin: float) -> None:
    """Footer rule, document label and 'n / N', from page two onwards."""
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas

    reader = PdfReader(str(pdf_path))
    total = len(reader.pages)
    writer = PdfWriter()

    for i, page in enumerate(reader.pages, start=1):
        if i > 1:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(width, height))
            y = 30
            c.setStrokeColorRGB(0.85, 0.88, 0.92)
            c.setLineWidth(0.5)
            c.line(margin, y + 10, width - margin, y + 10)
            c.setFillColorRGB(0.42, 0.45, 0.50)
            c.setFont("Helvetica", 7.5)
            c.drawString(margin, y, label)
            c.drawRightString(width - margin, y, f"{i} / {total}")
            c.save()
            buf.seek(0)
            page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    with open(pdf_path, "wb") as fh:
        writer.write(fh)


def build(doc: dict, md: MarkdownIt, chrome: str) -> Path:
    source: Path = doc["src"]
    dense: bool = doc["dense"]

    text = strip_leading_h1(source.read_text(encoding="utf-8"))
    body = md.render(text)
    toc = toc_html(body) if doc["toc"] else ""

    html = HTML.format(
        css=CSS + (DENSE_CSS if dense else ""),
        title=TITLE,
        kind=doc["kind"],
        eyebrow="Ferrari Video &#183; Import Costing",
        standfirst=doc["standfirst"],
        meta=f"Source: docs/{source.name}",
        toc=toc,
        body=body,
    )

    OUT.mkdir(parents=True, exist_ok=True)
    pdf_path = OUT / (source.stem + ".pdf")

    with tempfile.TemporaryDirectory() as tmp:
        html_path = Path(tmp) / "doc.html"
        html_path.write_text(html, encoding="utf-8")
        subprocess.run(
            [
                chrome,
                "--headless",
                "--disable-gpu",
                "--no-sandbox",
                "--no-pdf-header-footer",
                "--virtual-time-budget=5000",
                f"--print-to-pdf={pdf_path}",
                html_path.as_uri(),
            ],
            check=True,
            capture_output=True,
        )

    stamp_page_numbers(pdf_path, f"{TITLE} \u2014 {doc['kind']}", MARGIN_PT[dense])
    return pdf_path


def main() -> None:
    # Optional filter: `docs_pdf.py overview whitepaper` builds only those.
    # Useful on Windows, where a PDF open in a viewer cannot be overwritten.
    wanted = {a.lower().removesuffix(".pdf").removesuffix(".md") for a in sys.argv[1:]}
    docs = [d for d in DOCUMENTS if not wanted or d["src"].stem.lower() in wanted]
    if wanted and not docs:
        sys.exit(f"No document matches {', '.join(sorted(wanted))}. "
                 f"Known: {', '.join(d['src'].stem for d in DOCUMENTS)}")

    md = build_md()
    chrome = find_chrome()
    print(f"Renderer: {chrome}\n")
    for doc in docs:
        if not doc["src"].exists():
            sys.exit(f"Missing source document: {doc['src']}")
        try:
            pdf = build(doc, md, chrome)
        except PermissionError as e:
            sys.exit(f"Cannot write {e.filename}: it is open in another "
                     f"program. Close it and run again, or build the others "
                     f"by name.")
        from pypdf import PdfReader

        pages = len(PdfReader(str(pdf)).pages)
        size = pdf.stat().st_size / 1024
        print(f"  {pdf.relative_to(ROOT)}  -  {pages} pages, {size:.0f} KB")


if __name__ == "__main__":
    main()
