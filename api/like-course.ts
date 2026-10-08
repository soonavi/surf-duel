/**
 * POST /api/like-course  { code, playerId, like }
 *   200 { ok: true, liked, likes }
 *   4xx/5xx { ok: false, reason, error }
 *
 * The logic lives in server/likeCourse.ts; this is only HTTP plumbing.
 */
import { handleLike } from '../server/likeCourse.js';
import { clientIp, json, likeDeps } from '../server/env.js';

export const config = { maxDuration: 10 };

const MAX_BODY_BYTES = 1024;

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, reason: 'bad-request', error: 'Request too large.' });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const result = await handleLike(body, clientIp(request.headers), likeDeps());
  return json(result.status, result.body);
}
