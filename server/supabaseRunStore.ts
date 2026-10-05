/**
 * RunStore on Supabase Postgres (the runs table and the submit_run function
 * in supabase/migrations). Uses the service-role key, so it only ever runs
 * server-side.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { RunStore, StoreOutcome } from './submitRun';

const Row = z.object({
  status: z.enum(['ok', 'kept', 'ip-window', 'global-day']),
  run_id: z.string().nullable(),
  place: z.coerce.number().nullable(),
  total: z.coerce.number().nullable(),
  best_ms: z.number().nullable(),
});

export function supabaseRunStore(db: SupabaseClient): RunStore {
  return {
    async courseSpec(code) {
      const { data, error } = await db.from('courses').select('spec').eq('code', code).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { spec: unknown } | null)?.spec ?? null;
    },

    async submit(row, ipHash, limits): Promise<StoreOutcome> {
      const { data, error } = await db.rpc('submit_run', {
        p_course_key: row.courseKey,
        p_course_ref: row.courseRef,
        p_player_id: row.playerId,
        p_player_name: row.playerName,
        p_time_ms: row.timeMs,
        p_splits: row.splits,
        p_ghost: row.ghost,
        p_assist: row.assist,
        p_ip_hash: ipHash,
        p_window_seconds: Math.round(limits.windowMs / 1000),
        p_per_ip_window: limits.perIpWindow,
        p_global_day: limits.globalPerDay,
      });
      if (error) throw new Error(error.message);
      const parsed = Row.safeParse(Array.isArray(data) ? data[0] : data);
      if (!parsed.success) throw new Error('Unexpected submit_run result');
      const r = parsed.data;
      if (r.status === 'ip-window' || r.status === 'global-day') return { status: r.status };
      if (r.run_id === null || r.place === null || r.total === null || r.best_ms === null) throw new Error('Incomplete submit_run result');
      return { status: r.status, runId: r.run_id, place: r.place, total: r.total, bestMs: r.best_ms };
    },
  };
}
