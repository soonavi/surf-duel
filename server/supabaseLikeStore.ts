/**
 * LikeStore on Supabase Postgres (course_likes and the like_course function
 * in supabase/migrations). Uses the service-role key, so it only ever runs
 * server-side.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { LikeOutcome, LikeStore } from './likeCourse.js';

const Row = z.object({
  status: z.enum(['ok', 'not-found', 'ip-window', 'global-day', 'ip-course']),
  liked: z.boolean().nullable(),
  likes: z.coerce.number().int().min(0).nullable(),
});

export function supabaseLikeStore(db: SupabaseClient): LikeStore {
  return {
    async like(code, playerId, like, ipHash, limits): Promise<LikeOutcome> {
      const { data, error } = await db.rpc('like_course', {
        p_code: code,
        p_player_id: playerId,
        p_like: like,
        p_ip_hash: ipHash,
        p_window_seconds: Math.round(limits.windowMs / 1000),
        p_per_ip_window: limits.perIpWindow,
        p_per_ip_course: limits.perIpCourse,
        p_global_day: limits.globalPerDay,
      });
      if (error) throw new Error(error.message);
      const parsed = Row.safeParse(Array.isArray(data) ? data[0] : data);
      if (!parsed.success) throw new Error('Unexpected like_course result');
      const r = parsed.data;
      if (r.status === 'ok') {
        if (r.liked === null || r.likes === null) throw new Error('Incomplete like_course result');
        return { status: 'ok', liked: r.liked, likes: r.likes };
      }
      if (r.status === 'ip-course') return { status: 'ip-course', likes: r.likes ?? 0 };
      return { status: r.status };
    },
  };
}
