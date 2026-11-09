"""Her Gmail, through an app password (IMAP). Never sends: it only creates drafts and reads what she sent.

  python3 scripts/gmail.py draft <person_id>   create a Gmail draft for that person (manager: resume attached)
  python3 scripts/gmail.py sync                 read Gmail: sent / replied per person, "thanks for applying" per job
  python3 scripts/gmail.py --check              self-test against a fake mailbox

Needs in .env: GMAIL_ADDRESS, GMAIL_APP_PASSWORD (Google Account → Security → 2-Step Verification → App passwords).
"""
import datetime as dt, email.utils, imaplib, json, mimetypes, os, re, sqlite3, sys, time
from email.message import EmailMessage
from pathlib import Path

DRAFTS, SENT, INBOX = '"[Gmail]/Drafts"', '"[Gmail]/Sent Mail"', "INBOX"
APPLIED_WORDS = ("thank you for applying", "thanks for applying", "application received", "received your application",
                 "thank you for your application", "thank you for your interest in")


def env():
    p = Path(".env")
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"'))


def connect():
    env()
    user, pw = os.environ.get("GMAIL_ADDRESS"), os.environ.get("GMAIL_APP_PASSWORD")
    if not (user and pw):
        raise SystemExit("Gmail not connected: set GMAIL_ADDRESS and GMAIL_APP_PASSWORD in .env")
    m = imaplib.IMAP4_SSL("imap.gmail.com")
    m.login(user, pw)
    return m, user


def build(person, sender, attach=None):
    msg = EmailMessage()
    msg["From"], msg["To"] = sender, person["email"]
    msg["Subject"] = person["email_subject"] or ""
    msg.set_content(person["email_body"] or "")
    if attach:
        data = Path(attach).read_bytes()
        mt = (mimetypes.guess_type(attach)[0] or "application/octet-stream").split("/")
        msg.add_attachment(data, maintype=mt[0], subtype=mt[1], filename=Path(attach).name)
    return msg


def draft(db, imap, sender, person_id):
    p = db.execute("""select p.*, j.materials, j.net from people p join jobs j on j.key=p.job_key where p.id=?""", (person_id,)).fetchone()
    if not p:
        raise SystemExit("no such person")
    if not p["email"]:
        raise SystemExit("no email address for this person yet")
    attach = None
    if p["kind"] == "manager" and not p["net"]:
        attach = (json.loads(p["materials"] or "{}") or {}).get("resume")
        if not attach or not Path(attach).exists():
            raise SystemExit("manager email needs the tailored resume, which is missing")
    msg = build(p, sender, attach)
    typ, _ = imap.append(DRAFTS, "\\Draft", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
    if typ != "OK":
        raise SystemExit("Gmail refused the draft")
    db.execute("update people set email_state='drafted' where id=? and email_state='none'", (person_id,))
    db.commit()
    return {"drafted": person_id, "to": p["email"], "attached": bool(attach)}


def _search(imap, box, *criteria):
    imap.select(box, readonly=True)
    typ, data = imap.search(None, *criteria)
    return data[0].split() if typ == "OK" and data and data[0] else []


def _date(imap, num):
    typ, data = imap.fetch(num, "(BODY.PEEK[HEADER.FIELDS (DATE)])")
    raw = data[0][1].decode(errors="replace") if typ == "OK" and data and data[0] else ""
    d = email.utils.parsedate_to_datetime(raw.split(":", 1)[1].strip()) if ":" in raw else None
    return d.date().isoformat() if d else dt.date.today().isoformat()


def sync(db, imap):
    changed = {"sent": 0, "replied": 0, "applied": 0}
    for p in db.execute("select * from people where email is not null and email != '' and email_state != 'replied'").fetchall():
        if _search(imap, INBOX, "FROM", p["email"]):
            db.execute("update people set email_state='replied' where id=?", (p["id"],)); changed["replied"] += 1
        elif p["email_state"] != "sent":
            hits = _search(imap, SENT, "TO", p["email"])
            if hits:
                db.execute("update people set email_state='sent', sent_at=? where id=?", (_date(imap, hits[-1]), p["id"])); changed["sent"] += 1
    for j in db.execute("select key, company, decided_at from jobs where status='pursued' and net=0 and coalesce(applied,'') != 'confirmed'").fetchall():
        since = dt.date.fromisoformat((j["decided_at"] or dt.date.today().isoformat())[:10]).strftime("%d-%b-%Y")
        name = re.split(r"[ ,]", j["company"].replace("The ", ""))[0]
        for words in APPLIED_WORDS:
            if _search(imap, INBOX, "SINCE", since, "TEXT", f'"{words}"', "TEXT", f'"{name}"'):
                db.execute("update jobs set applied='confirmed' where key=?", (j["key"],)); changed["applied"] += 1
                break
    db.commit()
    return changed


class FakeImap:
    """Just enough of imaplib.IMAP4 for tests: boxes of {from, to, date, text}."""
    def __init__(self, boxes):
        self.boxes, self.appended, self.cur = boxes, [], None
    def select(self, box, readonly=False):
        self.cur = box; return "OK", [b"1"]
    def search(self, charset, *c):
        msgs, out = self.boxes.get(self.cur, []), []
        for i, m in enumerate(msgs, 1):
            ok, k = True, 0
            while k < len(c):
                key, val = c[k], c[k + 1].strip('"').lower(); k += 2
                if key == "FROM": ok &= val in m["from"].lower()
                elif key == "TO": ok &= val in m["to"].lower()
                elif key == "TEXT": ok &= val in m["text"].lower()
                elif key == "SINCE": ok &= m["date"] >= dt.datetime.strptime(val, "%d-%b-%Y").date().isoformat()
            if ok: out.append(str(i).encode())
        return "OK", [b" ".join(out)]
    def fetch(self, num, what):
        m = self.boxes[self.cur][int(num) - 1]
        return "OK", [(b"", f"Date: {email.utils.format_datetime(dt.datetime.fromisoformat(m['date'] + 'T10:00:00+00:00'))}\r\n".encode())]
    def append(self, box, flags, date, raw):
        self.appended.append((box, flags, raw)); return "OK", [b""]


def _check():
    import tempfile
    sys.path.insert(0, str(Path(__file__).parent)); import ingest
    d = Path(tempfile.mkdtemp())
    db = sqlite3.connect(d / "j.db"); db.row_factory = sqlite3.Row; ingest.migrate(db)
    resume = d / "Resume_NERA.docx"; resume.write_bytes(b"PK fake docx")
    db.execute("""insert into jobs (key, source, url, title, company, location, description, status, net, decided_at, materials)
                  values ('nera|analyst|chicago','t','u','Analyst','NERA Economic Consulting','Chicago','d','pursued',0,'2026-11-02',?)""",
               (json.dumps({"resume": str(resume), "cover": "c.docx"}),))
    add = lambda kind, name, mail: db.execute("""insert into people (job_key, kind, name, linkedin, email, email_subject, email_body)
        values ('nera|analyst|chicago',?,?,?,?,'IU grad — Analyst','Hi there')""", (kind, name, "li/" + name, mail)).lastrowid
    m, r, a, none = add("manager", "Mo", "mo@nera.com"), add("recruiter", "Ri", "ri@nera.com"), add("alum", "Al", "al@nera.com"), add("alum", "No", None)
    fake = FakeImap({SENT: [{"from": "me", "to": "mo@nera.com", "date": "2026-11-03", "text": ""},
                            {"from": "me", "to": "ri@nera.com", "date": "2026-11-04", "text": ""}],
                     INBOX: [{"from": "Ri <ri@nera.com>", "to": "me", "date": "2026-11-05", "text": "happy to chat"},
                             {"from": "jobs@myworkday.com", "to": "me", "date": "2026-11-03", "text": "NERA: Thank you for applying to Analyst"},
                             {"from": "x@other.com", "to": "me", "date": "2026-10-01", "text": "Thank you for applying — NERA"}]})
    # draft: manager gets the resume attached, alum does not, nobody without an address
    out = draft(db, fake, "me@example.com", m)
    assert out["attached"] and fake.appended[0][0] == DRAFTS and b"Resume_NERA.docx" in fake.appended[0][2]
    assert draft(db, fake, "me@example.com", a)["attached"] is False and b"Resume_NERA" not in fake.appended[1][2]
    try: draft(db, fake, "me@example.com", none); raise AssertionError("drafted without an address")
    except SystemExit as e: assert "no email" in str(e)
    assert db.execute("select email_state from people where id=?", (m,)).fetchone()[0] == "drafted"
    # sync: sent with its date, a reply beats sent, the Workday confirmation marks applied
    assert sync(db, fake) == {"sent": 1, "replied": 1, "applied": 1}
    st = {row["name"]: (row["email_state"], row["sent_at"]) for row in db.execute("select * from people")}
    assert st["Mo"] == ("sent", "2026-11-03") and st["Ri"][0] == "replied" and st["Al"][0] == "drafted", st
    assert db.execute("select applied from jobs").fetchone()[0] == "confirmed"
    assert sync(db, fake) == {"sent": 0, "replied": 0, "applied": 0}             # idempotent
    print("gmail self-check ok")


if __name__ == "__main__":
    if "--check" in sys.argv:
        _check(); sys.exit(0)
    if len(sys.argv) < 2 or sys.argv[1] not in ("draft", "sync"):
        print(__doc__); sys.exit(2)
    db = sqlite3.connect(os.environ.get("JOBS_DB", "data/jobs.db")); db.row_factory = sqlite3.Row
    imap, me = connect()
    try:
        print(json.dumps(draft(db, imap, me, int(sys.argv[2])) if sys.argv[1] == "draft" else sync(db, imap)))
    finally:
        imap.logout()
