# Harvest the job boards that block scripts

`scripts/harvest.py` covers LinkedIn and Built In with plain HTTP. Rate limits: these boards block
after a few dozen pages in a burst, so pause a few seconds between pages, and on a block (403, 429,
"Just a moment", "Security Check") wait a minute, retry once, then move to the next board. Never try
to get past a CAPTCHA or log in. Indeed, Glassdoor and ZipRecruiter
block that, so you collect them with a crawl tool if one is available (e.g. `firecrawl_scrape`), otherwise
`WebFetch`; if a board blocks both, say so in your final line and move on. You only **collect** here;
`prompts/find-jobs.md` does the judging.

## Searches

Run every query below on every board, Chicago and remote, posted in the last `DAYS` days (default 1;
7 on a first run). Use the boards' own entry-level filters — they are the cheapest way to cut volume.

Queries: research analyst · research associate · research assistant · economic analyst · economic
consultant · policy analyst · market research analyst · data analyst · business analyst · strategy
analyst · pricing analyst · energy analyst · market analyst · consulting analyst · investment research ·
credit analyst · insights analyst · analyst I · associate analyst · junior analyst · new grad analyst

In priority order. Indeed and ZipRecruiter listings pass screening 2× as often as LinkedIn's (11–14% vs
7% in the Nov 2026 test), so cover them fully before anything else.

| Board | Search URL (fill `{q}`, `{loc}`) |
|---|---|
| Indeed | `https://www.indeed.com/jobs?q={q}&l={loc}&fromage={DAYS}&sc=0kf%3Aexplvl(ENTRY_LEVEL)%3B` with `{loc}` = `Chicago, IL` (radius 25) and `Remote` |
| ZipRecruiter | `https://www.ziprecruiter.com/jobs-search?search={q}&location={loc}&days={DAYS}&refine_by_experience_level=entry` |
| Idealist | `https://www.idealist.org/en/jobs?q={q}&locationString={loc}` (nonprofit research/policy) |
| Handshake | only if the user is logged in to Handshake in the browser tool; otherwise skip and say so |

Skip Glassdoor: its listing pages sit behind a Cloudflare challenge and its results are mostly Indeed's
jobs again (its links carry Indeed job keys). Ignore fake-looking Indeed links such as
`viewjob?jk=a1b2c3d4e5f67890`; they are page decoys, not jobs.

Page through results until a page brings nothing new or 5 pages per query, whichever comes first.

## For each result

1. Drop it by **title alone** if it is plainly wrong: senior/lead/manager/director, engineer/developer,
   nurse/clinical/lab technician, sales/account executive/business development, intern, accountant,
   customer service. When unsure, keep it.
2. Skip it if it is already known: `sqlite3 -readonly data/jobs.db "select 1 from jobs where key=lower('<company>|<title>|<location>') or url='<url>'"`
   returns a row, or it is already in today's inbox file.
3. Open the listing (or the employer's page it links to) and capture the **full description**, copied
   from the page, never summarized, trimmed or retyped — the screener quotes it word for word. If the
   full text won't load, skip it rather than guess.
4. Append one line to `data/inbox/boards-YYYY-MM-DD.jsonl` (today's date). This exact shape is the
   contract `scripts/ingest.py` enforces; a line missing a field or with a snippet-length description
   is rejected into `data/inbox/errors.log`:

```json
{"id":"indeed-<jobkey>","source":"indeed","url":"<listing url>","title":"","company":"","location":"",
 "posted":"YYYY-MM-DD","salary":"","seniority":"","employment":"","description":"<full text>"}
```

Location must be Chicagoland (any suburb) or remote; skip other cities here to save time.

Finish with one line per board: results seen, kept, skipped as duplicates, failed to load.
