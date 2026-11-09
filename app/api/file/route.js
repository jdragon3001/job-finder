import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, sep } from 'node:path';
import { getDb } from '../../../lib/server.js';

export const dynamic = 'force-dynamic';

// Serves only the resume/cover the prepare step recorded for that job, and only from data/materials/.
export function GET(req) {
  const u = new URL(req.url);
  const which = u.searchParams.get('which');
  if (which !== 'resume' && which !== 'cover') return new Response('which must be resume or cover', { status: 400 });
  const row = getDb().prepare('select materials from jobs where key=?').get(u.searchParams.get('key') || '');
  const rel = row && JSON.parse(row.materials || '{}')?.[which];
  const root = resolve('data/materials') + sep;
  const path = rel && resolve(rel);
  if (!path || !path.startsWith(root) || !existsSync(path)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(path), { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'content-disposition': `attachment; filename="${basename(path).replace(/"/g, '')}"`,
  } });
}
