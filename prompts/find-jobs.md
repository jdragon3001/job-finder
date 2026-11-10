# Find jobs: screening prompt

You are screening job listings for one specific person. Your job is to find every listing she could
realistically get and would actually want, and to throw out everything else. A list padded with weak
fits wastes her morning; a good fit you reject is a job she never hears about. Both are failures.

## Who she is

Read `profile/profile.json` and `profile/facts.md` before anything else. The profile is what she asked for:
`wants` (kinds of jobs, best first), `never`, `tools`, `locations` + `radius_miles` + `remote`, `work_modes`,
`level`, `job_types`, `pay_floor` / `pay_floor_remote`, `experience_rule`, and `notes` (anything else — read it,
it often holds the deciding detail). **Every rule below is read from it.** The examples further down were
written for the first user (an entry-level economics graduate in Chicago); apply the same reasoning to
whoever this profile describes, never her specifics.

## Inputs

Every listing not yet judged, exported from the database:

```bash
python3 scripts/q.py --json "select key, url, title, company, location, posted, salary, seniority, employment, description from jobs where verdict is null" > data/to-screen.json
```

Each has the full `description`. Harvesting already removed obvious misfits by title only — **you are
the first one to read the descriptions.** Never judge from anything shorter than the full text.

## Step 1: hard rules (any failure = reject)

Judge from the description, never from the title or LinkedIn's seniority label. Quote the exact line
that decided each rule.

| Rule | Passes | Fails |
|---|---|---|
| **Experience** | Within `experience_rule` and `level`. For entry level: no years required, a range starting at 0, "recent graduates", years only under *preferred*, "degree **or** N years". **Stretch** (pass, flag `stretch`): one notch above what the rule allows, if the rule says stretches are OK | More years than the rule allows; years tied to a field she hasn't worked in (check `facts.md`); "internship experience required" when she has none |
| **Required skills** | Required skills she has (`tools`, `facts.md`) or plainly could learn on the job; anything only "preferred", "a plus", "familiarity" | A required skill, license or certification she clearly lacks (a programming language, an RN license, a CPA…) |
| **Location** | Within `radius_miles` of one of her `locations`; fully remote in her country if `remote` is on (respect any state limits the posting names and anything in `notes`) | Elsewhere; remote that excludes where she lives |
| **Work mode** | One of her `work_modes` | A mode she didn't pick (flag if unstated) |
| **Pay** | Posted midpoint ≥ `pay_floor` (in person/hybrid) or ≥ `pay_floor_remote` (remote); a floor of 0 means any; **no pay posted = keep, flag "pay unknown"** | Midpoint under the floor; hourly pay that annualizes under it; commission-only pay |
| **Type** | One of her `job_types` | Any other (internship, part-time, contract, unpaid… unless she picked it) |
| **Grad window** | Open to her graduation status (`grad`), or no window stated | Programs limited to current students or a graduation window she misses |
| **Education** | Her `degree` meets it | Requires a degree she doesn't have (master's required when she has a bachelor's → keep in a separate `needs_masters` list) |
| **Never** | — | Anything in `never`: judge by what the job really is, not keywords ("presents findings to clients" isn't sales; quota, pipeline, prospecting and cold outreach are) |

## Step 2: junk detection (reject even if every rule passes)

These listings look like fits and are not. Reject them and say which pattern:

- **Staffing-agency reposts** with no named employer ("our client", "a leading firm") and generic duties.
- **Analyst in name only**: accounts payable/receivable, collections, claims processing, data entry,
  order entry, scheduling, billing, help desk, QA testing of call scripts.
- **Phone or field survey work**: "research interviewer", "survey associate" that is calling people.
- **Disguised sales**: "business analyst" or "consultant" at an insurance agency, marketing agency or
  software vendor whose real job is selling or onboarding customers.
- **Mass-hiring MLM/financial-rep programs**: "financial analyst trainee" that is licensing + selling.
- **Stale or ghost listings**: reposted for months, or the description says the role is closed.

## Step 3: score what survives (0–100)

| Factor | Points | How |
|---|---|---|
| Role category | 30 | How well it matches `wants`, which is in priority order: the first item 30, then step down evenly to 12 for the last; any other genuinely relevant role 10 |
| Substance | 20 | The core work is what that kind of job should be (analysis, care, building, teaching…) = 20 · mixed = 10 · mostly something else = 0 |
| Fits her `never` | 15 | Nothing near it = 15 · brushes it = 10 · real overlap = 0 |
| Employer quality | 10 | Recognized employer or structured program for her level = 10 · established company = 6 · unknown/small = 3 |
| Pay | 10 | Well above her floor = 10 · comfortably above = 8 · at the floor = 5 · unknown = 3 |
| Work mode & place | 10 | Her first-listed city and preferred mode = 10, scaling down with distance and less-preferred modes |
| Level fit | 5 | Pitched exactly at her `level` = 5 · silent = 3 |

Keep everything scoring **55+**. Do not cap the count; if 80 listings genuinely pass, return 80.

`category` in your output must be copied exactly from her `wants` (the closest one), or `Other`. The
dashboard's filters are those words.

## Calibration (examples from the first user: an entry-level economics grad who knows Stata; reason the same way for this profile)

- *"Bachelor's in economics, finance or related field. Proficiency in Excel. Experience with Stata or
  Python preferred."* → Programming **passes** (preferred only).
- *"2+ years of experience in consulting or financial analysis required."* → Experience **fails**.
- *"Required: SQL and Python for data extraction."* → Programming **fails**, even if the title is "Research Analyst".
- *"Strong programming skills (e.g., Python, R, SAS, Stata)."* → **passes, flag "coding expected, Stata satisfies it"**: a requirement she can meet with a tool in her profile is not a blocker.
- *"1+ years of professional experience."* → **passes, flag `stretch`**: general, and her nonprofit year might count.
- *"1–3 years of experience in financial analysis."* → Experience **fails**: a field she has not worked in.
- *"2-5 years of relevant internship or professional experience."* → Experience **fails**: 2+ years.
- *"0–3 years of experience in an analytical role."* → **passes**: the range starts at 0.
- *"2+ years of corporate banking credit analysis experience."* → Experience **fails**: specific experience she doesn't have.
- *"3+ years of relevant experience."* → Experience **fails**.
- *"Preferred: 5+ years of experience"* with no required years → passes the rule, but the role is pitched far above her: flag `stretch`, Entry fit 0, and fail it if the duties assume that seniority (owning client relationships, leading teams).
- *"Research Associate"* at a real-estate brokerage tracking office leases → **fails** (CRE).
- *"Analyst"* whose duties are processing invoices and reconciling vendor statements → **junk** (analyst in name only).

## Working method

1. Read the profile. Count the candidates.
2. Work through `data/to-screen.json` in batches of 25. If you can start subagents, give each a batch,
   this whole file and its own output file (`data/inbox/screened-YYYY-MM-DD-<batch>.jsonl`), so no two
   writers share a file.
3. For every listing decide `pass`, `reject` or `needs_masters`. A reject needs one line: which rule or
   junk pattern, and the quote.
4. Never invent a fact. If the description doesn't say, the field is `null` and a flag says so.
5. **Ghost check, passes only.** Find the same role on the employer's own careers page (web search
   `"<title>" site:<company domain>` or the careers page itself; ATS hosts like myworkdayjobs.com,
   greenhouse.io, lever.co count). Set `"ghost"`: `confirmed` if it is open there, `not_found` if the careers
   page loads and the role isn't listed, `unchecked` if you couldn't load it. If the company page states
   different requirements, judge from the company page and say so in `why`.

## Output

Write `data/inbox/screened-YYYY-MM-DD.jsonl`, one object per listing you judged — **every** listing,
rejects included, or it will be screened again tomorrow. Copy `key` exactly from the export; it is how
`scripts/ingest.py` attaches your verdict to the job. Then run `python3 scripts/ingest.py`.

```json
{"key":"nera|immediate hire researcher antitrust|chicago","verdict":"pass","score":91,
 "title":"Immediate Hire Researcher – Antitrust","company":"NERA","location":"Chicago, IL",
 "work_mode":"hybrid, 3 days","salary":"$100,000","posted":"2026-11-06","url":"https://www.linkedin.com/jobs/view/4488450782",
 "category":"Economic consulting",
 "evidence":{"experience":"\"Bachelor's degree... no prior experience required\"","programming":"\"Stata or R a plus\""},
 "why":"Antitrust research at a top economic consultancy, open to new grads.",
 "flags":["coding used on the job"], "ghost":"confirmed",
 "breakdown":{"category":30,"substance":20,"no_sales":15,"employer":10,"pay":10,"mode":10,"entry":5}}
```

Rejects use the same shape with `verdict:"reject"`, `reason`, and the deciding quote under `evidence`.

Finish with one line: candidates read, passed, needs-master's, rejected (by top reasons).
