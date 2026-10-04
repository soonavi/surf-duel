/**
 * Shape of a dev ghost file (src/course/ghosts/<id>.json). Kept free of
 * three.js so the dev server plugin in vite.config.ts can validate uploads.
 */
import { z } from 'zod';

export const DevGhostFile = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  courseKey: z.string().max(64),
  timeMs: z.number().int().positive(),
  splits: z.array(z.number().int().nonnegative().nullable()).max(64),
  ghost: z.string().regex(/^[A-Za-z0-9_-]+$/).max(400_000),
  recordedAt: z.string().max(40),
});
export type DevGhostFile = z.infer<typeof DevGhostFile>;
