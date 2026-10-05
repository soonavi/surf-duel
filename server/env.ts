/**
 * Server-side wiring from environment variables. Only ever imported by /api
 * functions (and the dev server's /api middleware), never by the client.
 *
 *   OPENAI_API_KEY, OPENAI_MODEL      required for generation
 *   SUPABASE_SERVICE_ROLE_KEY         required too: the spending caps live in
 *   VITE_SUPABASE_URL                 the database, and without them we refuse
 */
import { createHmac } from 'node:crypto';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import type { GenerateDeps } from './generateCourse';
import { openAiDesigner } from './openaiDesigner';
import { supabaseStore } from './supabaseStore';

let cached: { key: string; deps: GenerateDeps } | null = null;

/** Dependencies for handleGenerate, or null when OpenAI isn't configured. Reused across warm invocations. */
export function generateDeps(): GenerateDeps | null {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.VITE_SUPABASE_URL;

  const cacheKey = [apiKey, model, serviceKey, url].join('|');
  if (cached?.key === cacheKey) return cached.deps;

  const openai = new OpenAI({ apiKey });
  const db = serviceKey && url ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  // IPs are only stored as a keyed hash; any server-only secret works as the key.
  const hmacKey = serviceKey ?? apiKey;
  const deps: GenerateDeps = {
    design: openAiDesigner(openai, model),
    store: db ? supabaseStore(db) : null,
    hashIp: (ip) => createHmac('sha256', hmacKey).update(ip).digest('hex').slice(0, 32),
    random: Math.random,
  };
  cached = { key: cacheKey, deps };
  return deps;
}

/** The caller's IP. On Vercel these headers are set by the platform, not the client. */
export function clientIp(headers: Headers): string {
  return headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
