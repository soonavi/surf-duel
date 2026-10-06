/**
 * Seeded procedural courses. The fallback when AI generation fails (Phase 5),
 * and a fuzzer for the builder: every seed must produce a beatable course.
 */
import { DIFFICULTIES, DIFFICULTY_STYLE, THEMES, type Course, type Difficulty, type RampSide, type Segment, type ThemeName } from './schema.js';
import { validateCourse } from './validator.js';
import { createRng } from '../util/rng.js';

const ADJECTIVES = ['Neon', 'Molten', 'Frozen', 'Hollow', 'Velvet', 'Silent', 'Crimson', 'Electric', 'Drifting', 'Shattered', 'Golden', 'Midnight'];
const NOUNS = ['Rapids', 'Spiral', 'Canyon', 'Descent', 'Ribbon', 'Cascade', 'Gauntlet', 'Slipstream', 'Abyss', 'Highway', 'Chasm', 'Run'];


export interface RandomCourseOptions {
  difficulty?: Difficulty;
  theme?: ThemeName;
}

export function randomCourse(seed: number, opts: RandomCourseOptions = {}): Course {
  const rng = createRng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const between = (lo: number, hi: number): number => Math.round(lo + rng() * (hi - lo));

  const difficulty = opts.difficulty ?? pick(DIFFICULTIES);
  const theme = opts.theme ?? pick(THEMES);
  const [angleLo, angleHi] = DIFFICULTY_STYLE[difficulty].angle;
  const [lengthLo, lengthHi] = DIFFICULTY_STYLE[difficulty].length;
  const segments: Segment[] = [];
  const ramps = between(4, 8);
  let side: RampSide = rng() < 0.5 ? 'left' : 'right';

  for (let i = 0; i < ramps; i++) {
    if (i > 0) {
      const roll = rng();
      if (roll < 0.15) segments.push({ type: 'booster', strength: between(200, 500) });
      else if (roll < 0.3) segments.push({ type: 'gap', length: between(300, 900) });
      else if (roll < 0.4) segments.push({ type: 'drop', height: between(400, 1500) });
      else if (roll < 0.5) segments.push({ type: 'checkpoint' });
    }
    const sideRoll = rng();
    side = sideRoll < 0.1 ? 'both' : sideRoll < 0.25 ? side === 'both' ? 'right' : side : side === 'left' ? 'right' : 'left';
    segments.push({
      type: 'ramp',
      length: between(lengthLo, lengthHi),
      angle: between(angleLo, angleHi),
      side,
      curve: rng() < 0.5 ? 0 : between(-DIFFICULTY_STYLE[difficulty].maxCurve, DIFFICULTY_STYLE[difficulty].maxCurve),
    });
  }

  return validateCourse({ name: `${pick(ADJECTIVES)} ${pick(NOUNS)}`, theme, difficulty, segments }).course;
}
