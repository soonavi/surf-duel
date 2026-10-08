/**
 * Course spec. This zod schema is the contract for hand-made course JSON,
 * AI-generated courses (Phase 5 derives the OpenAI JSON schema from it), and
 * share codes. Anything from outside goes through `validateCourse` first,
 * which repairs instead of rejecting.
 */
import { z } from 'zod';

export const THEMES = ['neon', 'desert', 'ice', 'lava', 'void'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
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
  /** Degrees a ramp runs downhill along its length; negative climbs. */
  rampPitch: { min: -8, max: 12 },
  dropHeight: { min: 200, max: 2500 },
  gapLength: { min: 100, max: 3000 },
  boosterStrength: { min: 100, max: 800 },
  /** Ramps in one turn of a spiral round a tower. */
  spiralRamps: { min: 4, max: 8 },
  /** Room for 18 AI sections: a wall, the ramp, and up to two pieces (gap, drop, booster, checkpoint) after it. */
  segments: { max: 72 },
  minRamps: 2,
  /** Sum of ramp lengths, gaps, drops and spirals, in units (a minute-long course is ~100k). */
  totalLength: { min: 6000, max: 140000 },
  /** Total turning across the course, so it never loops back over itself. */
  maxHeadingDrift: 150,
} as const;

/**
 * What each difficulty looks like: ramp angles, the most a single ramp bends,
 * ramp lengths (hard maps have short ramps: less time to settle before the
 * next transfer), and how many ramps the AI is asked for: about a minute of
 * riding (user, Oct 6 2026: the old courses were "only about 20 seconds").
 * Used by the random generator and the AI system prompt.
 * The layout adds the rest (tuning.ts): on hard and expert, every ramp sits
 * off to the side of the last, so you must air-strafe across.
 */
export const DIFFICULTY_STYLE: Readonly<
  Record<Difficulty, { angle: readonly [number, number]; maxCurve: number; length: readonly [number, number]; ramps: readonly [number, number] }>
> = {
  easy: { angle: [46, 52], maxCurve: 15, length: [3000, 6000], ramps: [12, 16] },
  medium: { angle: [50, 56], maxCurve: 30, length: [2500, 6000], ramps: [14, 18] },
  hard: { angle: [54, 60], maxCurve: 45, length: [2000, 4500], ramps: [14, 18] },
  expert: { angle: [56, 60], maxCurve: 45, length: [1500, 3500], ramps: [14, 18] },
};

export const RampSegment = z.object({
  type: z.literal('ramp'),
  length: z.number().min(LIMITS.rampLength.min).max(LIMITS.rampLength.max),
  angle: z.number().min(LIMITS.rampAngle.min).max(LIMITS.rampAngle.max),
  side: z.enum(RAMP_SIDES),
  curve: z.number().min(LIMITS.rampCurve.min).max(LIMITS.rampCurve.max),
  /**
   * How steeply it runs downhill along its length (degrees). 0 is level and
   * negative climbs, so speed has to come from boosters and be kept. Left
   * out (or null, as the AI sends it), the difficulty's usual slope.
   */
  pitch: z.number().min(LIMITS.rampPitch.min).max(LIMITS.rampPitch.max).nullable().optional(),
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

/** A wall across the next ramp with a window round the riding line: stay on your line or hit it. */
export const WallSegment = z.object({
  type: z.literal('wall'),
});

/** One full turn of ramps round a tall tower, with a transfer between each. */
export const SpiralSegment = z.object({
  type: z.literal('spiral'),
  /** Which way it turns; you hold the key toward the tower. */
  turn: z.enum(['left', 'right']),
  ramps: z.number().int().min(LIMITS.spiralRamps.min).max(LIMITS.spiralRamps.max),
  angle: z.number().min(LIMITS.rampAngle.min).max(LIMITS.rampAngle.max),
});

export const Segment = z.discriminatedUnion('type', [
  RampSegment,
  DropSegment,
  GapSegment,
  BoosterSegment,
  CheckpointSegment,
  WallSegment,
  SpiralSegment,
]);

/** Least WCAG contrast between a course's two ramp colours: they tell you which key to hold. */
export const MIN_RAMP_CONTRAST = 1.5;

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);

/**
 * A course's own colours (user, Oct 2026: an "all pink" AI course came out
 * as the Neon theme). The theme still sets the mood: music, fog, and the
 * finish and booster colours where they still show up.
 */
export const CourseColors = z.object({
  /** Horizon colour; the rest of the sky is shaded from it. */
  sky: HexColor,
  /** Ramps on your right (hold D), and two-sided ramps. */
  ramp: HexColor,
  /** Ramps on your left (hold A). */
  ramp2: HexColor,
});

export const Course = z.object({
  name: z.string().min(1).max(LIMITS.name.max),
  theme: z.enum(THEMES),
  difficulty: z.enum(DIFFICULTIES),
  segments: z.array(Segment).min(1).max(LIMITS.segments.max),
  /**
   * Left out for the theme's own colours (so older courses keep their keys).
   * The AI sends null for that; the validator leaves the key out.
   */
  colors: CourseColors.nullable().optional(),
});

export type RampSegment = z.infer<typeof RampSegment>;
export type DropSegment = z.infer<typeof DropSegment>;
export type GapSegment = z.infer<typeof GapSegment>;
export type BoosterSegment = z.infer<typeof BoosterSegment>;
export type CheckpointSegment = z.infer<typeof CheckpointSegment>;
export type WallSegment = z.infer<typeof WallSegment>;
export type SpiralSegment = z.infer<typeof SpiralSegment>;
export type Segment = z.infer<typeof Segment>;
export type Course = z.infer<typeof Course>;
export type CourseColors = z.infer<typeof CourseColors>;
