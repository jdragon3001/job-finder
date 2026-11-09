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
2. **Your profile** — in `~/job-finder/profile/` (git-ignored, never uploaded):
   - `profile.yaml`: what you want, where, pay floor, experience rule.
   - `profile/facts.md`: every fact and approved resume bullet Claude may use (shape: `profile/facts.example.md`).
     Easiest: put your resume, cover letters and a few emails in `profile/uploads/` and ask Claude Code to
     "write profile/facts.md from my uploads following profile/facts.example.md", then read it carefully.
   - `profile/resume.docx` and `profile/cover.docx`: your real Word files (Google Docs: File → Download →
     Microsoft Word). A PDF converted to Word won't do — tailoring edits your exact file.
   - Searching outside Chicago? Change `LOCATIONS` and `NEAR` at the top of `scripts/harvest.py` and the
     Built In city in `BUILTIN_LISTS`.
3. **Optional** — `cp .env.example .env` and add a Gmail app password (drafts + status) and a Treg key (emails).
4. **Start** by double-clicking **Start Job Finder** in the `job-finder` folder (`start.sh` on Linux).
   Keep the window it opens; the dashboard opens at <http://localhost:3456>. The first search run starts by itself and takes a while.

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
