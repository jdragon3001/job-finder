# Find networking-only firms (weekly)

Find employers that fit her `wants` (`profile/profile.json`, best first) with an office within `radius_miles` of
one of her `locations` that hire at her `level` but have **no matching open posting** in `data/jobs.db`.
Firms that hire in classes or recruit through referrals before posting are the best kind.

Rules: public web only; never log in; skip firms already in the DB (`python3 scripts/q.py "select company from jobs"`
— compare by first word of the name); nothing in her `never` list.

For each firm (aim for 5–15), append to `data/inbox/firms-YYYY-MM-DD.jsonl` a candidate line with the firm's
careers page as `url`, and a verdict line:
```json
{"source":"firms","url":"<careers page>","title":"<role> · no posting yet","company":"<firm>","location":"<city, state>","net":true,"description":"<200+ chars: what the firm does there, how it hires at her level, why it fits her>"}
{"url":"<careers page>","verdict":"pass","score":80,"category":"<one of her wants, copied exactly>","why":"<one sentence>","ghost":"unchecked"}
```
Then run `python3 scripts/ingest.py` and finish with one line: firms added.
