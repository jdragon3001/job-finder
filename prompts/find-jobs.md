# Find jobs: screening prompt

You are screening job listings for one specific person. Your job is to find every listing she could
realistically get and would actually want, and to throw out everything else. A list padded with weak
fits wastes her morning; a good fit you reject is a job she never hears about. Both are failures.

## Who she is

Read `profile/profile.yaml` and `profile/facts.md` before anything else: background, what she wants
(`wants`, in priority order), what she never wants (`never`), tools, locations, work mode, pay floor and
`experience_rule`. **The profile wins** wherever it differs from the defaults and examples below, which were
written for the first user (a recent economics graduate in Chicago aiming at research and analyst roles).

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
| **Experience** | No years required; a range starting at 0 ("0–2 years", "0–3 years"); "entry level"; "recent graduates"; years listed only under *preferred*; "degree **or** N years". **Stretch** (pass, flag `stretch`): exactly 1 year of *general* experience ("1+ years of professional experience", "minimum 1 year") — her nonprofit year might count | 2+ years required, of anything; any years tied to a field she has not worked in ("1–2 years in financial analysis", "1+ years of research or analytics", "1 year at a Big 4 firm", "prior consulting experience required"); "internship experience required" (she has none) |
| **Programming** | Python, R, SQL, Stata, SAS, VBA only "preferred", "a plus", "familiarity", "willing to learn"; Excel/Tableau/SPSS required is fine; "Excel, Stata or R" (any one) is fine | Any programming language under *required/minimum/must have* |
| **Location** | Chicago and any Chicagoland suburb (Evanston, Schaumburg, Naperville, Oak Brook, Downers Grove, Lake Forest…); fully remote in the US with Illinois eligible | Wisconsin; on-site in other states; remote that excludes Illinois; far-out Illinois towns (Rockford, Peoria, Springfield…) |
| **Work mode** | Hybrid or remote; on-site is OK only if the commute is inside Chicago/Evanston | — (flag if unstated) |
| **Pay** | Posted midpoint ≥ $65K (hybrid/on-site) or ≥ $55K (remote); **no pay posted = keep, flag "pay unknown"** | Posted midpoint under the floor; hourly roles that annualize under it; commission-based pay |
| **Type** | Full-time, salaried or hourly W-2 | Internship, part-time, 1099/contract-to-nowhere, unpaid, stipend fellowship |
| **Grad window** | Open to people who already graduated, or no window stated | Campus programs limited to current students or a future graduation window her `grad_year` misses |
| **Education** | Bachelor's | PhD required (master's required → keep in a separate `needs_masters` list) |
| **Not sales** | Presents findings to clients is fine | Quota, pipeline, prospecting, lead generation, cold outreach, "drive revenue", account management, building pitch decks to win business, "client acquisition" |
| **Not CRE** | — | Commercial real estate brokerage, research or investment |

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
| Role category | 30 | Economic consulting 30 · Economic/policy research 26 · Tech/energy market research 22 · Financial-markets research 18 · Strategy consulting 12 · Other genuine analysis 10 |
| Substance | 20 | Core work is analysis, modeling, research, writing = 20 · mixed = 10 · mostly operational = 0 |
| No sales | 15 | None = 15 · presents to clients = 10 · any sales language in passing = 0 |
| Employer quality | 10 | Recognized firm, structured analyst/RA program, research institute, Fed, university = 10 · established company = 6 · unknown/small = 3 |
| Pay | 10 | ≥ $80K = 10 · $70–80K = 8 · at floor = 5 · unknown = 3 |
| Work mode & place | 10 | Evanston/Chicago hybrid ~3 days = 10 · remote = 8 · other Chicagoland = 7 · on-site Chicago = 5 |
| Entry fit | 5 | Explicitly for recent grads or 0–2 years = 5 · silent on experience = 3 |

Keep everything scoring **55+**. Do not cap the count; if 80 listings genuinely pass, return 80.

## Calibration

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
