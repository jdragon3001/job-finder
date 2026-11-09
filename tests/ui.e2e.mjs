// End-to-end: drives the real dashboard in Chrome against a throwaway copy of the DB and a fake `claude`.
//   node tests/ui.e2e.mjs            (starts its own server on :3458, exits 1 on the first failed check)
// Screenshots land in data/e2e/ for a human look.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 3458, URL = `http://localhost:${PORT}/`, DB = '/tmp/copilot-e2e.db', SHOTS = 'data/e2e';
// A fresh DB with the real schema and 12 synthetic passing jobs (scores 90, 88, …), so the test needs no personal data.
rmSync(DB, { force: true });
execFileSync('python3', ['-c', `import sys,sqlite3;sys.path.insert(0,'scripts');import ingest;db=sqlite3.connect('${DB}');ingest.migrate(db);db.commit()`]);
const N = 12;
execFileSync('sqlite3', [DB, Array.from({ length: N }, (_, i) => `insert into jobs (key, source, url, title, company, location, description, verdict, score, salary, work_mode, why, evidence, flags)
  values ('co${i}|research analyst ${i}|chicago','linkedin','https://example.com/job/${i}','Research Analyst ${i}','Example Co ${i}','Chicago, IL','${'d'.repeat(210)}','pass',${90 - i * 2},'$70,000-$80,000','hybrid',
  'Research work at a firm that hires new grads.','{"experience":"\\"0-1 years\\""}','["pay at floor"]');`).join('\n')]);
// One networking-only firm so the toggle has something to show.
execFileSync('sqlite3', [DB, `insert into jobs (key, source, url, title, company, location, description, verdict, score, net, why, ghost)
  values ('acme|analyst no posting yet|chicago','firms','https://example.com/careers','Analyst · no posting yet','Acme Economics','Chicago, IL','${'d'.repeat(210)}','pass',85,1,'Hires analyst classes in Chicago.','unchecked')`]);
rmSync(SHOTS, { recursive: true, force: true }); mkdirSync(SHOTS, { recursive: true });

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  env: { ...process.env, JOBS_DB: DB, COPILOT_AUTORUN: '0', CLAUDE_BIN: resolve('tests/fixtures/fake-claude.mjs'), FAKE_WRITES: '1', FAKE_DOCX: '1' }, stdio: 'ignore',
});
const until = async (fn, ms = 10000) => { const t = Date.now(); for (;;) { try { if (await fn()) return; } catch {} if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 150)); } };
let browser, step = '';
const check = (name) => { step = name; process.stdout.write('· ' + name + '\n'); };
try {
  await until(() => fetch(URL + 'api/state').then(r => r.ok), 30000);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL);

  check('New shows every passing job, best first, with the ghost-check line and posting button');
  await page.getByText('New', { exact: true }).first().waitFor();
  const rows = page.locator('.job');
  assert.equal(await rows.count(), N);
  assert.equal((await rows.first().locator('.score').textContent()).trim(), '90');
  const firstTitle = (await rows.first().locator('b').textContent()).trim();
  assert.match(await page.locator('.pane').textContent(), new RegExp(firstTitle.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await page.getByText('Not checked against the company’s careers page').waitFor();
  assert.ok(await page.getByRole('link', { name: /Open posting/ }).isVisible());
  await page.screenshot({ path: `${SHOTS}/1-new.png` });

  check('Keyboard: J moves down, Y pursues the selected job, toast offers Undo');
  await page.keyboard.press('j');
  const second = (await rows.nth(1).locator('b').textContent()).trim();
  assert.ok((await page.locator('.job-sel b').textContent()).includes(second));
  await page.keyboard.press('y');
  await page.getByRole('status').getByText(/Pursuing/).waitFor();
  await until(async () => (await rows.count()) === N - 1);

  check('Undo puts it back');
  await page.getByRole('button', { name: 'Undo' }).click();
  await until(async () => (await rows.count()) === N);

  check('Pass with N removes a job; bulk select two and Pursue all');
  await page.keyboard.press('n');
  await until(async () => (await rows.count()) === N - 1);
  await page.locator('.job .ck').nth(0).click(); await page.locator('.job .ck').nth(1).click();
  await page.getByText('2 selected').waitFor();
  await page.getByRole('button', { name: 'Pursue all' }).click();
  await until(async () => (await rows.count()) === N - 3);

  check('Ready: pursued jobs get prepared by (fake) Claude, then show the 7-item checklist');
  await page.locator('.nav', { hasText: 'Ready' }).click();
  await until(async () => (await page.locator('.rj', { hasText: '/ 6' }).count()) === 2, 20000);   // alum has no email → 6 items
  await page.locator('.rj').first().click();
  await page.getByText('0 of 6 done').waitFor();
  assert.equal(await page.locator('.people .card').count(), 3);
  await page.screenshot({ path: `${SHOTS}/2-ready.png`, fullPage: true });

  check('Downloads serve a real .docx');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download' }).first().click()]);
  assert.match(dl.suggestedFilename(), /\.docx$/);

  check('See what changed shows the diff');
  await page.getByRole('button', { name: 'See what changed' }).click();
  await page.getByText('+ New bullet from the bank').waitFor();

  check('Note sent tick counts toward progress and survives a reload');
  await page.getByRole('button', { name: 'Note sent' }).first().click();
  await page.getByText('1 of 6 done').waitFor();
  await page.reload(); await page.locator('.nav', { hasText: 'Ready' }).click();
  await page.locator('.rj').first().click();
  await page.getByText('1 of 6 done').waitFor();

  check('Swap person brings in the alternate manager');
  const before = await page.locator('.people .card').first().locator('a.jt').textContent();
  await page.locator('.people .card').first().getByRole('button', { name: 'Swap person' }).click();
  await until(async () => (await page.locator('.people .card').first().locator('a.jt').textContent()) !== before);

  check('Person without an email says so; Gmail not connected → compose link with the draft');
  await page.getByText('No email found — the LinkedIn note is the way in.').waitFor();
  const href = await page.getByRole('link', { name: 'Open in Gmail' }).first().getAttribute('href');
  assert.match(href, /mail\.google\.com.*su=.*body=/);

  check('Network-only toggle shows the firm, without a resume/cover or Apply step');
  await page.locator('.nav', { hasText: 'New' }).click();
  await page.getByRole('tab', { name: /Network-only/ }).click();
  await page.getByText('Acme Economics').first().waitFor();
  await page.getByText('No open posting — reach out to people directly').waitFor();
  await page.keyboard.press('y');
  await page.locator('.nav', { hasText: 'Ready' }).click();
  await until(async () => (await page.locator('.rj', { hasText: '/ 5' }).count()) === 1, 20000);   // no Apply, alum has no email
  await page.locator('.rj').first().click();
  assert.equal(await page.getByText('Open application').count(), 0);
  assert.equal(await page.getByText('DOCX').count(), 0);

  check('Sent: groups shown, Waiting collapsed by default');
  execFileSync('sqlite3', [DB, `update people set email_state='replied', sent_at='2026-11-02' where name='Test Recruiter'`]);
  await page.getByRole('tab', { name: /Listings/ }).click();
  await page.locator('.nav', { hasText: 'Sent' }).click();
  await page.getByText('Reply in Gmail').first().waitFor();
  assert.equal(await page.getByRole('button', { name: /Waiting/ }).getAttribute('aria-expanded'), 'false');
  await page.screenshot({ path: `${SHOTS}/3-sent.png` });

  check('A job leaves Ready once every item is done');
  execFileSync('sqlite3', [DB, `update people set note_sent=1 where chosen=1; update people set email_state='sent', sent_at='2026-11-07' where chosen=1 and email is not null and email_state!='replied'; update jobs set applied='confirmed' where status='pursued'`]);
  await page.locator('.nav', { hasText: 'Ready' }).click();
  await page.getByText('Nothing to send yet').waitFor();

  check('No browser errors');
  assert.deepEqual(errors, []);
  process.stdout.write('ALL UI CHECKS PASSED\n');
} catch (e) {
  console.error(`FAILED at: ${step}\n${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close(); server.kill();
  rmSync('data/materials', { recursive: true, force: true });   // fake-claude output only
}
