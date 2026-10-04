/**
 * POST /api/generate-course  { prompt: string }
 *   200 { ok: true, code, course, prompt, repairs }
 *   4xx/5xx { ok: false, reason, error }   (the client then offers a random course)
 *
 * The logic lives in server/generateCourse.ts; this is only HTTP plumbing.
 * In `npm run dev` the same handler runs through the dev server's /api middleware.
 */
import { handleGenerate } from '../server/generateCourse';
import { clientIp, generateDeps, json } from '../server/env';

// The OpenAI call itself is capped at 15 s; leave room for the database around it.
export const config = { maxDuration: 30 };

const MAX_BODY_BYTES = 4096;

export async function POST(request: Request): Promise<Response> {
  const deps = generateDeps();
  if (!deps) {
    return json(503, { ok: false, reason: 'unavailable', error: "AI course generation isn't set up on this server." });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, reason: 'bad-request', error: 'Request too large.' });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const result = await handleGenerate(body, clientIp(request.headers), deps);
  return json(result.status, result.body);
}
