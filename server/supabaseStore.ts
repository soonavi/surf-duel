/**
 * CourseStore on Supabase Postgres (tables and the claim_generation function
 * in supabase/migrations). Uses the service-role key, so it only ever runs
 * server-side.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClaimResult, CourseRow, CourseStore } from './generateCourse.js';

/** Postgres unique_violation: the share code is already taken. */
const UNIQUE_VIOLATION = '23505';
const CLAIM_RESULTS: readonly ClaimResult[] = ['ok', 'ip-window', 'ip-day', 'global-day', 'lifetime'];

export function supabaseStore(db: SupabaseClient): CourseStore {
  return {
    async claim(ipHash, limits) {
      const { data, error } = await db.rpc('claim_generation', {
        p_ip_hash: ipHash,
        p_window_seconds: Math.round(limits.windowMs / 1000),
        p_per_ip_window: limits.perIpPerWindow,
        p_per_ip_day: limits.perIpPerDay,
        p_global_day: limits.globalPerDay,
        p_lifetime: limits.lifetime,
      });
      if (error) throw new Error(error.message);
      // Anything unexpected counts as "no": never spend on a reply we don't understand.
      if (!CLAIM_RESULTS.includes(data as ClaimResult)) throw new Error(`Unexpected claim result: ${String(data)}`);
      return data as ClaimResult;
    },

    async insertCourse(row: CourseRow) {
      const { error } = await db.from('courses').insert({ code: row.code, prompt: row.prompt, spec: row.spec });
      if (!error) return 'ok';
      if (error.code === UNIQUE_VIOLATION) return 'duplicate';
      throw new Error(error.message);
    },
  };
}
