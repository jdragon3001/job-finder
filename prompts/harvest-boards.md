# Harvest the boards the script doesn't cover

`scripts/harvest.py` covers LinkedIn and Built In. Fetch pages here with the crawl tool if you have one
(`firecrawl_scrape`; `firecrawl_search` for discovery), otherwise `WebFetch`. Pause a few seconds between
pages. If a board answers with a security check, CAPTCHA or "verify you are human" page, that board does
not want automated visitors: **skip it for this run and say so** — never try to get past it, never log in.
You only **collect** here; `prompts/find-jobs.md` does the judging.

## Searches

Read `profile/profile.json`. Run every `search_terms` entry on every board, for each of her `locations`
(within `radius_miles`) and, if `remote` is on, remote — posted in the last `DAYS` days (default 1; 7 on a
first run). Use the boards' own filters for her `level` and `job_types` — they are the cheapest way to cut
volume.

ZipRecruiter listings passed screening about 2× as often as LinkedIn's in the first user's test, so cover
it fully first. Fill `{level}` with the board's own term for her level (entry,
mid, senior…), or drop that filter if she wants more than one level.

| Board | Search URL (fill `{q}`, `{loc}`) |
|---|---|
| ZipRecruiter | `https://www.ziprecruiter.com/jobs-search?search={q}&location={loc}&days={DAYS}&radius={radius_miles}&refine_by_experience_level={level}` |
| Idealist | `https://www.idealist.org/en/jobs?q={q}&locationString={loc}` (nonprofits — only if her `wants` include nonprofit or mission-driven work) |
| Handshake | only if the user is logged in to Handshake in the browser tool; otherwise skip and say so |

Skip Indeed and Glassdoor: both put job searches behind a bot check.

Page through results until a page brings nothing new or 5 pages per query, whichever comes first.

## For each result

1. Drop it by **title alone** if it is plainly wrong for her: a title containing one of her `exclude_titles`,
   a level far from her `level`, or (when `include_titles` isn't empty) a title with none of those words.
   When unsure, keep it.
2. Skip it if it is already known: `python3 scripts/q.py "select 1 from jobs where key=lower('<company>|<title>|<location>') or url='<url>'"`
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

Location must be within `radius_miles` of one of her `locations`, or remote if she wants remote; skip other places here to save time.

Finish with one line per board: results seen, kept, skipped as duplicates, failed to load.
