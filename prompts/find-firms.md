# Find networking-only firms (weekly)

Find firms in her target categories (`profile/profile.yaml` → wants) with an office in her area (`profile.yaml` → locations) that hire
entry-level analysts but have **no matching open posting** in `data/jobs.db`. Economic consultancies that hire
analyst classes are the best kind (they often recruit through referrals before posting).

Rules: public web only; never log in; skip firms already in the DB (`python3 scripts/q.py "select company from jobs"`
— compare by first word of the name); never sales, never commercial real estate.

For each firm (aim for 5–15), append to `data/inbox/firms-YYYY-MM-DD.jsonl` a candidate line with the firm's
careers page as `url`, and a verdict line:
```json
{"source":"firms","url":"<careers page>","title":"Analyst · no posting yet","company":"<firm>","location":"Chicago, IL","net":true,"description":"<200+ chars: what the firm does in Chicago, how it hires analysts, why it fits her>"}
{"url":"<careers page>","verdict":"pass","score":80,"category":"<category>","why":"<one sentence>","ghost":"unchecked"}
```
Then run `python3 scripts/ingest.py` and finish with one line: firms added.
