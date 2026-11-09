import { state } from '../../../lib/store.js';
import { getDb, kick, runInfo, me } from '../../../lib/server.js';

export const dynamic = 'force-dynamic';

export function GET(req) {
  const mode = new URL(req.url).searchParams.get('mode') === 'net' ? 'net' : 'list';
  kick();
  return Response.json({ ...state(getDb(), mode), run: runInfo(), me: me() });
}
