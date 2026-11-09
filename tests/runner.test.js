import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

process.env.CLAUDE_BIN = resolve('tests/fixtures/fake-claude.mjs');
process.env.COPILOT_PY = resolve('tests/fixtures/fake-python.mjs');   // never the real job download
const { open } = await import('../lib/store.js');
const { start, running, needsDaily, pump } = await import('../lib/runner.js');

function freshDb() {
  const path = join(mkdtempSync(join(tmpdir(), 'copilot-run-')), 'jobs.db');
  execFileSync('python3', ['-c', `import sys,sqlite3;sys.path.insert(0,'scripts');import ingest;db=sqlite3.connect('${path}');ingest.migrate(db);db.commit()`]);
  process.env.JOBS_DB = path;
  return open(path);
}
const until = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 25)); } };
const addJob = (db, key, net = 0) => db.prepare(`insert into jobs (key, source, url, title, company, location, description, verdict, status, prep, net, decided_at)
  values (?, 't', 'u'||?, 'T', 'C', 'Chicago', 'd', 'pass', 'pursued', 'queued', ?, ?)`).run(key, key, net, new Date(Date.now() - 60e3).toISOString());

test('A daily run starts claude -p with the tool allowlist, logs output, and records success', async () => {
  const db = freshDb();
  assert.equal(needsDaily(db), true);
  const id = start(db, 'daily');
  await until(() => db.prepare('select finished from runs where id=?').get(id).finished);
  const row = db.prepare('select ok, log from runs where id=?').get(id);
  assert.equal(row.ok, 1);
  const args = JSON.parse(readFileSync(row.log, 'utf8').match(/ARGS (.*)/)[1]);
  assert.ok(args.includes('--allowedTools') && args.includes('Bash(python3 scripts/*)'));
  assert.ok(!args.some(a => /git|rm |curl/.test(a)), 'no git/rm/curl permissions');
  assert.equal(needsDaily(db), false);
});

test('A daily run downloads and imports listings itself before Claude starts, so no tool time limit can cut it off', async () => {
  const db = freshDb();
  const id = start(db, 'daily');
  await until(() => db.prepare('select finished from runs where id=?').get(id).finished);
  const log = readFileSync(db.prepare('select log from runs where id=?').get(id).log, 'utf8');
  const order = ['PY scripts/harvest.py --days 7', 'PY scripts/ingest.py', 'ARGS'].map(s => log.indexOf(s));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), log);
  const args = JSON.parse(log.match(/ARGS (.*)/)[1]);
  assert.ok(args.includes('--disallowedTools') && args.includes('Edit(scripts/**)') && args.includes('Bash(pkill *)'));
});

test('A failed download fails the run without starting Claude, so the next app open retries it', async () => {
  const db = freshDb();
  process.env.FAKE_PY_EXIT = '1';
  const id = start(db, 'daily');
  await until(() => db.prepare('select finished from runs where id=?').get(id).finished);
  delete process.env.FAKE_PY_EXIT;
  const row = db.prepare('select ok, log from runs where id=?').get(id);
  assert.equal(row.ok, 0);
  assert.ok(!readFileSync(row.log, 'utf8').includes('ARGS'));
  assert.equal(needsDaily(db), true);
});

test('A second run of the same kind is refused while one is going', async () => {
  const db = freshDb();
  process.env.FAKE_MS = '400';
  const id = start(db, 'daily');
  assert.equal(start(db, 'daily'), null);
  assert.ok(running(db, 'daily'));
  await until(() => db.prepare('select finished from runs where id=?').get(id).finished);
  delete process.env.FAKE_MS;
});

test('A failing claude run is recorded as failed and does not count as today\'s run', async () => {
  const db = freshDb();
  process.env.FAKE_EXIT = '1';
  const id = start(db, 'daily');
  await until(() => db.prepare('select finished from runs where id=?').get(id).finished);
  delete process.env.FAKE_EXIT;
  assert.equal(db.prepare('select ok from runs where id=?').get(id).ok, 0);
  assert.equal(needsDaily(db), true);
});

test('Missing claude binary fails the run instead of crashing the app', async () => {
  const db = freshDb();
  process.env.CLAUDE_BIN = '/nonexistent/claude';
  const id = start(db, 'daily');
  await until(() => db.prepare('select finished from runs where id=?').get(id).finished);
  process.env.CLAUDE_BIN = resolve('tests/fixtures/fake-claude.mjs');
  assert.equal(db.prepare('select ok from runs where id=?').get(id).ok, 0);
});

test('Pursued jobs are prepared one at a time; a job with people + materials becomes ready, one without fails', async () => {
  const db = freshDb();
  addJob(db, 'a'); addJob(db, 'b');
  process.env.FAKE_WRITES = '1';
  pump(db);
  const prep = (k) => db.prepare('select prep from jobs where key=?').get(k).prep;
  assert.equal(prep('a'), 'running');
  assert.equal(prep('b'), 'queued');             // waits its turn
  await until(() => prep('b') === 'ready');      // a finished, pump chained to b
  assert.equal(prep('a'), 'ready');
  delete process.env.FAKE_WRITES;
  addJob(db, 'c');
  pump(db);
  await until(() => prep('c') !== 'running');
  assert.equal(prep('c'), 'failed');             // claude exited 0 but produced nobody
});

test('A just-pursued job waits out the undo window before Claude starts on it', () => {
  const db = freshDb();
  db.prepare(`insert into jobs (key, source, url, title, company, location, description, verdict, status, prep, decided_at)
    values ('fresh','t','u','T','C','Chicago','d','pass','pursued','queued',?)`).run(new Date().toISOString());
  assert.equal(pump(db), null);
  assert.equal(db.prepare("select prep from jobs where key='fresh'").get().prep, 'queued');
});
