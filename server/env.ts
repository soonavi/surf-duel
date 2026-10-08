/**
 * Server-side wiring from environment variables. Only ever imported by /api
 * functions (and the dev server's /api middleware), never by the client.
 *
 *   OPENAI_API_KEY, OPENAI_MODEL      required for generation (and the free moderation check)
 *   SUPABASE_SERVICE_ROLE_KEY         required too: the spending caps live in
 *   VITE_SUPABASE_URL                 the database, and without them we refuse.
 *                                     The leaderboard and likes need only these two.
 */
import { createHmac } from 'node:crypto';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GenerateDeps } from './generateCourse.js';
import type { LikeDeps } from './likeCourse.js';
import type { SubmitDeps } from './submitRun.js';
import { supabaseLikeStore } from './supabaseLikeStore.js';
import { supabaseRunStore } from './supabaseRunStore.js';
import { openAiDesigner } from './openaiDesigner.js';
import { openAiModerator } from './openaiModerator.js';
import { supabaseStore } from './supabaseStore.js';
import { ensureBeatable } from '../src/course/verify.js';

let cached: { key: string; deps: GenerateDeps } | null = null;
let cachedDb: { key: string; db: SupabaseClient } | null = null;

/** The service-role database client, or null when it isn't configured. Reused across warm invocations. */
function serviceDb(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.VITE_SUPABASE_URL;
  if (!serviceKey || !url) return null;
  const key = `${url}|${serviceKey}`;
  if (cachedDb?.key !== key) {
    cachedDb = { key, db: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) };
  }
  return cachedDb.db;
}

/** IPs are only ever stored as a keyed hash; any server-only secret works as the key. */
function ipHasher(secret: string): (ip: string) => string {
  return (ip) => createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

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
  const db = serviceDb();
  const deps: GenerateDeps = {
    design: openAiDesigner(openai, model),
    moderate: openAiModerator(openai),
    store: db ? supabaseStore(db) : null,
    hashIp: ipHasher(serviceKey ?? apiKey),
    random: Math.random,
    ensure: ensureBeatable,
  };
  cached = { key: cacheKey, deps };
  return deps;
}

/** Dependencies for handleSubmitRun; the store is null (so runs aren't posted) without the database. */
export function submitDeps(): SubmitDeps {
  const db = serviceDb();
  return { store: db ? supabaseRunStore(db) : null, hashIp: ipHasher(process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'no-key') };
}

/** Dependencies for handleLike; without the database, likes answer "unavailable". */
export function likeDeps(): LikeDeps {
  const db = serviceDb();
  return { store: db ? supabaseLikeStore(db) : null, hashIp: ipHasher(process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'no-key') };
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
