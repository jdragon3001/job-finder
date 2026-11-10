// The Profile page: Claude login, her Word files, writing samples, and the two text files every run reads.
// Everything stays inside profile/ — every path from the browser goes through inProfile().
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, sep, basename, extname } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { getDb, readProfile, saveProfile } from '../../../lib/server.js';
import { normalize, DEFAULTS, searchReady } from '../../../lib/profile.js';
import { start, running, lastRun } from '../../../lib/runner.js';

export const dynamic = 'force-dynamic';

const CATS = ['resumes', 'cover-letters', 'writing', 'context'];
const UPLOAD_EXT = ['.pdf', '.docx', '.txt', '.md'];
const TEXTS = { facts: 'profile/facts.md' };
const DOCS = { resume: 'profile/resume.docx', cover: 'profile/cover.docx' };
const MAX_BYTES = 20e6;
const pick = (o, k) => (typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : null);
const CLAUDE = () => process.env.CLAUDE_BIN || 'claude';

const inProfile = (rel) => { const p = resolve('profile', rel); return p.startsWith(resolve('profile') + sep) ? p : null; };
const read = (p) => existsSync(p) ? readFileSync(p, 'utf8') : null;
const info = (p) => existsSync(p) ? { size: statSync(p).size, at: statSync(p).mtime.toISOString() } : null;
const list = (cat) => { const d = `profile/uploads/${cat}`; return existsSync(d) ? readdirSync(d).filter(n => !n.startsWith('.')).map(name => ({ name, size: statSync(`${d}/${name}`).size })) : []; };
const bad = (msg, status = 400) => Response.json({ error: msg }, { status });

let login = null;   // the `claude auth login` child while the browser sign-in is open
const claudeStatus = () => new Promise(res => execFile(CLAUDE(), ['auth', 'status'], { timeout: 15e3 }, (err, out) => {
  try { const j = JSON.parse(out); res({ installed: true, loggedIn: !!j.loggedIn, email: j.email || '', plan: j.subscriptionType || '', loggingIn: !!login }); }
  catch { res({ installed: err?.code !== 'ENOENT', loggedIn: false, loggingIn: !!login }); }
}));

export async function GET(req) {
  const file = new URL(req.url).searchParams.get('file');
  if (file) {
    const p = pick(DOCS, file) ? resolve(DOCS[file]) : CATS.includes(file.split('/')[0]) && inProfile('uploads/' + file);
    if (!p || !existsSync(p)) return new Response('not found', { status: 404 });
    const pdf = extname(p).toLowerCase() === '.pdf';
    return new Response(readFileSync(p), { headers: {
      'content-type': pdf ? 'application/pdf' : 'application/octet-stream',
      'content-disposition': `${pdf ? 'inline' : 'attachment'}; filename="${basename(p).replace(/["\\]/g, '')}"`,
    } });
  }
  const db = getDb();
  return Response.json({
    claude: await claudeStatus(),
    prefs: (p => ({ value: p || DEFAULTS, ready: searchReady(p) }))(readProfile()),
    facts: { text: read(TEXTS.facts) ?? '' },
    docs: Object.fromEntries(Object.entries(DOCS).map(([k, p]) => [k, info(p)])),
    uploads: Object.fromEntries(CATS.map(c => [c, list(c)])),
    build: { running: !!running(db, 'profile'), last: lastRun(db, 'profile') },
  });
}

export async function POST(req) {
  // Uploads are multipart, which other sites can post without a preflight — so check where it came from.
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return bad('cross-site request refused', 403);
  const type = req.headers.get('content-type') || '';

  if (type.startsWith('multipart/form-data')) {
    const form = await req.formData(), to = form.get('to'), files = form.getAll('file').filter(f => typeof f === 'object');
    if (!files.length) return bad('no file');
    if (files.some(f => f.size > MAX_BYTES)) return bad('Files must be under 20 MB');
    if (pick(DOCS, to)) {
      if (files.length !== 1 || extname(files[0].name).toLowerCase() !== '.docx') return bad('Upload a Word file (.docx). From Google Docs: File → Download → Microsoft Word.');
      mkdirSync('profile', { recursive: true });
      writeFileSync(DOCS[to], Buffer.from(await files[0].arrayBuffer()));
      return Response.json({ saved: 1 });
    }
    if (!CATS.includes(to)) return bad('unknown upload folder');
    const wrong = files.find(f => !UPLOAD_EXT.includes(extname(f.name).toLowerCase()));
    if (wrong) return bad(`${wrong.name}: only PDF, Word, .txt or .md files`);
    mkdirSync(`profile/uploads/${to}`, { recursive: true });
    for (const f of files) writeFileSync(`profile/uploads/${to}/${basename(f.name).replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '')}`, Buffer.from(await f.arrayBuffer()));
    return Response.json({ saved: files.length });
  }

  if (!type.startsWith('application/json')) return bad('content-type must be application/json');
  let b;
  try { b = await req.json(); } catch { return bad('body must be JSON'); }
  switch (b.action) {
    case 'save': {
      if (!pick(TEXTS, b.which) || typeof b.text !== 'string' || b.text.length > 200e3) return bad('which must be facts, text under 200 KB');
      mkdirSync('profile', { recursive: true });
      writeFileSync(TEXTS[b.which], b.text.endsWith('\n') ? b.text : b.text + '\n');
      return Response.json({ ok: true });
    }
    case 'prefs': {
      if (!b.value || typeof b.value !== 'object') return bad('value must be an object');
      saveProfile(normalize(b.value, readProfile() || DEFAULTS));
      return Response.json({ ok: true });
    }
    case 'delete': {
      const [cat, name, ...rest] = String(b.path || '').split('/');
      const p = CATS.includes(cat) && name && !rest.length && name === basename(name) && inProfile(`uploads/${cat}/${name}`);
      if (!p || !existsSync(p)) return bad('not found', 404);
      unlinkSync(p); return Response.json({ ok: true });
    }
    case 'build': {
      const id = start(getDb(), 'profile');
      return id ? Response.json({ started: id }) : bad('Already building', 409);
    }
    case 'login': {
      if (!login) {
        login = spawn(CLAUDE(), ['auth', 'login'], { stdio: 'ignore' });   // opens the Claude sign-in page in the browser
        const kill = setTimeout(() => login?.kill(), 10 * 60e3);
        const done = () => { clearTimeout(kill); login = null; };
        login.on('exit', done); login.on('error', done);
      }
      return Response.json({ ok: true });
    }
    default: return bad('unknown action');
  }
}
