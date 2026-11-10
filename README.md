# Job Finder

A local app that runs an entry-level job search on **your own Claude Code subscription**. Each day it finds
postings that fit your rules, checks them against the company's careers page, and lists them for you to
**Pursue** or **Pass**. For each job you pursue it finds 3 people (manager, recruiter, alum), writes a
LinkedIn note and an email for each in your voice, and tailors your own resume and cover letter (only the
words change — your Word layout is untouched). It reads your Gmail to tick off what you've sent and who replied.

Nothing is sent for you: emails become Gmail drafts, LinkedIn notes are copy-paste, applications are yours.

## Setup (10 minutes)

1. **Install** (you need a Claude Pro or Max plan). Paste one line:
   - **Mac / Linux** — in Terminal:
     ```bash
     curl -fsSL https://raw.githubusercontent.com/jdragon3001/job-finder/main/install.sh | sh
     ```
   - **Windows** — in PowerShell:
     ```powershell
     irm https://raw.githubusercontent.com/jdragon3001/job-finder/main/install.ps1 | iex
     ```
   It puts everything in a `job-finder` folder in your home folder, adds whatever's missing (Node, Python,
   Claude Code, and on Windows Git Bash) without admin rights, and asks you to log in to Claude.
   Run the same line again later to update; your profile and data stay.
2. **Start** by double-clicking **Start Job Finder** in the `job-finder` folder (`start.sh` on Linux).
   Keep the window it opens; the dashboard opens at <http://localhost:3456>.
3. **Profile** (left sidebar) — everything else happens here, no folders to dig through:
   - Upload your real resume and cover letter as Word files (Google Docs: File → Download → Microsoft Word).
   - **Talk it through with Claude**: it asks what you've done and liked, suggests kinds of jobs if you're
     not sure, and fills in your search — job types, cities, distance, remote/hybrid/on-site, level, pay.
     Every setting shows on the page; press Edit to change any of it.
   - Drop in past resumes, cover letters and a few emails you wrote, then press **Build my profile**.
     Claude writes down the facts it may use about you; read them over and fix anything on the same page.
   - Optional: connect Gmail (drafts + replies) and paste a Treg key (contact emails).
   The **Guide** button in the sidebar shows what's left and what to do next. The first search starts by itself
   once your search is set.

Working on the code instead? Clone the repo, then `npm install && npm run dev`.

Your profile, `.env` and `data/` (the database, run logs, generated files) are git-ignored and never leave your laptop
except through the services you connect.

## How it works

| Piece | What |
|---|---|
| `app/`, `lib/` | Next.js dashboard + API over `data/jobs.db` (SQLite). `lib/runner.js` starts `claude -p` runs. |
| `prompts/daily-run.md` | Collect → screen (with ghost check) → weekly networking-only firms. Runs when the app opens and the last run is > 24 h old. |
| `prompts/prepare-job.md` | One pursued job: people, notes, emails, tailored resume + cover. |
| `scripts/ingest.py` | The only writer of job data; validates every line Claude produces. |
| `scripts/tailor.py` | Edits your .docx text and refuses anything else (layout change, invented bullet, page overflow). |
| `scripts/gmail.py` | Gmail drafts + reading sent / replies / "thanks for applying". Never sends. |

Runs are logged in `data/runs/<id>.log`.

## Tests

```bash
npm test                                     # store + runner (fake claude)
python3 scripts/ingest.py --check && python3 scripts/tailor.py --check && python3 scripts/gmail.py --check
npm run build && node tests/ui.e2e.mjs       # drives the real UI in Chrome on a throwaway DB
```
