/**
 * POST /api/submit-run  { course, playerId, name, timeMs, splits, ghost }
 *   200 { ok: true, improved, runId, place, total, bestMs, name }
 *   4xx/5xx { ok: false, reason, error }   (the run stays saved on the player's device)
 *
 * The logic lives in server/submitRun.ts; this is only HTTP plumbing.
 */
import { handleSubmitRun, MAX_GHOST_CHARS } from '../server/submitRun';
import { clientIp, json, submitDeps } from '../server/env';

export const config = { maxDuration: 10 };

/** The ghost plus a little room for the rest of the body. */
const MAX_BODY_BYTES = MAX_GHOST_CHARS + 8192;

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, reason: 'bad-request', error: 'Request too large.' });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const result = await handleSubmitRun(body, clientIp(request.headers), submitDeps());
  return json(result.status, result.body);
}
