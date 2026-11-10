# Build her profile from her uploads

She pressed **Build my profile** on the Profile page. Goal: `profile/facts.md` filled in the shape of
`profile/facts.example.md` from her own files only. (What she's looking for lives in `profile/profile.json`;
leave it alone.) Every later run trusts this file, so nothing goes in that her files don't show.

## Read
- Everything in `profile/uploads/` (`resumes/`, `cover-letters/`, `writing/`, `context/`). PDFs with Read;
  a `.docx` with `python3 scripts/tailor.py text "<file>"`.
- `profile/resume.docx` and `profile/cover.docx` the same way, if present.
- `profile/facts.md`, if present, and `profile/profile.json` for context.

## Write `profile/facts.md`
- Follow `profile/facts.example.md` section by section.
- **Bullet bank**: every bullet in `profile/resume.docx`, copied word for word (tailoring refuses any line that
  isn't an exact match), grouped under its role heading, IDs like `R1`, `W1`. Bullets from older resumes in
  `uploads/resumes/` that aren't in `resume.docx` go under their role too, marked `(older resume)`.
- **Facts used in cover letters**: the numbers and stories she actually tells, in her words.
- **Voice**: how she opens and signs off, her usual LinkedIn note, phrases she leans on — from `cover-letters/` and `writing/`.
- If `facts.md` already exists, update it: keep every line she wrote that is still true, add what's new, never drop her edits.
- Never invent or round up a number, title, date or skill. Leave out anything you're unsure of.

Finish with one line: what you wrote and anything she should check.
