/**
 * Course spec. This zod schema is the contract for hand-made course JSON,
 * AI-generated courses (Phase 5 derives the OpenAI JSON schema from it), and
 * share codes. Anything from outside goes through `validateCourse` first,
 * which repairs instead of rejecting.
 */
import { z } from 'zod';

export const THEMES = ['neon', 'desert', 'ice', 'lava', 'void'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const RAMP_SIDES = ['left', 'right', 'both'] as const;

export type ThemeName = (typeof THEMES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type RampSide = (typeof RAMP_SIDES)[number];

/**
 * Safe ranges, shared by the schema, the validator and (later) the AI system
 * prompt.
 *
 * Ramp angles run 46–60°. Not 45: a 45° surface has normal.y ≈ 0.707, which
 * the physics treats as walkable floor rather than surf. Not above 60 (the
 * original spec allowed 70): playtesting found steeper ramps barely holdable —
 * at 70° strafing into the ramp only just out-pulls gravity's slide.
 */
export const LIMITS = {
  name: { max: 40 },
  rampLength: { min: 1500, max: 9000 },
  rampAngle: { min: 46, max: 60 },
  rampCurve: { min: -45, max: 45 },
  dropHeight: { min: 200, max: 2500 },
  gapLength: { min: 100, max: 3000 },
  boosterStrength: { min: 100, max: 800 },
  segments: { max: 40 },
  minRamps: 2,
  /** Sum of ramp lengths, gaps and drops, in units. */
  totalLength: { min: 6000, max: 80000 },
  /** Total turning across the course, so it never loops back over itself. */
  maxHeadingDrift: 150,
} as const;

/**
 * What each difficulty looks like: ramp angles and the most a single ramp
 * bends. Used by the random generator and the AI system prompt.
 */
export const DIFFICULTY_STYLE: Readonly<Record<Difficulty, { angle: readonly [number, number]; maxCurve: number }>> = {
  easy: { angle: [46, 52], maxCurve: 15 },
  medium: { angle: [50, 56], maxCurve: 30 },
  hard: { angle: [54, 60], maxCurve: 45 },
};

export const RampSegment = z.object({
  type: z.literal('ramp'),
  length: z.number().min(LIMITS.rampLength.min).max(LIMITS.rampLength.max),
  angle: z.number().min(LIMITS.rampAngle.min).max(LIMITS.rampAngle.max),
  side: z.enum(RAMP_SIDES),
  curve: z.number().min(LIMITS.rampCurve.min).max(LIMITS.rampCurve.max),
});

export const DropSegment = z.object({
  type: z.literal('drop'),
  height: z.number().min(LIMITS.dropHeight.min).max(LIMITS.dropHeight.max),
});

export const GapSegment = z.object({
  type: z.literal('gap'),
  length: z.number().min(LIMITS.gapLength.min).max(LIMITS.gapLength.max),
});

export const BoosterSegment = z.object({
  type: z.literal('booster'),
  strength: z.number().min(LIMITS.boosterStrength.min).max(LIMITS.boosterStrength.max),
});

export const CheckpointSegment = z.object({
  type: z.literal('checkpoint'),
});

export const Segment = z.discriminatedUnion('type', [RampSegment, DropSegment, GapSegment, BoosterSegment, CheckpointSegment]);

export const Course = z.object({
  name: z.string().min(1).max(LIMITS.name.max),
  theme: z.enum(THEMES),
  difficulty: z.enum(DIFFICULTIES),
  segments: z.array(Segment).min(1).max(LIMITS.segments.max),
});

export type RampSegment = z.infer<typeof RampSegment>;
export type DropSegment = z.infer<typeof DropSegment>;
export type GapSegment = z.infer<typeof GapSegment>;
export type BoosterSegment = z.infer<typeof BoosterSegment>;
export type CheckpointSegment = z.infer<typeof CheckpointSegment>;
export type Segment = z.infer<typeof Segment>;
export type Course = z.infer<typeof Course>;
