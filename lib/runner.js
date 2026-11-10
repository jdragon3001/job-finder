// Starts Claude Code (`claude -p`) on her own login/subscription. One run per kind at a time; every run is
// logged to runs/<id>.log beside the database (data/runs/) and the runs table. The app never talks to an AI API directly.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, existsSync, writeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { open } from './store.js';

const ROOT = process.env.COPILOT_ROOT || process.cwd();
const CLAUDE = () => process.env.CLAUDE_BIN || 'claude';
const PY = () => process.env.COPILOT_PY || 'python3';
const STALE_HOURS = 6;          // a run "running" longer than this is treated as dead (laptop slept, killed)
const DAILY_EVERY_HOURS = 24;
export const UNDO_GRACE_MS = Number(process.env.UNDO_GRACE_MS ?? 10000);   // Pursue can be undone until preparation starts

// What each run may do without asking. No git, no network tools beyond fetch/search, no deletes.
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Bash(python3 scripts/*)', 'Bash(mkdir -p data/*)', 'Bash(ls *)', 'Bash(date*)'];
// A run once killed the job download to edit the scraper and restart it, throwing away 30 minutes of work.
const DENY = ['scripts', 'lib', 'app', 'prompts'].flatMap(d => [`Edit(${d}/**)`, `Write(${d}/**)`])
  .concat('Bash(kill *)', 'Bash(pkill *)');

const PROMPTS = {
  daily: (_, days) => readFileSync(join(ROOT, 'prompts/daily-run.md'), 'utf8') + `\n\nDAYS=${days}. The app already did step 1 before starting you.\n`,
  prepare: (key) => readFileSync(join(ROOT, 'prompts/prepare-job.md'), 'utf8') + `\n\nJob key: ${key}\n`,
  firms: () => readFileSync(join(ROOT, 'prompts/find-firms.md'), 'utf8'),
  profile: () => readFileSync(join(ROOT, 'prompts/build-profile.md'), 'utf8'),
};

export function running(db, kind) {
  return db.prepare(`select * from runs where kind=? and finished is null and started > datetime('now', ?)`)
    .get(kind, `-${STALE_HOURS} hours`) || null;
}

export function needsDaily(db) {
  const last = db.prepare(`select finished from runs where kind='daily' and ok=1 order by finished desc limit 1`).get();
  return !last || Date.now() - Date.parse(last.finished + 'Z') > DAILY_EVERY_HOURS * 3600e3;
}

// Days since the newest listing, 1–7: how far back the job boards are searched.
export function sinceDays(db) {
  const m = db.prepare(`select max(first_seen) m from jobs`).get()?.m;
  return m ? Math.min(7, Math.max(1, Math.ceil((Date.now() - Date.parse(m)) / 864e5))) : 7;
}

export function lastRun(db, kind) {
  return db.prepare(`select id, kind, started, finished, ok from runs where kind=? order by id desc limit 1`).get(kind) || null;
}

// Returns the run id, or null if one of this kind is already going. onExit(ok) fires when it ends.
export function start(db, kind, arg, onExit) {
  if (running(db, kind)) return null;
  const logDir = join(dirname(db.path), 'runs');   // a test's temp DB keeps its logs out of data/runs
  mkdirSync(logDir, { recursive: true });
  const id = Number(db.prepare(`insert into runs (kind, started, log) values (?, datetime('now'), ?)`).run(kind, arg || null).lastInsertRowid);
  const logPath = join(logDir, `${id}.log`);
  const out = openSync(logPath, 'a');
  // The download is a plain script, so the app runs it rather than Claude: no tool time limit can cut it
  // off, and its cache makes a rerun after a failure resume where it stopped.
  const days = kind === 'daily' ? sinceDays(db) : 0;
  const steps = kind === 'daily' ? [[PY(), ['scripts/harvest.py', '--days', String(days)]], [PY(), ['scripts/ingest.py']]] : [];
  steps.push([CLAUDE(), ['-p', PROMPTS[kind](arg, days), '--allowedTools', ...TOOLS, '--disallowedTools', ...DENY]]);
  let ended = false;   // 'error' and 'exit' can both fire
  const finish = (ok) => {
    if (ended) return; ended = true;
    const d = open(db.path);   // callback may outlive the request's handle
    d.prepare(`update runs set finished=datetime('now'), ok=?, log=? where id=?`).run(ok ? 1 : 0, logPath, id);
    onExit?.(ok, d);
  };
  const run = (i) => {
    const [cmd, args] = steps[i];
    writeSync(out, `\n$ ${[cmd, ...args].join(' ').slice(0, 100)}\n`);
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', out, out], env: { ...process.env } });
    child.on('error', () => finish(false));        // not installed / not on PATH
    child.on('exit', (code) => (code === 0 && i + 1 < steps.length ? run(i + 1) : finish(code === 0)));
  };
  run(0);
  return id;
}

// Prepares pursued jobs one at a time: people + resume + cover letter + drafts (prompts/prepare-job.md).
export function pump(db) {
  if (running(db, 'prepare')) return null;
  const cutoff = new Date(Date.now() - UNDO_GRACE_MS).toISOString();
  const job = db.prepare(`select key from jobs where status='pursued' and prep='queued' and decided_at <= ? order by decided_at, key limit 1`).get(cutoff);
  if (!job) return null;
  db.prepare(`update jobs set prep='running' where key=?`).run(job.key);
  return start(db, 'prepare', job.key, (ok, d) => {
    const people = d.prepare(`select count(*) n from people where job_key=? and chosen=1`).get(job.key).n;
    const j = d.prepare(`select materials, net from jobs where key=?`).get(job.key);
    const done = ok && people > 0 && (j.net || j.materials);   // firms with no posting get no resume/cover
    d.prepare(`update jobs set prep=? where key=? and prep='running'`).run(done ? 'ready' : 'failed', job.key);
    pump(d);
  });
}
