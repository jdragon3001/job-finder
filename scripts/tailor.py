"""Edit the words in her own .docx and nothing else — fonts, margins, spacing, bullets and layout stay byte-identical.

  python3 scripts/tailor.py resume <base.docx> <edits.json> <out.docx>
      edits: {"replace": [{"find": "<exact paragraph text>", "with": "<new text>"}], "drop": ["<exact paragraph text>"]}
      Every new resume line must be a bullet from profile/facts.md (her approved bank), so nothing is invented.
  python3 scripts/tailor.py cover <base.docx> <edits.json> <out.docx>
      edits: {"replace": [...same, for date/company/salutation...],
              "paragraphs": [{"text": "...", "sources": ["R1", "B3"]}]}  -> replaces the letter body
      (paragraphs after the "Dear ..." line, before the "Sincerely"/"Thank you" line). Every body paragraph
      must cite sources that exist in profile/facts.md.

Refuses (exit 1, reason on stderr) if a find text is missing or ambiguous, a resume line is not in the bank, a
citation is unknown, the output would run longer than the original, or anything but text changed.
Prints one JSON line: {"out", "diff": ["- old", "+ new", ...]}.
Usage of --check: python3 scripts/tailor.py --check   (self-test on a generated .docx)
"""
import html, json, re, sys, zipfile
from pathlib import Path

DOC = "word/document.xml"
PARA = re.compile(r"<w:p\b[^>]*?(?:/>|>.*?</w:p>)", re.S)
TEXT = re.compile(r"(<w:t\b[^>]*>)(.*?)(</w:t>)", re.S)
# ponytail: line estimate, not a renderer. 120 chars ≈ one line of her 10.5pt resume at 0.5in margins;
# swap for a real page count (LibreOffice --convert-to pdf) if a renderer is ever installed.
CHARS_PER_LINE = 120
FACTS = Path("profile/facts.md")


class Refuse(Exception):
    pass


def para_text(p):
    return html.unescape("".join(m.group(2) for m in TEXT.finditer(p)))


def norm(s):
    return re.sub(r"\s+", " ", s.replace("​", "").replace("●", "")).strip()


def set_text(p, new):
    """Put new text in the paragraph's first run, empty the rest: keeps that run's formatting."""
    seen = []
    def sub(m):
        seen.append(1)
        if len(seen) == 1:
            open_tag = m.group(1) if "xml:space" in m.group(1) else m.group(1)[:-1] + ' xml:space="preserve">'
            return open_tag + html.escape(new, quote=False) + m.group(3)
        return m.group(1) + m.group(3)
    out = TEXT.sub(sub, p)
    if not seen:
        raise Refuse("paragraph has no text run to edit")
    return out


def lines(text):
    return max(1, -(-len(text) // CHARS_PER_LINE)) if text.strip() else 1


def bank():
    """Approved resume lines: the '- R1 text' bullets in facts.md."""
    if not FACTS.exists():
        raise Refuse(f"{FACTS} not found")
    out = set()
    for m in re.finditer(r"^- ([A-Z]\d+) (.+)$", FACTS.read_text(), re.M):
        t = norm(re.sub(r"\s*\*\(.*?\)\*\s*$", "", m.group(2)))
        out.add(t)
    return out


def find_one(paras, text):
    hits = [i for i, p in enumerate(paras) if norm(para_text(p)) == norm(text)]
    if len(hits) != 1:
        raise Refuse(f"{'no' if not hits else len(hits)} paragraph(s) match {text[:70]!r}")
    return hits[0]


def edit(kind, xml, edits):
    paras = PARA.findall(xml)
    new = list(paras)
    diff = []
    for r in edits.get("replace", []):
        i = find_one(paras, r["find"])
        if kind == "resume" and norm(r["with"]) not in bank():
            raise Refuse(f"not an approved bullet from facts.md: {r['with'][:70]!r}")
        same = [k for k, q in enumerate(paras) if norm(para_text(q)) == norm(r["with"])]
        # Reordering her own bullets moves the whole paragraph, so each keeps its exact runs (incl. stray tabs).
        new[i] = paras[same[0]] if same else set_text(paras[i], r["with"])
        diff += ["- " + norm(para_text(paras[i])), "+ " + norm(r["with"])]
    bullet = lambda k: "<w:numPr>" in paras[k]
    for d in edits.get("drop", []):
        i = find_one(paras, d)
        diff.append("- " + norm(para_text(paras[i])))
        nxt = next((k for k in range(i + 1, len(new)) if new[k] is not None), None)
        prev = next((k for k in range(i - 1, -1, -1) if new[k] is not None), None)
        if bullet(i) and (nxt is None or not bullet(nxt)) and prev is not None and bullet(prev):
            # Dropping a group's last bullet: its paragraph carries the spacing before the next heading, so keep
            # that paragraph and move the previous bullet's text into it instead.
            new[i] = set_text(paras[i], para_text(new[prev]))
            new[prev] = None
        else:
            new[i] = None
    if kind == "cover":
        texts = [norm(para_text(p)) for p in paras]
        start = next((i for i, t in enumerate(texts) if t.lower().startswith("dear")), None)
        end = next((i for i, t in enumerate(texts) if start is not None and i > start and re.match(r"(sincerely|thank you|best|warm)", t, re.I)), None)
        if start is None or end is None:
            raise Refuse("cover template needs a 'Dear …' line and a 'Sincerely' line")
        body = [i for i in range(start + 1, end) if texts[i]]
        if not body:
            raise Refuse("cover template has no body paragraphs between the salutation and the closing")
        known = FACTS.read_text() if FACTS.exists() else ""
        out_paras = []
        for p in edits.get("paragraphs", []):
            if not p.get("sources") or any(s not in known for s in p["sources"]):
                raise Refuse(f"paragraph cites unknown or no sources: {p.get('sources')}")
            out_paras.append(set_text(paras[body[0]], p["text"]))
        if not out_paras:
            raise Refuse("cover edits need at least one paragraph")
        gap = paras[body[0] + 1] if body[0] + 1 < end and not texts[body[0] + 1] else None   # keep her blank-line spacing
        joined = []
        for k, p in enumerate(out_paras):
            joined.append(p)
            if gap and k < len(out_paras) - 1:
                joined.append(gap)
        for i in range(body[0], body[-1] + 1):
            new[i] = None
        new[body[0]] = "".join(joined)
        diff += ["- " + texts[i] for i in body] + ["+ " + p["text"] for p in edits["paragraphs"]]
    before = sum(lines(para_text(p)) for p in paras)
    after = sum(lines(para_text(q)) for p in new if p for q in PARA.findall(p))
    if after > before:
        raise Refuse(f"output runs longer than the original ({after} vs {before} estimated lines) — it could spill onto page 2")
    # Rebuild by swapping only paragraph strings in place: every byte between paragraphs is untouched.
    out, pos = [], 0
    for m, n in zip(PARA.finditer(xml), new):
        out += [xml[pos:m.start()], n or ""]
        pos = m.end()
    out.append(xml[pos:])
    return "".join(out), diff


def tailor(kind, base, edits_path, out_path):
    edits = json.loads(Path(edits_path).read_text())
    with zipfile.ZipFile(base) as z:
        xml = z.read(DOC).decode("utf-8")
        new_xml, diff = edit(kind, xml, edits)
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as o:
            for item in z.infolist():
                o.writestr(item, new_xml.encode("utf-8") if item.filename == DOC else z.read(item.filename))
    return {"out": str(out_path), "diff": diff}


def make_docx(path, paragraphs):
    """Minimal valid .docx for tests: each paragraph styled (bold run, then plain run)."""
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    body = "".join(f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>{html.escape(a)}</w:t></w:r>'
                   f'<w:r><w:t xml:space="preserve">{html.escape(b)}</w:t></w:r></w:p>' if b is not None else
                   f'<w:p><w:r><w:t>{html.escape(a)}</w:t></w:r></w:p>' for a, b in paragraphs)
    files = {
        "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        DOC: f'<?xml version="1.0" encoding="UTF-8"?><w:document {W}><w:body>{body}<w:sectPr><w:pgMar w:top="720"/></w:sectPr></w:body></w:document>',
    }
    with zipfile.ZipFile(path, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)


def _check():
    W0 = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    import tempfile
    global FACTS
    d = Path(tempfile.mkdtemp())
    FACTS = d / "facts.md"
    FACTS.write_text("- R1 Led a team analyzing 3.4M records.\n- B3 Scaled to seven chapters and a $40,000 annual budget.\n- G1 Assessed market demand.\n")
    base = d / "r.docx"
    make_docx(base, [("Alex Doe", None), ("● ", "Assessed market demand."), ("● ", "Scaled to seven chapters and a $40,000 annual budget."), ("● ", "Old extra bullet.")])
    orig = zipfile.ZipFile(base).read(DOC).decode()
    ed = d / "e.json"
    def run(e, kind="resume", src=base):
        ed.write_text(json.dumps(e)); return tailor(kind, src, ed, d / "o.docx")
    def refused(e, kind="resume", src=base):
        try: run(e, kind, src)
        except Refuse as x: return str(x)
        raise AssertionError("should have refused: " + json.dumps(e))
    # a bank bullet replaces another; formatting outside the text unchanged
    r = run({"replace": [{"find": "● Scaled to seven chapters and a $40,000 annual budget.", "with": "Led a team analyzing 3.4M records."}],
             "drop": ["● Old extra bullet."]})
    out = zipfile.ZipFile(d / "o.docx").read(DOC).decode()
    texts = [norm(para_text(p)) for p in PARA.findall(out)]
    assert texts == ["Alex Doe", "Assessed market demand.", "Led a team analyzing 3.4M records."], texts
    assert out.count("<w:b/>") == orig.count("<w:b/>") - 1 and 'w:pgMar w:top="720"' in out      # dropped one para only
    assert r["diff"][:2] == ["- Scaled to seven chapters and a $40,000 annual budget.", "+ Led a team analyzing 3.4M records."]
    assert "approved bullet" in refused({"replace": [{"find": "● Assessed market demand.", "with": "Invented a new achievement."}]})
    assert "match" in refused({"drop": ["● Not in the document"]})
    # cover: body replaced, salutation/closing kept, sources required, length capped
    cov = d / "c.docx"
    make_docx(cov, [("Dear Hiring Manager,", None), ("", None), ("Old body paragraph one is here and fairly long " * 3, None), ("", None), ("Old paragraph two " * 4, None), ("Sincerely,", None), ("Mary", None)])
    r = run({"paragraphs": [{"text": "New paragraph about NERA.", "sources": ["R1"]}, {"text": "Second one.", "sources": ["B3"]}]}, "cover", cov)
    out = zipfile.ZipFile(d / "o.docx").read(DOC).decode()
    texts = [norm(para_text(p)) for p in PARA.findall(out)]
    assert texts == ["Dear Hiring Manager,", "", "New paragraph about NERA.", "", "Second one.", "Sincerely,", "Mary"], texts
    assert "sources" in refused({"paragraphs": [{"text": "x", "sources": ["Z9"]}]}, "cover", cov)
    assert "longer" in refused({"paragraphs": [{"text": "word " * 400, "sources": ["R1"]}]}, "cover", cov)
    assert "Dear" in refused({"paragraphs": [{"text": "x", "sources": ["R1"]}]}, "cover", base)
    # reordering moves her paragraphs verbatim (a trailing tab in one bullet must not leak into another)
    tb = d / "t.docx"
    with zipfile.ZipFile(tb, "w") as z:
        z.writestr(DOC, f'<?xml version="1.0"?><w:document {W0}><w:body>'
                        '<w:p><w:r><w:t>Assessed market demand.</w:t></w:r></w:p>'
                        '<w:p><w:r><w:t>Led a team analyzing 3.4M records.</w:t></w:r><w:r><w:tab/></w:r></w:p></w:body></w:document>')
    run({"replace": [{"find": "Assessed market demand.", "with": "Led a team analyzing 3.4M records."},
                     {"find": "Led a team analyzing 3.4M records.", "with": "Assessed market demand."}]}, "resume", tb)
    ps = PARA.findall(zipfile.ZipFile(d / "o.docx").read(DOC).decode())
    assert [norm(para_text(p)) for p in ps] == ["Led a team analyzing 3.4M records.", "Assessed market demand."]
    assert "<w:tab/>" in ps[0] and "<w:tab/>" not in ps[1], "tab travels with its own bullet"
    # dropping a section's last bullet keeps that slot's spacing (the gap before the next heading)
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    bp = lambda txt, after: (f'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr><w:spacing w:after="{after}"/></w:pPr>'
                             f'<w:r><w:t>{txt}</w:t></w:r></w:p>')
    sp = d / "s.docx"
    make_docx(sp, [("x", None)])
    body = bp("Assessed market demand.", 0) + bp("Led a team analyzing 3.4M records.", 0) + bp("Old extra bullet.", 240) + '<w:p><w:r><w:t>NEXT HEADING</w:t></w:r></w:p>'
    with zipfile.ZipFile(sp, "w") as z:
        z.writestr(DOC, f'<?xml version="1.0"?><w:document {W}><w:body>{body}</w:body></w:document>')
    run({"drop": ["Old extra bullet."]}, "resume", sp)
    out = zipfile.ZipFile(d / "o.docx").read(DOC).decode()
    ps = PARA.findall(out)
    assert [norm(para_text(p)) for p in ps] == ["Assessed market demand.", "Led a team analyzing 3.4M records.", "NEXT HEADING"]
    assert 'w:after="240"' in ps[1], "last bullet keeps the section's trailing space"
    # special characters survive as text, not markup
    run({"replace": [{"find": "● Assessed market demand.", "with": "Led a team analyzing 3.4M records."}]})
    assert "<w:t" in zipfile.ZipFile(d / "o.docx").read(DOC).decode()
    print("tailor self-check ok")


if __name__ == "__main__":
    if "--check" in sys.argv:
        _check(); sys.exit(0)
    if len(sys.argv) != 5 or sys.argv[1] not in ("resume", "cover"):
        print(__doc__); sys.exit(2)
    try:
        print(json.dumps(tailor(*sys.argv[1:])))
    except Refuse as e:
        print("refused: " + str(e), file=sys.stderr); sys.exit(1)
