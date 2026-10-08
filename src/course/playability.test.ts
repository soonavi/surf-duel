/**
 * The strongest guarantee the builder makes: every course it produces can be
 * finished. A bot runs each course in the real physics and must finish
 * without dying, from the start and from every checkpoint.
 *
 * Easy and medium courses are guaranteed for a *cautious* bot that never
 * air-strafes: it only holds into the ramp (walking or bunny-hopping across
 * pads). Hard and expert courses must need real skill (user, Oct 6 2026: the
 * old hard maps were easy): their ramps sit off to the side, so the cautious
 * bot dies on every one, and a *skilled* bot that air-strafes across the
 * transfers, like a player, must finish them all.
 */
import { describe, expect, it } from 'vitest';
import { buildCourse } from './builder.js';
import { SHIPPED_COURSES } from './courses/index.js';
import { aiShapedCourse } from './aiShapedCourses.js';
import { randomCourse } from './random.js';
import { simulateRun } from './simulate.js';
import { needsAirStrafe } from './tuning.js';
import { CAUTIOUS, ensureBeatable, failuresOn } from './verify.js';
import { validateCourse } from './validator.js';

/** AI-shaped courses tried per difficulty. */
const AI_SHAPED_SEEDS = 8;

describe('shipped courses', () => {
  for (const shipped of SHIPPED_COURSES) {
    it(`${shipped.id} needs no repairs`, () => {
      expect(buildCourse(shipped.spec).repairs).toEqual([]);
    });

    it(`${shipped.id} is finished without dying, from the start and every checkpoint`, () => {
      expect(failuresOn(shipped.spec, shipped.id)).toEqual([]);
    }, 60_000);

    if (needsAirStrafe(buildCourse(shipped.spec).course.difficulty)) {
      it(`${shipped.id} kills a rider who never air-strafes`, () => {
        for (const style of CAUTIOUS) {
          expect(simulateRun(buildCourse(shipped.spec), style, 180).deaths, style.name).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('random courses', () => {
  it('every seed builds a course its bots finish without dying, from the start and every checkpoint', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 40; seed++) failures.push(...failuresOn(randomCourse(seed), `seed ${seed}`));
    expect(failures).toEqual([]);
  }, 300_000);

  for (const difficulty of ['hard', 'expert'] as const) {
    it(`every ${difficulty} seed is finished by the skilled bot, and kills a rider who never air-strafes`, () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= 25; seed++) {
        const spec = randomCourse(seed, { difficulty });
        failures.push(...failuresOn(spec, `${difficulty} seed ${seed}`));
        for (const style of CAUTIOUS) {
          const r = simulateRun(buildCourse(spec), style, 180);
          if (r.deaths === 0) failures.push(`${difficulty} seed ${seed}: the ${style.name} bot never died`);
        }
      }
      expect(failures).toEqual([]);
    }, 300_000);
  }
});

/**
 * Courses shaped like the AI's replies, walls and spirals included, with
 * every value anywhere in the schema's ranges: whatever the model combines,
 * the course must be beatable at its difficulty.
 */
describe('AI-shaped courses with walls and spirals, as the server serves them', () => {
  // The server rides every AI course before saving it, simplifying it until its bots can finish
  // (ensureBeatable). What it serves must then pass the same checks as every other course.
  for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
    it(`${difficulty}: the bots finish every one, from the start and every checkpoint, mostly with its walls and spiral`, () => {
      const failures: string[] = [];
      let features = 0;
      let kept = 0;
      let softies = 0;
      for (let seed = 1; seed <= AI_SHAPED_SEEDS; seed++) {
        const designed = validateCourse(aiShapedCourse(seed, difficulty)).course;
        const checked = ensureBeatable(designed);
        if (!checked.beatable) failures.push(`${difficulty} AI-shaped ${seed}: still unbeatable after ${checked.changes.join(', ')}`);
        failures.push(...failuresOn(checked.course, `${difficulty} AI-shaped ${seed}`, 240));
        for (const type of ['wall', 'spiral'] as const) {
          if (!designed.segments.some((s) => s.type === type)) continue;
          features++;
          if (checked.course.segments.some((s) => s.type === type)) kept++;
        }
        // Simplifying can make a hard course survivable without air-strafing; it must stay rare.
        if (needsAirStrafe(difficulty) && CAUTIOUS.some((style) => simulateRun(buildCourse(checked.course), style, 240).deaths === 0)) softies++;
      }
      expect(failures).toEqual([]);
      expect(kept / features).toBeGreaterThanOrEqual(0.75);
      expect(softies).toBeLessThanOrEqual(2);
    }, 300_000);
  }
});

/**
 * AI output stays inside the JSON schema's ranges but can be far stranger
 * than the random generator: every knob at its extreme. Whatever the model
 * sends, validateCourse + the layout must still produce a beatable course.
 */
describe('extreme AI-style courses', () => {
  const ramp = (angle: number, side: 'left' | 'right' | 'both', curve: number, length = 9000) => ({ type: 'ramp', length, angle, side, curve });
  const alt = (i: number): 'left' | 'right' => (i % 2 === 0 ? 'right' : 'left');
  const extremes: Record<string, unknown> = {
    'max drop after every ramp, all 60°': {
      name: 'Freefall', theme: 'void', difficulty: 'hard',
      segments: Array.from({ length: 8 }, (_, i) => [ramp(60, alt(i), 0), { type: 'drop', height: 2500 }]).flat(),
    },
    'longest gaps everywhere': {
      name: 'Air Time', theme: 'ice', difficulty: 'hard',
      segments: Array.from({ length: 8 }, (_, i) => [ramp(58, alt(i), 0, 3000), { type: 'gap', length: 3000 }]).flat(),
    },
    'every ramp bends hard the same way': {
      name: 'Spiral', theme: 'neon', difficulty: 'hard',
      segments: Array.from({ length: 10 }, (_, i) => ramp(56, alt(i), 45)),
    },
    'two-sided ridges, shortest ramps': {
      name: 'Knife Edge', theme: 'desert', difficulty: 'medium',
      segments: Array.from({ length: 10 }, () => ramp(52, 'both', 0, 1500)),
    },
    'same side every time, boosters between': {
      name: 'One Way', theme: 'lava', difficulty: 'easy',
      segments: Array.from({ length: 8 }, () => [ramp(46, 'right', -15), { type: 'booster', strength: 800 }]).flat(),
    },
    'a wall across every ramp, level ramps kept fast by boosters': {
      name: 'Needle', theme: 'neon', difficulty: 'expert',
      segments: [
        { type: 'booster', strength: 800 },
        ...Array.from({ length: 8 }, (_, i) => [{ type: 'wall' }, { ...ramp(58, alt(i), i % 2 ? 20 : -20, 3500), pitch: 0 }, { type: 'booster', strength: 300 }]).flat(),
      ],
    },
    'two spirals back to back, turning both ways': {
      name: 'Corkscrew', theme: 'void', difficulty: 'hard',
      segments: [ramp(56, 'right', 0, 5000), { type: 'spiral', turn: 'left', ramps: 4, angle: 60 }, { type: 'spiral', turn: 'right', ramps: 8, angle: 46 }, ramp(58, 'left', 0, 4000)],
    },
    'a spiral straight off the start pad': {
      name: 'Launch Spiral', theme: 'ice', difficulty: 'easy',
      segments: [{ type: 'spiral', turn: 'right', ramps: 5, angle: 50 }, ramp(50, 'left', 0, 4000)],
    },
    'climbs everywhere': {
      name: 'Uphill Both Ways', theme: 'desert', difficulty: 'medium',
      segments: Array.from({ length: 10 }, (_, i) => ({ ...ramp(54, alt(i), 0, 4000), pitch: -8 })),
    },
    // A real gpt-5.4-nano reply (Oct 8 2026): fast riders land far down short ramps, so the layout
    // stretches them, and a stretched 1750-long climb used to stop the cautious rider and crash the layout.
    'stretched climbs on a booster-fast expert course': {
      name: 'Ember Rift', theme: 'lava', difficulty: 'expert',
      segments: [
        { type: 'ramp', length: 2800, angle: 58, side: 'left', curve: 32 },
        { type: 'gap', length: 520 },
        { type: 'ramp', length: 2400, angle: 57, side: 'right', curve: -28, pitch: 0 },
        { type: 'booster', strength: 520 },
        { type: 'gap', length: 620 },
        { type: 'ramp', length: 2100, angle: 59, side: 'left', curve: 40, pitch: -6 },
        { type: 'gap', length: 850 },
        { type: 'booster', strength: 320 },
        { type: 'ramp', length: 2600, angle: 58, side: 'right', curve: -36, pitch: 2 },
        { type: 'gap', length: 700 },
        { type: 'ramp', length: 1950, angle: 60, side: 'both', curve: 26, pitch: -4 },
        { type: 'checkpoint' },
        { type: 'gap', length: 900 },
        { type: 'ramp', length: 2350, angle: 57, side: 'left', curve: -30, pitch: 0 },
        { type: 'booster', strength: 460 },
        { type: 'gap', length: 650 },
        { type: 'ramp', length: 1750, angle: 58, side: 'right', curve: 42, pitch: -7 },
        { type: 'gap', length: 980 },
        { type: 'ramp', length: 3200, angle: 59, side: 'left', curve: -18, pitch: 0 },
        { type: 'drop', height: 2300 },
        { type: 'gap', length: 520 },
        { type: 'ramp', length: 2000, angle: 60, side: 'right', curve: 34, pitch: -6 },
        { type: 'booster', strength: 650 },
        { type: 'gap', length: 720 },
        { type: 'ramp', length: 2450, angle: 58, side: 'left', curve: -40, pitch: 0 },
        { type: 'gap', length: 560 },
        { type: 'ramp', length: 1700, angle: 59, side: 'right', curve: 22, pitch: -3 },
        { type: 'checkpoint' },
        { type: 'gap', length: 800 },
        { type: 'ramp', length: 2150, angle: 57, side: 'left', curve: -27, pitch: 0 },
        { type: 'booster', strength: 410 },
        { type: 'gap', length: 600 },
        { type: 'ramp', length: 2550, angle: 60, side: 'both', curve: 37, pitch: -5 },
        { type: 'gap', length: 640 },
        { type: 'ramp', length: 1850, angle: 58, side: 'right', curve: -24, pitch: 0 },
        { type: 'booster', strength: 520 },
        { type: 'gap', length: 720 },
        { type: 'ramp', length: 2400, angle: 59, side: 'left', curve: 28, pitch: -6 },
        { type: 'gap', length: 650 },
        { type: 'ramp', length: 1650, angle: 58, side: 'right', curve: 0, pitch: 0 },
      ],
    },
    'forty segments of everything': {
      name: 'Kitchen Sink', theme: 'lava', difficulty: 'hard',
      segments: Array.from({ length: 40 }, (_, i) =>
        [ramp(60, alt(i), i % 3 === 0 ? 45 : -45, 2000), { type: 'drop', height: 2500 }, { type: 'gap', length: 3000 }, { type: 'booster', strength: 800 }, { type: 'checkpoint' }][i % 5],
      ),
    },
  };

  for (const [label, spec] of Object.entries(extremes)) {
    it(`${label}: beatable from the start and every checkpoint`, () => {
      expect(failuresOn(spec, label, 240)).toEqual([]);
    }, 120_000);
  }
});
