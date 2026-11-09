"""Load harvested and screened listings into the dashboard database (data/jobs.db).

One contract for every source: scripts and AI runs alike write JSON lines to data/inbox/.
  candidates:  {source, url, title, company, location, description, posted?, salary?, ...}
  verdicts:    {key or url, verdict: pass|reject|needs_masters, score?, why?, flags?, evidence?, ...}
A job's identity is company|title|location (lowercased), so the same job from two boards is one row.
Bad lines are skipped and listed in data/inbox/errors.log instead of breaking the run.
Processed files move to data/inbox/done/.

Usage: python3 scripts/ingest.py [--db data/jobs.db] [--inbox data/inbox]
"""
import argparse, datetime as dt, json, re, sqlite3, sys
from pathlib import Path

SCHEMA = """
create table if not exists jobs (
  key text primary key,            -- company|title|location, lowercased
  source text, url text, title text, company text, location text,
  posted text, salary text, seniority text, employment text, description text,
  first_seen text,
  verdict text,                    -- null until screened: pass | reject | needs_masters
  score integer, category text, work_mode text, why text, reason text,
  flags text, evidence text, breakdown text,   -- JSON
  status text default 'new'        -- new | pursued | passed | done (set by the dashboard)
);
create table if not exists people (
  id integer primary key,
  job_key text not null references jobs(key),
  kind text not null,              -- manager | recruiter | alum
  name text not null, title text, linkedin text, email text,
  note text, email_subject text, email_body text,
  chosen integer default 1,        -- 1 = one of the 3 shown; 0 = alternate she can swap in
  note_sent integer default 0,     -- the one thing she ticks by hand
  email_state text default 'none', -- none | drafted | sent | replied  (read from Gmail)
  sent_at text,
  unique (job_key, linkedin)
);
create table if not exists runs (
  id integer primary key, kind text, started text, finished text, ok integer, log text
);
"""
# Columns added after the first release; ALTER is idempotent via the try in migrate().
ADDED_COLUMNS = {
    "net": "integer default 0",   # 1 = networking-only firm, no posting
    "ghost": "text",              # confirmed | not_found | unchecked
    "applied": "text",            # null | opened | confirmed (confirmed = "thanks for applying" email seen)
    "prep": "text",               # null | queued | running | ready | failed  (people + materials for a pursued job)
    "materials": "text",          # JSON: {resume, cover, diff:[...], cover_para} written by the prepare step
    "decided_at": "text",
}
CANDIDATE_REQUIRED = ("source", "url", "title", "company", "location", "description")
PERSON_REQUIRED = ("job_key", "kind", "name", "linkedin")
KINDS = {"manager", "recruiter", "alum"}


def migrate(db):
    db.executescript(SCHEMA)
    have = {r[1] for r in db.execute("pragma table_info(jobs)")}
    for col, decl in ADDED_COLUMNS.items():
        if col not in have:
            db.execute(f"alter table jobs add column {col} {decl}")
VERDICTS = {"pass", "reject", "needs_masters"}


SUFFIX = re.compile(r"\b(inc|llc|ltd|co|corp|corporation|company|international|services|consulting|group|holdings|the|u\.?s\.?)\b\.?")


def norm(company, title, location):
    """Same job from two boards must collide: 'Huron Consulting Services LLC' == 'Huron',
    'Chicago, IL 60607' == 'Chicago, IL (hybrid)'."""
    c = re.sub(r"[^a-z0-9 ]", " ", SUFFIX.sub(" ", company.lower())).split()
    t = re.sub(r"\(.*?\)|[^a-z0-9 ]", " ", title.lower()).split()
    city = re.split(r"[,(]", location.lower())[0].strip()
    return "|".join([c[0] if c else "", " ".join(t), city])


def key_of(r):
    if r.get("key") and not r.get("company"):
        return norm(*(r["key"].split("|") + ["", "", ""])[:3])
    return norm(str(r.get("company", "")), str(r.get("title", "")), str(r.get("location", "")))


def clean_pay(s):
    s = re.sub(r"\s+", " ", str(s or "")).replace("Base pay range", "").strip()
    return "" if re.fullmatch(r"\$?-?/?(year|yr)?", s) else s


def ingest_line(db, r):
    """Returns None on success, or a reason string."""
    if r.get("type") == "person":
        missing = [f for f in PERSON_REQUIRED if not str(r.get(f, "")).strip()]
        if missing:
            return "person missing " + ", ".join(missing)
        if r["kind"] not in KINDS:
            return f"person kind must be one of {sorted(KINDS)}"
        k = key_of({"key": r["job_key"]})
        if not db.execute("select 1 from jobs where key=?", (k,)).fetchone():
            return "person for a job that does not exist"
        db.execute("""insert into people (job_key, kind, name, title, linkedin, email, note, email_subject, email_body, chosen)
                      values (?,?,?,?,?,?,?,?,?,?) on conflict (job_key, linkedin) do update set
                      title=excluded.title, email=coalesce(excluded.email, people.email), note=excluded.note,
                      email_subject=excluded.email_subject, email_body=excluded.email_body""",
                   (k, r["kind"], r["name"], r.get("title"), r["linkedin"], r.get("email") or None, r.get("note"),
                    r.get("email_subject"), r.get("email_body"), 1 if r.get("chosen", True) else 0))
        return None
    if r.get("type") == "materials":
        k = key_of({"key": str(r.get("job_key", ""))})
        if not db.execute("select 1 from jobs where key=?", (k,)).fetchone():
            return "materials for a job that does not exist"
        if not (r.get("resume") and r.get("cover")):
            return "materials need resume and cover file paths"
        db.execute("update jobs set materials=? where key=?", (json.dumps({f: r.get(f) for f in ("resume", "cover", "diff", "cover_para")}), k))
        return None
    if "verdict" in r:
        if r["verdict"] not in VERDICTS:
            return f"verdict must be one of {sorted(VERDICTS)}"
        k = key_of(r) if (r.get("key") or r.get("company")) else None
        row = db.execute("select key from jobs where key=?", (k,)).fetchone() if k else None
        if not row and r.get("url"):
            row = db.execute("select key from jobs where url=?", (r["url"],)).fetchone()
        if not row:
            return "verdict for a job that was never harvested"
        if r.get("ghost") not in (None, "confirmed", "not_found", "unchecked"):
            return "ghost must be confirmed | not_found | unchecked"
        db.execute("""update jobs set verdict=?, score=?, category=?, work_mode=?, why=?, reason=?,
                      flags=?, evidence=?, breakdown=?, ghost=coalesce(?, ghost) where key=?""",
                   (r["verdict"], r.get("score"), r.get("category"), r.get("work_mode"), r.get("why"),
                    r.get("reason"), json.dumps(r.get("flags")), json.dumps(r.get("evidence")),
                    json.dumps(r.get("breakdown")), r.get("ghost"), row[0]))
        if clean_pay(r.get("salary")):  # pay the screener read in the description beats an empty board field
            db.execute("update jobs set salary=? where key=? and coalesce(salary,'')=''", (clean_pay(r["salary"]), row[0]))
        return None
    missing = [f for f in CANDIDATE_REQUIRED if not str(r.get(f, "")).strip()]
    if missing:
        return "missing " + ", ".join(missing)
    if len(r["description"]) < 200:
        return "description too short (a snippet, not the listing)"
    # Insert-or-ignore: the first board to report a job owns the row; repeats are no-ops.
    db.execute("""insert or ignore into jobs (key, source, url, title, company, location, posted, salary,
                  seniority, employment, description, first_seen, net) values (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (key_of(r), r["source"], r["url"], r["title"].strip(), r["company"].strip(), r["location"].strip(),
                r.get("posted", ""), clean_pay(r.get("salary")), r.get("seniority", ""), r.get("employment", ""),
                r["description"], dt.date.today().isoformat(), 1 if r.get("net") else 0))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/jobs.db")
    ap.add_argument("--inbox", default="data/inbox")
    a = ap.parse_args()
    inbox = Path(a.inbox); (inbox / "done").mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(a.db); migrate(db)
    ok = bad = 0
    with open(inbox / "errors.log", "a") as log:
        # Candidates before verdicts, so a verdict never arrives ahead of its job.
        files = sorted(inbox.glob("*.jsonl"), key=lambda p: ("screened" in p.name, p.name))
        for f in files:
            for n, line in enumerate(f.read_text().splitlines(), 1):
                if not line.strip():
                    continue
                try:
                    err = ingest_line(db, json.loads(line))
                except (json.JSONDecodeError, TypeError, AttributeError) as e:
                    err = f"not valid JSON: {e}"
                if err:
                    bad += 1; log.write(f"{f.name}:{n}: {err}\n")
                else:
                    ok += 1
            f.rename(inbox / "done" / f.name)
    db.commit()
    total, passed = db.execute("select count(*), sum(verdict='pass') from jobs").fetchone()
    print(f"ingested {ok} lines, skipped {bad} (see {inbox}/errors.log) · jobs: {total} · passing: {passed or 0}")


def _check():
    db = sqlite3.connect(":memory:"); migrate(db)
    job = {"source": "indeed", "url": "u1", "title": "Analyst", "company": "NERA", "location": "Chicago, IL", "description": "x" * 300}
    assert ingest_line(db, job) is None
    assert ingest_line(db, dict(job, source="linkedin", url="u2")) is None            # same job, other board
    assert db.execute("select count(*), source from jobs").fetchone() == (1, "indeed")
    assert ingest_line(db, {**job, "description": "short"}) .startswith("description")
    assert ingest_line(db, {"url": "u1", "verdict": "pass", "score": 90}) is None    # verdict by url
    assert db.execute("select verdict, score from jobs").fetchone() == ("pass", 90)
    assert ingest_line(db, {"url": "nope", "verdict": "pass"}).startswith("verdict for")
    assert ingest_line(db, {"url": "u1", "verdict": "maybe"}).startswith("verdict must")
    assert norm("Huron Consulting Services LLC", "Consulting Analyst, Digital (Chicago, IL)", "Chicago, IL 60607") \
        == norm("Huron", "Consulting Analyst, Digital", "Chicago, IL")
    assert norm("Euromonitor International", "Consultant", "Chicago, IL") == norm("Euromonitor", "Consultant", "Chicago, IL (hybrid)")
    assert norm("Mars", "Analyst", "Chicago, IL") != norm("Mesirow", "Analyst", "Chicago, IL")
    assert clean_pay("Base pay range\n   \n  $78,000.00/yr - $85,000.00/yr") == "$78,000.00/yr - $85,000.00/yr"
    assert clean_pay("$-/year") == ""
    assert ingest_line(db, {"key": "nera|analyst|chicago, il", "verdict": "pass", "salary": "$100K"}) is None  # old raw key still maps
    assert db.execute("select salary from jobs").fetchone() == ("$100K",)
    k = norm("NERA", "Analyst", "Chicago, IL")
    person = {"type": "person", "job_key": k, "kind": "manager", "name": "Pat Doe", "linkedin": "https://linkedin.com/in/patdoe"}
    assert ingest_line(db, person) is None
    assert ingest_line(db, dict(person, title="Manager")) is None                      # same person again: update, no dup
    assert db.execute("select count(*), title from people").fetchone() == (1, "Manager")
    assert ingest_line(db, dict(person, kind="ceo")).startswith("person kind")
    assert ingest_line(db, dict(person, job_key="x|y|z")).startswith("person for a job")
    assert ingest_line(db, {"type": "person", "job_key": k}).startswith("person missing")
    assert ingest_line(db, {"url": "u1", "verdict": "pass", "ghost": "maybe"}).startswith("ghost must")
    assert ingest_line(db, {"url": "u1", "verdict": "pass", "ghost": "not_found"}) is None
    assert db.execute("select ghost from jobs").fetchone() == ("not_found",)
    assert ingest_line(db, {**job, "url": "u9", "title": "Firm outreach", "net": True}) is None
    assert db.execute("select net from jobs where url='u9'").fetchone() == (1,)
    assert ingest_line(db, {"type": "materials", "job_key": k, "resume": "a.docx"}).startswith("materials need")
    assert ingest_line(db, {"type": "materials", "job_key": k, "resume": "a.docx", "cover": "b.docx", "diff": ["-x", "+y"]}) is None
    assert json.loads(db.execute("select materials from jobs where key=?", (k,)).fetchone()[0])["diff"] == ["-x", "+y"]
    migrate(db)                                                                          # re-running is safe
    print("ingest self-check ok")


if __name__ == "__main__":
    _check() if "--check" in sys.argv else main()
