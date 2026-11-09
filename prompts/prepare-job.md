# Prepare one pursued job: people, resume, cover letter, notes and emails

She pressed **Pursue** on the job whose key is at the end of this prompt. Make everything she needs to
act on it. You write files and inbox lines; `scripts/ingest.py` is the only thing that writes the database.

## 0. Read first
- The job: `python3 scripts/q.py --json "select key, title, company, location, url, description, why, net from jobs where key='<key>'"`
- `profile/profile.yaml`, `profile/facts.md` (the only source of facts about her — never claim anything not in it),
  and her writing in `profile/uploads/` for voice: `cover-letters/`, `writing/` (networking email), `context/` (project notes for interviews and emails), `resumes/` (all variants).
- `slug` = the key with every non-alphanumeric run replaced by `-`. Work in `data/materials/<slug>/`.

## 1. People (3 chosen + up to 2 alternates per kind)
Use web search on public pages only (LinkedIn public profiles via search results, the company site, press).
Never log in anywhere, never use her LinkedIn account, never bypass a CAPTCHA.

| kind | who | prefer |
|---|---|---|
| manager | leads the team this role sits on (the hiring manager if the posting names one) | same office as the job |
| recruiter | campus / early-career / talent recruiter for this office or function | same office |
| alum | went to her school (`profile.yaml` → school) and works in a similar role there | similar role, same office |

For a networking-only firm (`net=1`) the manager is someone who leads analysts in her city's office.
Pick the best of each kind as chosen; any others you found are alternates (`"chosen": false`). Only
include people whose current employer you saw on a page dated within the last year; skip anyone you are unsure of.
`linkedin` is their LinkedIn profile URL if you can find one (search `"<name>" <company> site:linkedin.com/in`);
otherwise the best public profile page (company bio). The app offers a LinkedIn search link in that case.
Try hard for all three kinds before giving up: recruiters often appear on the company's campus/careers pages,
in university career-fair listings, or in "<company> recruiter <city>" search results; alumni in
"<company> <school>" search results and on the company's people pages.

Email: `python3 scripts/emails.py find "<full name>" "<company website domain>"` prints an address or nothing.
If nothing, leave `email` empty — never guess an address.

## 2. Messages, per chosen and alternate person
- **LinkedIn note** ≤ 300 characters. Use her own pattern from `facts.md` → Voice (e.g. "Hi <first>! I recently
  applied to the <role> role at <company> in <city>. I'm a <degree> grad from <school> with … — I'd love to connect!").
  Make the "with …" part fit the person (alum: the shared school; recruiter: the role; manager: the team's work).
- **Email** 5–6 sentences, sent after the note, so it may open "I just sent you a connection request on LinkedIn."
  One concrete story from `facts.md` that matches the job. Close by asking for 15 minutes. Manager email says the resume is attached; others do not.
  Subject: `profile.yaml` → `email_subject` with `{role}` and `{company}` filled.
- Voice rules from `facts.md` → Voice. At most one of "incredibly grateful" / "excited to" / "passion" per message.
  Never: "leverage", "synergy", "I am writing to express", em-dash chains.

## 3. Resume and cover letter (skip for `net=1`)
Base files: `profile/resume.docx`, `profile/cover.docx`. If either is missing, write nothing for this
section and say so in your final line — the job will show as failed so she knows.

Resume edits: choose which bullets from the `facts.md` bullet bank appear and in what order, so the most
relevant come first for this job. Text must be a bank bullet exactly.
Write `data/materials/<slug>/resume-edits.json`:
```json
{"replace": [{"find": "<exact current paragraph text>", "with": "<bank bullet text>"}],
 "drop": ["<exact paragraph text to remove>"]}
```
Cover letter: `paragraphs` is the **whole body** (everything between "Dear …" and "Thank you…/Sincerely"):
1–2 new job-specific paragraphs in her voice, plus her own paragraphs from the template or `uploads/cover-letters/`
reused as written. Also `replace` the template's salutation and any company-specific lines (the template is
one of her real letters, so it names another company). Write
`data/materials/<slug>/cover-edits.json`: `{"paragraphs": [{"text": "...", "sources": ["R1", "B3"]}]}` —
every paragraph lists the bank IDs or `facts.md` lines it uses.

Then run, and fix your edits until both commands exit 0 (they refuse layout changes and over-length output):
```bash
python3 scripts/tailor.py resume profile/resume.docx data/materials/<slug>/resume-edits.json "data/materials/<slug>/<First>_Resume_<Company>.docx"
python3 scripts/tailor.py cover  profile/cover.docx  data/materials/<slug>/cover-edits.json  "data/materials/<slug>/<First>_Cover_<Company>.docx"
```
Each prints a JSON line with the before/after `diff`; keep it.

## 4. Hand off
Write `data/inbox/prepare-<slug>.jsonl`, one line per person and one materials line:
```json
{"type":"person","job_key":"<key>","kind":"manager","name":"","title":"","linkedin":"","email":"","note":"","email_subject":"","email_body":"","chosen":true}
{"type":"materials","job_key":"<key>","resume":"data/materials/<slug>/…docx","cover":"data/materials/<slug>/…docx","diff":["…"],"cover_para":"<first new paragraph>"}
```
Run `python3 scripts/ingest.py` and confirm `skipped 0`. Finish with one line: people found per kind, emails
found, materials made or why not.
