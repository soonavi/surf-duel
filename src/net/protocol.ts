/**
 * Everything that crosses the network, as zod schemas. Every incoming
 * presence entry and broadcast is parsed with these; anything that doesn't
 * match is dropped.
 */
import { z } from 'zod';
import { DIFFICULTIES } from '../course/schema.js';

/** Bump when any message or presence shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export const CourseRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shipped'), id: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
  // A random course travels as its seed, plus its difficulty if the player picked one (it changes the course).
  z.object({ kind: z.literal('random'), seed: z.number().int().min(0).max(2_000_000_000), difficulty: z.enum(DIFFICULTIES).optional() }),
  // AI-generated or shared specs (Phase 5); always re-validated with validateCourse before use.
  z.object({ kind: z.literal('spec'), spec: z.unknown(), code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/).nullable().optional() }),
]);
export type CourseRef = z.infer<typeof CourseRef>;

export const RoomState = z.object({
  phase: z.enum(['lobby', 'racing']),
  raceId: z.string().max(40).nullable(),
  course: CourseRef,
  /** Fingerprint of the course; clients refuse to race if theirs differs (version skew). */
  courseKey: z.string().max(64),
  /** Race start (GO) in the host's clock, ms. */
  startAt: z.number().nullable(),
  /** Increases with every change, so a stale copy never overrides a newer one. */
  seq: z.number().int().nonnegative(),
});
export type RoomState = z.infer<typeof RoomState>;

export const PlayerStatus = z.enum(['lobby', 'racing', 'finished', 'spectating', 'practice']);
export type PlayerStatus = z.infer<typeof PlayerStatus>;

export const RaceResult = z.object({
  raceId: z.string().max(40),
  timeMs: z.number().int().positive().max(24 * 3600 * 1000),
  splits: z.array(z.number().int().nonnegative().nullable()).max(64),
});
export type RaceResult = z.infer<typeof RaceResult>;

/** What each player publishes through presence. The host's copy also carries the room state. */
export const PlayerMeta = z.object({
  v: z.number().int(),
  name: z.string().max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  joinedAt: z.number(),
  ready: z.boolean(),
  status: PlayerStatus,
  result: RaceResult.nullable(),
  room: RoomState.nullable(),
});
export type PlayerMeta = z.infer<typeof PlayerMeta>;

/** Values per sample in a state batch: t, x, y, z, vx, vy, vz, yaw×1000 (all integers). */
export const SAMPLE_STRIDE = 8;
const MAX_SAMPLES_PER_BATCH = 40;

export const StateBatch = z.object({
  id: z.string().max(64),
  r: z.string().max(40),
  s: z
    .array(z.number().int())
    .max(SAMPLE_STRIDE * MAX_SAMPLES_PER_BATCH)
    .refine((a) => a.length % SAMPLE_STRIDE === 0, 'sample array length'),
});
export type StateBatch = z.infer<typeof StateBatch>;

export const Ping = z.object({ id: z.string().max(64), n: z.number().int(), t0: z.number() });
export const Pong = z.object({ to: z.string().max(64), n: z.number().int(), t0: z.number(), t1: z.number() });
export const Finish = z.object({ id: z.string().max(64), result: RaceResult });

export const EVENTS = { state: 'st', ping: 'ping', pong: 'pong', finish: 'fin' } as const;
