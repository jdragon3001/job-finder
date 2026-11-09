import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, state, decide, undo, setNote, swap, applyOpened, businessDaysSince } from '../lib/store.js';

// A fresh DB with the real schema (ingest.py owns it) and synthetic jobs/people.
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), 'copilot-')), 'jobs.db');
  execFileSync('python3', ['-c', `import sys,sqlite3;sys.path.insert(0,'scripts');import ingest;db=sqlite3.connect('${path}');ingest.migrate(db);db.commit()`]);
  const db = open(path);
  const job = (key, extra = {}) => db.prepare(`insert into jobs (key, source, url, title, company, location, description, verdict, score, net, status)
    values (?,?,?,?,?,?,?,?,?,?,?)`).run(key, 'test', 'https://x/' + key, 'Analyst ' + key, 'Co ' + key, 'Chicago, IL', 'd'.repeat(300),
    extra.verdict ?? 'pass', extra.score ?? 80, extra.net ?? 0, extra.status ?? 'new');
  const person = (job_key, kind, name, chosen = 1) => db.prepare(`insert into people (job_key, kind, name, linkedin, email, chosen) values (?,?,?,?,?,?)`)
    .run(job_key, kind, name, 'https://linkedin.com/in/' + name, name + '@example.com', chosen).lastInsertRowid;
  return { db, job, person };
}

test('New lists only passing, undecided jobs of the chosen mode, best first', () => {
  const { db, job } = fixture();
  job('a', { score: 70 }); job('b', { score: 90 }); job('c', { verdict: 'reject' }); job('n', { net: 1 });
  assert.deepEqual(state(db, 'list').newJobs.map(j => j.key), ['b', 'a']);
  assert.deepEqual(state(db, 'net').newJobs.map(j => j.key), ['n']);
});

test('Pursue moves a job to Ready and queues preparation; pass hides it; undo restores both', () => {
  const { db, job } = fixture();
  job('a'); job('b');
  decide(db, ['a'], 'pursue'); decide(db, ['b'], 'pass');
  let s = state(db, 'list');
  assert.deepEqual(s.newJobs, []);
  assert.deepEqual(s.ready.map(j => [j.key, j.prep]), [['a', 'queued']]);
  undo(db, ['a', 'b']);
  s = state(db, 'list');
  assert.deepEqual(s.newJobs.map(j => j.key).sort(), ['a', 'b']);
  assert.equal(s.ready.length, 0);
});

test('decide rejects unknown verdicts and jobs that are not new', () => {
  const { db, job } = fixture();
  job('a', { status: 'pursued' });
  assert.throws(() => decide(db, ['a'], 'maybe'), /verdict/);
  assert.equal(decide(db, ['a'], 'pass'), 0);           // already decided: no change
});

test('A job leaves Ready only when applied + every chosen person has note and email sent', () => {
  const { db, job, person } = fixture();
  job('a', { status: 'pursued' });
  const ids = ['manager', 'recruiter', 'alum'].map((k, i) => person('a', k, 'p' + i));
  db.prepare("update jobs set prep='ready' where key='a'").run();
  const progress = () => state(db, 'list').ready.find(j => j.key === 'a')?.progress;
  assert.deepEqual(progress(), { done: 0, total: 7 });
  ids.forEach(id => setNote(db, id, true));
  db.prepare("update people set email_state='sent', sent_at='2026-11-01' where job_key='a'").run();
  assert.deepEqual(progress(), { done: 6, total: 7 });
  db.prepare("update jobs set applied='confirmed' where key='a'").run();
  const s = state(db, 'list');
  assert.equal(s.ready.length, 0);
  assert.equal(db.prepare("select status from jobs where key='a'").get().status, 'done');
});

test('Network-only jobs have no Apply step (6 items)', () => {
  const { db, job, person } = fixture();
  job('n', { net: 1, status: 'pursued' });
  ['manager', 'recruiter', 'alum'].forEach((k, i) => person('n', k, 'q' + i));
  db.prepare("update jobs set prep='ready' where key='n'").run();
  assert.deepEqual(state(db, 'net').ready[0].progress, { done: 0, total: 6 });
});

test('Swap replaces a person with the next alternate of the same kind and wraps around', () => {
  const { db, job, person } = fixture();
  job('a', { status: 'pursued' });
  const m1 = person('a', 'manager', 'm1');
  const m2 = person('a', 'manager', 'm2', 0);
  person('a', 'recruiter', 'r1', 0);
  const chosen = () => db.prepare("select name from people where job_key='a' and kind='manager' and chosen=1").all().map(r => r.name);
  assert.equal(swap(db, m1).name, 'm2');
  assert.deepEqual(chosen(), ['m2']);
  swap(db, m2);
  assert.deepEqual(chosen(), ['m1']);
});

test('Swap refuses when there is no alternate of that kind', () => {
  const { db, job, person } = fixture();
  job('a', { status: 'pursued' });
  const r = person('a', 'recruiter', 'r1');
  assert.throws(() => swap(db, r), /no other/);
});

test('Apply click marks opened but never confirmed (only Gmail confirms)', () => {
  const { db, job } = fixture();
  job('a', { status: 'pursued' });
  applyOpened(db, 'a');
  assert.equal(db.prepare("select applied from jobs where key='a'").get().applied, 'opened');
  db.prepare("update jobs set applied='confirmed' where key='a'").run();
  applyOpened(db, 'a');
  assert.equal(db.prepare("select applied from jobs where key='a'").get().applied, 'confirmed');
});

test('Sent groups: replies first, follow-up due after 5 business days, else waiting', () => {
  const { db, job, person } = fixture();
  job('a', { status: 'pursued' });
  const r = person('a', 'manager', 'rep'), f = person('a', 'recruiter', 'old'), w = person('a', 'alum', 'new');
  db.prepare("update people set email_state='replied', sent_at='2026-11-02' where id=?").run(r);
  db.prepare("update people set email_state='sent', sent_at='2026-10-30' where id=?").run(f);   // Fri → 6 business days to Mon Nov 9
  db.prepare("update people set email_state='sent', sent_at='2026-11-06' where id=?").run(w);
  const s = state(db, 'list', new Date('2026-11-09T12:00:00'));
  assert.deepEqual(s.sent.replies.map(p => p.name), ['rep']);
  assert.deepEqual(s.sent.followUp.map(p => p.name), ['old']);
  assert.deepEqual(s.sent.waiting.map(p => p.name), ['new']);
});

test('businessDaysSince skips weekends', () => {
  assert.equal(businessDaysSince('2026-11-06', new Date('2026-11-09T09:00:00')), 1);   // Fri → Mon
  assert.equal(businessDaysSince('2026-11-02', new Date('2026-11-09T09:00:00')), 5);   // Mon → Mon
});

test('A person with no email address adds a note task but no email task, so the job can still finish', () => {
  const { db, job, person } = fixture();
  job('a', { status: 'pursued' });
  person('a', 'manager', 'm');
  const n = person('a', 'alum', 'noaddress');
  db.prepare("update people set email=null where id=?").run(n);
  db.prepare("update jobs set prep='ready' where key='a'").run();
  assert.deepEqual(state(db, 'list').ready[0].progress, { done: 0, total: 4 });   // apply + 2 notes + 1 email
});
