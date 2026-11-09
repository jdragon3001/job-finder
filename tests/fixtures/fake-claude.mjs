#!/usr/bin/env node
// Stand-in for `claude` in tests: records its arguments; with FAKE_WRITES, "prepares" the job named in the
// prompt (3 chosen people + 1 alternate, a real .docx resume/cover, a diff) the way prepare-job.md would.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const prompt = process.argv[process.argv.indexOf('-p') + 1] || '';
process.stdout.write('ARGS ' + JSON.stringify(process.argv.slice(2).filter(a => a !== prompt)) + '\n');
const key = (prompt.match(/Job key: (.+)/) || [])[1];
if (key && process.env.FAKE_WRITES) {
  const db = new DatabaseSync(process.env.JOBS_DB);
  const add = (kind, name, chosen, email) => db.prepare(`insert into people (job_key, kind, name, title, linkedin, email, note, email_subject, email_body, chosen)
    values (?,?,?,?,?,?,?,?,?,?)`).run(key, kind, name, kind === 'alum' ? 'Analyst · IU ’23' : 'Test ' + kind, 'https://www.linkedin.com/in/test-' + name.replace(/\W/g, ''), email,
    `Hi ${name.split(' ')[0]}! I recently applied to the role in Chicago. I'm an economics and quantitative methods grad from Indiana University — I'd love to connect!`,
    'Indiana University economics graduate — test', `Hi ${name.split(' ')[0]},\n\nI just sent you a connection request on LinkedIn. This is a test draft.\n\nThank you,\nMary`, chosen);
  add('manager', 'Test Manager', 1, 'manager@example.com'); add('recruiter', 'Test Recruiter', 1, 'recruiter@example.com');
  add('alum', 'Test Alum', 1, null); add('manager', 'Other Manager', 0, 'other@example.com');
  const slug = key.replace(/[^a-z0-9]+/gi, '-');
  if (process.env.FAKE_DOCX) mkdirSync(`data/materials/${slug}`, { recursive: true });
  for (const w of process.env.FAKE_DOCX ? ['Resume', 'Cover'] : [])
    execFileSync('python3', ['-c', `import sys;sys.path.insert(0,'scripts');import tailor;tailor.make_docx('data/materials/${slug}/Mary_${w}_Test.docx',[('Test ${w}',None)])`]);
  db.prepare(`update jobs set materials=? where key=?`).run(JSON.stringify({ resume: `data/materials/${slug}/Mary_Resume_Test.docx`, cover: `data/materials/${slug}/Mary_Cover_Test.docx`, diff: ['- Old bullet', '+ New bullet from the bank'] }), key);
}
setTimeout(() => process.exit(Number(process.env.FAKE_EXIT || 0)), Number(process.env.FAKE_MS || 50));
