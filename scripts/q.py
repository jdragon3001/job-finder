"""Read-only query for the prompts (the sqlite3 CLI isn't on Windows):
   python3 scripts/q.py [--json] "select ..."     rows print as a|b|c, or a JSON array with --json"""
import json, sqlite3, sys

as_json = sys.argv[1:2] == ["--json"]
db = sqlite3.connect("file:data/jobs.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
rows = db.execute(sys.argv[-1]).fetchall()
if as_json:
    print(json.dumps([dict(r) for r in rows], ensure_ascii=False))
else:
    for r in rows:
        print("|".join("" if v is None else str(v) for v in r))
