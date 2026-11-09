// All reads/writes the dashboard makes. Pure functions over a node:sqlite handle so tests use a temp DB.
// The schema is owned by scripts/ingest.py (migrate); this file never creates tables.
import { DatabaseSync } from 'node:sqlite';

export const open = (path = process.env.JOBS_DB || 'data/jobs.db') => {
  const db = new DatabaseSync(path);
  db.exec('pragma busy_timeout = 5000');   // ingest.py and Claude runs write the same file
  db.path = path;                          // runner reopens it in exit callbacks
  return db;
};

const FOLLOW_UP_AFTER = 5;   // business days with no reply
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function businessDaysSince(isoDate, now = new Date()) {
  const d = new Date(isoDate.slice(0, 10) + 'T00:00:00');
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let n = 0;
  while (d < end) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) n++; }
  return n;
}

function people(db, key) {
  return db.prepare(`select * from people where job_key=? and chosen=1
    order by case kind when 'manager' then 0 when 'recruiter' then 1 else 2 end, id`).all(key);
}

function progress(job, ppl) {
  const items = (job.net ? [] : [job.applied === 'confirmed'])
    .concat(ppl.map(p => !!p.note_sent),
      ppl.filter(p => p.email).map(p => p.email_state === 'sent' || p.email_state === 'replied'));   // no address → no email task
  return { done: items.filter(Boolean).length, total: items.length };
}

const card = (j) => ({
  key: j.key, title: j.title, company: j.company, location: j.location, url: j.url, source: j.source,
  salary: j.salary, score: j.score, category: j.category, work_mode: j.work_mode, why: j.why,
  flags: json(j.flags, []) || [], evidence: json(j.evidence, {}) || {}, ghost: j.ghost, net: !!j.net,
});

export function state(db, mode = 'list', now = new Date()) {
  const net = mode === 'net' ? 1 : 0;
  const newJobs = db.prepare(`select * from jobs where verdict='pass' and status='new' and net=? order by score desc, key`)
    .all(net).map(card);

  const ready = [];
  for (const j of db.prepare(`select * from jobs where status='pursued' and net=? order by decided_at desc, key`).all(net)) {
    const ppl = people(db, j.key);
    const p = progress(j, ppl);
    if (j.prep === 'ready' && ppl.length && p.done === p.total) {     // finished: leaves Ready for good
      db.prepare(`update jobs set status='done' where key=?`).run(j.key);
      continue;
    }
    ready.push({ ...card(j), prep: j.prep, applied: j.applied, materials: json(j.materials, null), people: ppl, progress: p });
  }

  const sentRows = db.prepare(`select p.*, j.company, j.title as job_title, j.net from people p join jobs j on j.key=p.job_key
    where p.email_state in ('sent','replied') and j.net=? order by p.sent_at desc, p.id`).all(net);
  const sent = { replies: [], followUp: [], waiting: [] };
  for (const p of sentRows) {
    if (p.email_state === 'replied') sent.replies.push(p);
    else if (businessDaysSince(p.sent_at || '', now) >= FOLLOW_UP_AFTER) sent.followUp.push(p);
    else sent.waiting.push(p);
  }

  const count = (sql) => Object.fromEntries([0, 1].map(n => [n ? 'net' : 'list', db.prepare(sql).get(n).n]));
  return {
    mode, newJobs, ready, sent,
    counts: {
      new: count(`select count(*) n from jobs where verdict='pass' and status='new' and net=?`),
      ready: count(`select count(*) n from jobs where status='pursued' and net=?`),
      sent: count(`select count(*) n from people p join jobs j on j.key=p.job_key where p.email_state in ('sent','replied') and j.net=?`),
    },
  };
}

export function decide(db, keys, verdict) {
  if (verdict !== 'pursue' && verdict !== 'pass') throw new Error('verdict must be pursue or pass');
  const st = db.prepare(`update jobs set status=?, prep=?, decided_at=? where key=? and status='new'`);
  const at = new Date().toISOString();
  let n = 0;
  for (const k of keys) n += Number(st.run(verdict === 'pursue' ? 'pursued' : 'passed', verdict === 'pursue' ? 'queued' : null, at, k).changes);
  return n;
}

// Undo only what has not started: a pursued job whose people/materials are already being made stays.
export function undo(db, keys) {
  const st = db.prepare(`update jobs set status='new', prep=null, decided_at=null
    where key=? and (status='passed' or (status='pursued' and coalesce(prep,'queued')='queued'))`);
  return keys.reduce((n, k) => n + Number(st.run(k).changes), 0);
}

export function setNote(db, personId, sent) {
  return Number(db.prepare(`update people set note_sent=? where id=?`).run(sent ? 1 : 0, personId).changes);
}

export function swap(db, personId) {
  const p = db.prepare(`select * from people where id=?`).get(personId);
  if (!p) throw new Error('no such person');
  const alts = db.prepare(`select * from people where job_key=? and kind=? and chosen=0 order by id`).all(p.job_key, p.kind);
  if (!alts.length) throw new Error(`no other ${p.kind} found for this job`);
  const next = alts.find(a => a.id > p.id) || alts[0];
  db.prepare(`update people set chosen=0 where id=?`).run(p.id);
  db.prepare(`update people set chosen=1 where id=?`).run(next.id);
  return next;
}

export function applyOpened(db, key) {
  return Number(db.prepare(`update jobs set applied='opened' where key=? and applied is null`).run(key).changes);
}
