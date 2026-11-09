# Daily run

Run this once a day (the dashboard starts it with `claude -p "$(cat prompts/daily-run.md)"` when the
last run is over 24 hours old). Goal: by the end, every new listing in her locations (`profile.yaml`) that fits
the person in `profile/` is in `data/jobs.db` with a verdict, and nothing that doesn't fit is.

Work from the project root. Today's date is in `date +%F`; call it `TODAY`. `DAYS` is days since the
last run (`select max(first_seen) from jobs`), at least 1 and at most 7.

## 1. Collect (scripts) — fast, free

```bash
python3 scripts/harvest.py --days $DAYS
```

Writes `data/inbox/harvest-TODAY.jsonl` (LinkedIn + Built In). Then `python3 scripts/ingest.py`.

## 2. Collect (AI) — the boards scripts can't reach

Follow `prompts/harvest-boards.md` with `DAYS`. It writes `data/inbox/boards-TODAY.jsonl`. Then
`python3 scripts/ingest.py`, and read the last lines of `data/inbox/errors.log`: if more than a few of
your lines were rejected, fix the cause and re-run that part, don't leave them.

## 3. Judge

Follow `prompts/find-jobs.md`. It screens every job with no verdict and writes
`data/inbox/screened-TODAY*.jsonl`. Then `python3 scripts/ingest.py`.

## 3b. Networking-only firms, weekly

If `sqlite3 -readonly data/jobs.db "select count(*) from jobs where source='firms' and first_seen > date('now','-7 day')"`
prints 0, follow `prompts/find-firms.md`.

## 4. Check before you finish

```bash
sqlite3 -readonly data/jobs.db "select count(*) from jobs where verdict is null"          -- must be 0
sqlite3 -readonly data/jobs.db "select count(*) from jobs where verdict='pass' and ghost is null and first_seen='$TODAY'"  -- must be 0
sqlite3 -readonly data/jobs.db "select source, count(*), sum(verdict='pass') from jobs where first_seen='$TODAY' group by source"
```

If unscreened jobs remain, go back to step 3 for them. If a source returned nothing, say so — a silent
zero hides a broken scraper.

## Rules for the whole run

- **Everything goes through the inbox.** Never write to `data/jobs.db` directly; `scripts/ingest.py` is
  the only writer, so the dashboard sees one consistent shape no matter who found the job.
- Never invent a listing, date, salary or link. A field you couldn't read is empty, not guessed.
- Never bypass a CAPTCHA, log in as the user, or message anyone. This run only reads public listings.

End with one line: `found N new · passed P (stretch S) · needs master's M · sources: …`.
