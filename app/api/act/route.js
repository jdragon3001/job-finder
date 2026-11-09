import { decide, undo, setNote, swap, applyOpened } from '../../../lib/store.js';
import { start, pump, UNDO_GRACE_MS } from '../../../lib/runner.js';
import { getDb, py, gmailConfigured } from '../../../lib/server.js';

export const dynamic = 'force-dynamic';

const keys = (b) => Array.isArray(b.keys) && b.keys.every(k => typeof k === 'string') ? b.keys : null;
const id = (b) => Number.isInteger(b.personId) ? b.personId : null;
const bad = (msg) => Response.json({ error: msg }, { status: 400 });

export async function POST(req) {
  let b;
  try { b = await req.json(); } catch { return bad('body must be JSON'); }
  const db = getDb();
  try {
    switch (b.action) {
      case 'pursue': case 'pass': {
        if (!keys(b)) return bad('keys must be a list of job keys');
        const n = decide(db, b.keys, b.action);
        if (b.action === 'pursue') setTimeout(() => pump(db), UNDO_GRACE_MS + 500);   // after the undo window
        return Response.json({ changed: n });
      }
      case 'undo': return keys(b) ? Response.json({ changed: undo(db, b.keys) }) : bad('keys must be a list of job keys');
      case 'note': return id(b) ? Response.json({ changed: setNote(db, b.personId, !!b.sent) }) : bad('personId must be an integer');
      case 'swap': return id(b) ? Response.json({ person: swap(db, b.personId) }) : bad('personId must be an integer');
      case 'applyOpened': return typeof b.key === 'string' ? Response.json({ changed: applyOpened(db, b.key) }) : bad('key must be a string');
      case 'retry': {
        if (typeof b.key !== 'string') return bad('key must be a string');
        db.prepare(`update jobs set prep='queued' where key=? and prep='failed'`).run(b.key);
        pump(db); return Response.json({ ok: true });
      }
      case 'run': return Response.json({ started: start(db, 'daily') });
      case 'draft': {
        if (!id(b)) return bad('personId must be an integer');
        if (!gmailConfigured()) return Response.json({ error: 'Gmail not connected' }, { status: 409 });
        const r = await py(['scripts/gmail.py', 'draft', String(b.personId)]);
        return r.ok ? Response.json(JSON.parse(r.out)) : Response.json({ error: r.err }, { status: 502 });
      }
      case 'sync': {
        if (!gmailConfigured()) return Response.json({ error: 'Gmail not connected' }, { status: 409 });
        const r = await py(['scripts/gmail.py', 'sync']);
        return r.ok ? Response.json(JSON.parse(r.out)) : Response.json({ error: r.err }, { status: 502 });
      }
      default: return bad('unknown action');
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 409 });
  }
}
