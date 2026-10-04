/**
 * CourseStore on Supabase Postgres (tables in supabase/migrations). Uses the
 * service-role key, so it only ever runs server-side.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseRow, CourseStore } from './generateCourse';

/** Postgres unique_violation: the share code is already taken. */
const UNIQUE_VIOLATION = '23505';
/** Rate-limit rows older than this are no longer needed. */
const KEEP_REQUESTS_MS = 2 * 24 * 60 * 60_000;

export function supabaseStore(db: SupabaseClient): CourseStore {
  return {
    async countRecent(ipHash, sinceMs) {
      const { count, error } = await db
        .from('generation_requests')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', new Date(sinceMs).toISOString());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async logRequest(ipHash) {
      const { error } = await db.from('generation_requests').insert({ ip_hash: ipHash });
      if (error) throw new Error(error.message);
      // Now and then, tidy rows the limiter no longer looks at.
      if (Math.random() < 0.02) {
        await db
          .from('generation_requests')
          .delete()
          .lt('created_at', new Date(Date.now() - KEEP_REQUESTS_MS).toISOString());
      }
    },

    async insertCourse(row: CourseRow) {
      const { error } = await db.from('courses').insert({ code: row.code, prompt: row.prompt, spec: row.spec });
      if (!error) return 'ok';
      if (error.code === UNIQUE_VIOLATION) return 'duplicate';
      throw new Error(error.message);
    },
  };
}
