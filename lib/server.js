// Shared by the API routes: one DB handle, background work kicked off when the dashboard loads.
import { execFile, execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { normalize, searchReady } from './profile.js';
import { open } from './store.js';
import { start, pump, needsDaily, running, lastRun } from './runner.js';

let db;
// A new install has no data/ yet; the schema belongs to scripts/ingest.py, so it creates the tables.
export const getDb = () => db ||= (() => {
  const path = process.env.JOBS_DB || 'data/jobs.db';
  mkdirSync(dirname(path), { recursive: true });
  const d = open(path);
  if (!d.prepare(`select 1 from sqlite_master where name='runs'`).get())
    execFileSync('python3', ['-c', 'import sys, sqlite3; sys.path.insert(0, "scripts"); import ingest; c = sqlite3.connect(sys.argv[1]); ingest.migrate(c); c.commit()', path]);
  return d;
})();

const envText = () => existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const envSet = (k) => new RegExp(`^${k}=\\S+`, 'm').test(envText());
export const gmailConfigured = () => envSet('GMAIL_APP_PASSWORD');

// The only keys the dashboard may write. Also sets process.env: Next loaded .env at boot, and child runs
// inherit process.env, which the scripts' setdefault() won't override — so without this a new key needs a restart.
const ENV_KEYS = ['GMAIL_ADDRESS', 'GMAIL_APP_PASSWORD', 'TREG_API_KEY'];
export function saveEnv(values) {
  let text = envText() || (existsSync('.env.example') ? readFileSync('.env.example', 'utf8') : '');
  const bad = Object.entries(values).find(([k, v]) => !ENV_KEYS.includes(k) || typeof v !== 'string' || /[\r\n#"]/.test(v));
  if (bad) throw new Error('Invalid value for ' + bad[0]);
  for (let [k, v] of Object.entries(values)) {
    v = k === 'GMAIL_APP_PASSWORD' ? v.replace(/\s+/g, '') : v.trim();   // Google shows app passwords in groups of 4
    const line = `${k}=${v}`, re = new RegExp(`^#?\\s*${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : text.trimEnd() + '\n' + line + '\n';
    process.env[k] = v;
  }
  writeFileSync('.env', text, { mode: 0o600 });
}

// What she's looking for (lib/profile.js). null until she has one.
export const readProfile = () => { try { return normalize(JSON.parse(readFileSync('profile/profile.json', 'utf8'))); } catch { return null; } };
export function saveProfile(p) {
  mkdirSync('profile', { recursive: true });
  writeFileSync('profile/profile.json', JSON.stringify(normalize(p), null, 2) + '\n');
}
export const canSearch = () => searchReady(readProfile());

// What the Guide checks. Paths are relative to the app folder (shown to the user as `root`).
export const setup = () => ({
  root: process.cwd(),
  profile: canSearch(), facts: existsSync('profile/facts.md'),
  resume: existsSync('profile/resume.docx'), cover: existsSync('profile/cover.docx'),
  gmail: gmailConfigured(), treg: envSet('TREG_API_KEY'),
});

export const py = (args) => new Promise((resolve) => {
  execFile('python3', args, { timeout: 120e3 }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: stdout.trim(), err: (stderr || err?.message || '').trim().split('\n').pop() }));
});

let lastSync = 0;
// Called on every dashboard load: catch-up daily run if > 24 h (laptops sleep, no cron), prepare queue,
// and a Gmail read at most every 5 minutes.
export function kick() {
  const d = getDb();
  if (process.env.COPILOT_AUTORUN !== '0' && canSearch() && needsDaily(d) && !running(d, 'daily')) start(d, 'daily');
  pump(d);
  if (gmailConfigured() && Date.now() - lastSync > 5 * 60e3) { lastSync = Date.now(); py(['scripts/gmail.py', 'sync']); }
}

export const me = () => readProfile()?.name || '';

export function runInfo() {
  const d = getDb();
  return { daily: lastRun(d, 'daily'), dailyRunning: !!running(d, 'daily'), prepareRunning: !!running(d, 'prepare'), gmail: gmailConfigured(), setup: setup() };
}
