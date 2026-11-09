// Shared by the API routes: one DB handle, background work kicked off when the dashboard loads.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { open } from './store.js';
import { start, pump, needsDaily, running, lastRun } from './runner.js';

let db;
export const getDb = () => (db ||= open());

export const gmailConfigured = () => existsSync('.env') && /^GMAIL_APP_PASSWORD=\S+/m.test(readFileSync('.env', 'utf8'));

export const py = (args) => new Promise((resolve) => {
  execFile('python3', args, { timeout: 120e3 }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: stdout.trim(), err: (stderr || err?.message || '').trim().split('\n').pop() }));
});

let lastSync = 0;
// Called on every dashboard load: catch-up daily run if > 24 h (laptops sleep, no cron), prepare queue,
// and a Gmail read at most every 5 minutes.
export function kick() {
  const d = getDb();
  if (process.env.COPILOT_AUTORUN !== '0' && needsDaily(d) && !running(d, 'daily')) start(d, 'daily');
  pump(d);
  if (gmailConfigured() && Date.now() - lastSync > 5 * 60e3) { lastSync = Date.now(); py(['scripts/gmail.py', 'sync']); }
}

// First name for signatures, from profile/profile.yaml ("name: Alex").
export const me = () => { try { return readFileSync('profile/profile.yaml', 'utf8').match(/^name:\s*(.+)$/m)?.[1].trim() || ''; } catch { return ''; } };

export function runInfo() {
  const d = getDb();
  return { daily: lastRun(d, 'daily'), dailyRunning: !!running(d, 'daily'), prepareRunning: !!running(d, 'prepare'), gmail: gmailConfigured() };
}
