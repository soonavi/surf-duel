/**
 * For tests: seeded random courses shaped like the AI's replies (sections,
 * walls on some ramps, at most one spiral, every value anywhere in the
 * schema's ranges), laid end to end by the same `courseFromAi` the server
 * uses. Whatever the model sends must lay out, and be beatable.
 */
import { AI_MAX_PIECES, courseFromAi } from './aiSchema.js';
import { DIFFICULTY_STYLE, LIMITS, RAMP_SIDES, type Difficulty } from './schema.js';
import { createRng } from '../util/rng.js';

export function aiShapedCourse(seed: number, difficulty: Difficulty): unknown {
  const rng = createRng(seed);
  const int = (lo: number, hi: number): number => Math.round(lo + rng() * (hi - lo));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const [minSections, maxSections] = DIFFICULTY_STYLE[difficulty].ramps;
  const count = int(minSections, maxSections);
  const spiralAt = rng() < 0.7 ? int(0, count - 1) : -1;
  const sections: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const then = Array.from({ length: i === count - 1 ? 0 : int(0, AI_MAX_PIECES) }, () =>
      pick([
        { type: 'drop', height: int(LIMITS.dropHeight.min, LIMITS.dropHeight.max) },
        { type: 'gap', length: int(LIMITS.gapLength.min, LIMITS.gapLength.max) },
        { type: 'booster', strength: int(LIMITS.boosterStrength.min, LIMITS.boosterStrength.max) },
        { type: 'checkpoint' },
      ]),
    );
    if (i === spiralAt) {
      const spiral = { turn: pick(['left', 'right']), ramps: int(LIMITS.spiralRamps.min, LIMITS.spiralRamps.max), angle: int(LIMITS.rampAngle.min, LIMITS.rampAngle.max) };
      sections.push({ ramp: null, wall: false, spiral, then });
    } else {
      sections.push({
        ramp: {
          length: int(LIMITS.rampLength.min, LIMITS.rampLength.max),
          angle: int(LIMITS.rampAngle.min, LIMITS.rampAngle.max),
          side: pick(RAMP_SIDES),
          curve: int(LIMITS.rampCurve.min, LIMITS.rampCurve.max),
          pitch: rng() < 0.3 ? null : int(LIMITS.rampPitch.min, LIMITS.rampPitch.max),
        },
        wall: rng() < 0.25,
        spiral: null,
        then,
      });
    }
  }
  return courseFromAi({ name: `AI-shaped ${seed}`, theme: 'neon', difficulty, colors: null, sections });
}
