// The Profile page's chat: Claude interviews her (prompts/interview.md) and proposes search settings in a
// ```settings block, which the app — not Claude — merges into profile/profile.json through normalize().
// The conversation is one resumable `claude -p` session; its transcript is kept in profile/interview.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readProfile, saveProfile } from '../../../lib/server.js';
import { normalize, DEFAULTS, FIELDS } from '../../../lib/profile.js';

export const dynamic = 'force-dynamic';

const FILE = 'profile/interview.json';
const CLAUDE = () => process.env.CLAUDE_BIN || 'claude';
const load = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return { messages: [] }; } };
const store = (s) => { mkdirSync('profile', { recursive: true }); writeFileSync(FILE, JSON.stringify(s, null, 2)); };
const bad = (msg, status = 400) => Response.json({ error: msg }, { status });
let busy = false;

// Read-only tools plus the web: it can look at her files and research roles, never edit anything.
function ask(text, session, first) {
  const args = ['-p', '--output-format', 'json', first ? '--session-id' : '--resume', session,
    '--allowedTools', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit'];
  return new Promise((resolve, reject) => {
    const child = execFile(CLAUDE(), args, { timeout: 5 * 60e3, maxBuffer: 20e6 }, (err, out) => {
      let j; try { j = JSON.parse(out); } catch { /* not JSON: failed before answering */ }
      if (j && !j.is_error && typeof j.result === 'string') return resolve(j.result);
      const why = (j?.result || out || err?.message || '').slice(0, 300);
      reject(new Error(err?.code === 'ENOENT' ? 'Claude Code isn’t installed — run the installer again.'
        : /log ?in|auth|credential/i.test(why) ? 'Claude isn’t signed in — sign in under Connections.' : 'Claude didn’t answer. ' + why));
    });
    child.stdin.end(text);   // stdin, so a message starting with "-" can't be read as a flag
  });
}

// Pull out every ```settings block, save the merged settings, and return the reply without them.
function applySettings(reply) {
  const changed = new Set();
  const text = reply.replace(/```settings\s*([\s\S]*?)```/g, (_, body) => {
    try {
      const patch = JSON.parse(body);
      saveProfile(normalize(patch, readProfile() || DEFAULTS));
      Object.keys(patch).filter(k => Object.hasOwn(FIELDS, k)).forEach(k => changed.add(FIELDS[k][1]));
    } catch { /* a malformed block is dropped rather than half-applied */ }
    return '';
  }).trim();
  return { text, changed: [...changed] };
}

export function GET() {
  return Response.json({ messages: load().messages, busy });
}

export async function POST(req) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) return bad('content-type must be application/json');
  let b;
  try { b = await req.json(); } catch { return bad('body must be JSON'); }
  if (b.reset) { if (busy) return bad('Claude is still answering', 409); store({ messages: [] }); return Response.json({ messages: [] }); }
  const msg = typeof b.message === 'string' ? b.message.trim() : '';
  if (!b.start && (!msg || msg.length > 4000)) return bad('message must be 1–4000 characters');
  if (busy) return bad('Claude is still answering', 409);
  busy = true;
  const st = load(), first = !st.session, session = st.session || randomUUID();
  const said = b.start ? 'Start the conversation.' : 'They say: ' + msg;
  const text = first ? readFileSync('prompts/interview.md', 'utf8') + `\n\nToday is ${new Date().toDateString()}.\n\n---\n\n${said}` : msg;
  try {
    const reply = applySettings(await ask(text, session, first));
    const messages = [...st.messages, ...(b.start ? [] : [{ role: 'you', text: msg }]), { role: 'claude', ...reply }];
    store({ session, messages });
    return Response.json({ messages });
  } catch (e) {
    return bad(e.message, 502);
  } finally { busy = false; }
}
