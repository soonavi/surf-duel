/**
 * Seeded procedural courses: the fallback when AI generation fails, a random
 * race in a room, and a fuzzer for the builder.
 *
 * Built like a staged surf map (user, Oct 14 2026: "do more research into
 * surf maps, and increase the complexity of the map generation"): a run of
 * stages, a checkpoint between each, every stage built round one idea from
 * real maps:
 *  - flow: long sweeping ramps, curving one way then the other, some S-bends;
 *  - tech: short, steep ramps in quick succession with small gaps;
 *  - launch: a flared ramp throws you over a big gap onto a long landing;
 *  - plunge: a big drop, sometimes onto a booster;
 *  - wall: line up on a straight ramp to fly through a wall's window;
 *  - spiral: one turn round a tower (medium and up);
 *  - climb: a booster, a level ramp and a climb, keeping your speed (hard and expert).
 * Sometimes it gets its own colours. Then, like an AI course, it's ridden by
 * the difficulty's bots and simplified until they finish it (`ensureBeatable`).
 */
import { DIFFICULTIES, DIFFICULTY_STYLE, THEMES, type Course, type CourseColors, type Difficulty, type RampSegment, type RampSide, type Segment, type ThemeName } from './schema.js';
import { validateCourse } from './validator.js';
import { ensureBeatable } from './verify.js';
import { needsAirStrafe } from './tuning.js';
import { createRng } from '../util/rng.js';

const ADJECTIVES = ['Neon', 'Molten', 'Frozen', 'Hollow', 'Velvet', 'Silent', 'Crimson', 'Electric', 'Drifting', 'Shattered', 'Golden', 'Midnight'];
const NOUNS = ['Rapids', 'Spiral', 'Canyon', 'Descent', 'Ribbon', 'Cascade', 'Gauntlet', 'Slipstream', 'Abyss', 'Highway', 'Chasm', 'Run'];

/** Colour schemes a random course sometimes wears instead of its theme's: sky, right ramps, left ramps. */
const PALETTES: readonly CourseColors[] = [
  { sky: '#ff8a4c', ramp: '#3a1c5c', ramp2: '#ffd36b' }, // sunset
  { sky: '#1d6fa5', ramp: '#0b2a4a', ramp2: '#7fe3ff' }, // ocean
  { sky: '#ff9ed2', ramp: '#ff3d9a', ramp2: '#ffe3f2' }, // candy
  { sky: '#2f5d3a', ramp: '#173b22', ramp2: '#b8f27c' }, // forest
  { sky: '#14110c', ramp: '#1f1a12', ramp2: '#e8b84a' }, // black and gold
  { sky: '#9be7d8', ramp: '#1e6f66', ramp2: '#f4fffb' }, // mint
  { sky: '#ffc4d6', ramp: '#7a2346', ramp2: '#fff4f8' }, // blossom
  { sky: '#c8e4ff', ramp: '#2b4f7a', ramp2: '#ffffff' }, // arctic
];

export interface RandomCourseOptions {
  difficulty?: Difficulty;
  theme?: ThemeName;
  /**
   * Ride it and simplify it until it's beatable (default). Takes about a
   * second, once per seed (results are cached); tests of the generator itself turn it off.
   */
  verify?: boolean;
}

type Rng = () => number;

/** Builds a course stage by stage. */
class Designer {
  readonly segments: Segment[] = [];
  private side: RampSide;
  private bendSign: 1 | -1;
  sections = 0;

  constructor(
    private readonly rng: Rng,
    readonly difficulty: Difficulty,
  ) {
    this.side = rng() < 0.5 ? 'left' : 'right';
    this.bendSign = rng() < 0.5 ? 1 : -1;
  }

  get style() {
    return DIFFICULTY_STYLE[this.difficulty];
  }

  int(lo: number, hi: number): number {
    return Math.round(lo + this.rng() * (hi - lo));
  }

  chance(p: number): boolean {
    return this.rng() < p;
  }

  /** Mostly alternating sides, now and then the same again, rarely a two-sided ridge. */
  private nextSide(allowBoth: boolean): RampSide {
    const roll = this.rng();
    if (allowBoth && roll < 0.1) this.side = 'both';
    else if (roll < 0.25 && this.side !== 'both') return this.side;
    else this.side = this.side === 'left' ? 'right' : 'left';
    return this.side;
  }

  /** A curve, alternating its direction from one curved ramp to the next (a course that winds, not one that circles). */
  bend(fraction: number): number {
    this.bendSign = this.bendSign === 1 ? -1 : 1;
    return this.bendSign * Math.round(this.style.maxCurve * fraction);
  }

  /** A ramp of the given build: long (flowing), mid, or short (technical). */
  ramp(build: 'long' | 'mid' | 'short', extra: Partial<RampSegment> = {}): void {
    const [lo, hi] = this.style.length;
    const [aLo, aHi] = this.style.angle;
    const span = { long: [0.55, 1], mid: [0.3, 0.7], short: [0, 0.35] }[build];
    const length = this.int(lo + (hi - lo) * span[0]!, lo + (hi - lo) * span[1]!);
    const angle = build === 'short' ? this.int((aLo + aHi) / 2, aHi) : this.int(aLo, aHi);
    this.segments.push({ type: 'ramp', length, angle, side: this.nextSide(build !== 'long'), curve: 0, ...extra });
    this.sections++;
  }

  push(...segments: Segment[]): void {
    this.segments.push(...segments);
  }
}

/** A stage: one idea, a few sections long. */
type Stage = (d: Designer) => void;

const STAGES: Record<'flow' | 'tech' | 'launch' | 'plunge' | 'wall' | 'spiral' | 'climb', Stage> = {
  flow(d) {
    const n = d.int(2, 3);
    for (let i = 0; i < n; i++) {
      const swerve = d.chance(d.difficulty === 'easy' ? 0.2 : 0.45) ? Math.round(d.style.maxSwerve * (0.5 + d.int(0, 5) / 10)) * (d.chance(0.5) ? 1 : -1) : 0;
      d.ramp('long', { curve: d.chance(0.75) ? d.bend(0.4 + d.int(0, 6) / 10) : 0, ...(swerve ? { swerve } : {}) });
      if (i < n - 1 && d.chance(0.15)) d.push({ type: 'booster', strength: d.int(200, 350) });
    }
  },
  tech(d) {
    const n = d.int(3, 4);
    for (let i = 0; i < n; i++) {
      d.ramp('short', { curve: d.chance(0.3) ? d.bend(0.3) : 0 });
      if (i < n - 1 && d.chance(0.5)) d.push({ type: 'gap', length: d.int(250, 650) });
    }
  },
  launch(d) {
    if (d.chance(0.2)) d.push({ type: 'booster', strength: d.int(200, 400) });
    d.ramp('mid', { flare: Math.round(d.style.maxFlare * (0.6 + d.int(0, 4) / 10)) });
    d.push({ type: 'gap', length: d.int(700, 1600) });
    if (d.chance(0.35)) d.push({ type: 'drop', height: d.int(400, 1000) });
    d.ramp('long', { curve: d.chance(0.5) ? d.bend(0.5) : 0 });
  },
  plunge(d) {
    d.push({ type: 'drop', height: d.int(700, 1500) });
    if (d.chance(0.25)) d.push({ type: 'booster', strength: d.int(200, 350) });
    d.ramp('long', { curve: d.chance(0.5) ? d.bend(0.6) : 0 });
  },
  wall(d) {
    d.push({ type: 'wall' });
    d.ramp('long');
    d.ramp('mid', { curve: d.chance(0.5) ? d.bend(0.5) : 0 });
  },
  spiral(d) {
    if (d.chance(0.3)) d.push({ type: 'booster', strength: d.int(200, 350) });
    const [aLo, aHi] = d.style.angle;
    d.push({ type: 'spiral', turn: d.chance(0.5) ? 'left' : 'right', ramps: d.int(5, 7), angle: d.int(aLo, aHi) });
    d.sections++;
  },
  climb(d) {
    d.push({ type: 'booster', strength: d.int(500, 800) });
    d.ramp('mid', { pitch: 0 });
    d.ramp('mid', { pitch: -d.int(2, 5) });
    d.ramp('long', { curve: d.chance(0.5) ? d.bend(0.5) : 0 });
  },
};

/** What a difficulty's courses are made of (a stage can come up more than once). */
const MIX: Record<Difficulty, (keyof typeof STAGES)[]> = {
  easy: ['flow', 'launch', 'plunge', 'wall', 'tech', 'flow'],
  medium: ['flow', 'launch', 'tech', 'wall', 'plunge', 'spiral', 'flow'],
  hard: ['flow', 'launch', 'tech', 'wall', 'climb', 'spiral', 'plunge', 'launch', 'wall'],
  expert: ['tech', 'launch', 'wall', 'climb', 'spiral', 'tech', 'launch', 'wall', 'climb'],
};

/** The course as designed, before it's ridden: validated, but not yet proven beatable. */
export function designRandomCourse(seed: number, opts: RandomCourseOptions = {}): Course {
  const rng = createRng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const difficulty = opts.difficulty ?? pick(DIFFICULTIES);
  const theme = opts.theme ?? pick(THEMES);
  const d = new Designer(rng, difficulty);
  const [minSections, maxSections] = DIFFICULTY_STYLE[difficulty].ramps;
  const target = d.int(minSections, maxSections);

  // Warm up with a flowing stage, then the difficulty's mix in a shuffled order, a checkpoint between stages.
  const mix = [...MIX[difficulty]];
  for (let i = mix.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [mix[i], mix[j]] = [mix[j]!, mix[i]!];
  }
  const order: (keyof typeof STAGES)[] = ['flow', ...mix];
  // Spirals ride best early, before riders who don't air-strafe are too fast to hold the turn.
  if (!needsAirStrafe(difficulty)) {
    const at = order.indexOf('spiral');
    if (at > 1) order.splice(1, 0, ...order.splice(at, 1));
  }
  for (let i = 0; d.sections < target && i < order.length * 2; i++) {
    if (i > 0) d.push({ type: 'checkpoint' });
    STAGES[order[i % order.length]!](d);
  }
  // Finish on a long ramp, so the last stage ends cleanly onto the finish pad.
  if (d.segments[d.segments.length - 1]?.type !== 'ramp') d.ramp('long');

  const colors = rng() < 0.4 ? pick(PALETTES) : null;
  const name = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
  return validateCourse({ name, theme, difficulty, segments: d.segments, ...(colors ? { colors } : {}) }).course;
}

/**
 * The old, plain recipe (independent random ramps, gentle values): what a
 * random course falls back to if even its simplified version can't be
 * finished. The playability tests prove these beatable.
 */
function plainCourse(seed: number, difficulty: Difficulty, theme: ThemeName): Course {
  const rng = createRng(seed ^ 0x5eed);
  const between = (lo: number, hi: number): number => Math.round(lo + rng() * (hi - lo));
  const style = DIFFICULTY_STYLE[difficulty];
  const segments: Segment[] = [];
  let side: RampSide = rng() < 0.5 ? 'left' : 'right';
  const ramps = needsAirStrafe(difficulty) ? between(10, 15) : between(6, 9);
  for (let i = 0; i < ramps; i++) {
    if (i > 0) {
      const roll = rng();
      if (roll < 0.15) segments.push({ type: 'booster', strength: between(200, 500) });
      else if (roll < 0.3) segments.push({ type: 'gap', length: between(300, 900) });
      else if (roll < 0.4) segments.push({ type: 'drop', height: between(400, 1500) });
      else if (roll < 0.5) segments.push({ type: 'checkpoint' });
    }
    side = side === 'left' ? 'right' : 'left';
    segments.push({ type: 'ramp', length: between(style.length[0], style.length[1]), angle: between(style.angle[0], style.angle[1]), side, curve: rng() < 0.5 ? 0 : between(-style.maxCurve, style.maxCurve) });
  }
  return validateCourse({ name: 'Plain Run', theme, difficulty, segments }).course;
}

/** Ridden courses by seed and options: checking one takes about a second. */
const cache = new Map<string, Course>();
const CACHE_SIZE = 24;

export function randomCourse(seed: number, opts: RandomCourseOptions = {}): Course {
  const designed = designRandomCourse(seed, opts);
  if (opts.verify === false) return designed;
  const key = `${seed}|${designed.difficulty}|${designed.theme}`;
  const cached = cache.get(key);
  if (cached) return structuredClone(cached);
  const checked = ensureBeatable(designed);
  const course = checked.beatable ? checked.course : plainCourse(seed, designed.difficulty, designed.theme);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, course);
  return structuredClone(course);
}

