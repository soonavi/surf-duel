/**
 * The strongest guarantee the builder makes: every course it produces can be
 * finished. A simple bot runs each course in the real physics — once riding
 * cautiously (walks across pads, stalling its speed), once aggressively
 * (bunny-hops across pads, keeping it) — and must finish without dying.
 */
import { describe, expect, it } from 'vitest';
import { buildCourse } from './builder.js';
import { SHIPPED_COURSES } from './courses/index.js';
import { randomCourse } from './random.js';
import { simulateRun } from './simulate.js';

const STYLES = [
  { name: 'cautious', hop: false },
  { name: 'aggressive', hop: true },
] as const;

describe('shipped courses', () => {
  for (const shipped of SHIPPED_COURSES) {
    it(`${shipped.id} needs no repairs`, () => {
      expect(buildCourse(shipped.spec).repairs).toEqual([]);
    });

    for (const style of STYLES) {
      it(`${shipped.id} is finished by a ${style.name} bot without dying`, () => {
        const result = simulateRun(buildCourse(shipped.spec), { hop: style.hop }, 180);
        expect(result).toMatchObject({ finished: true, deaths: 0 });
      });
    }

    it(`${shipped.id} can be finished from every checkpoint respawn`, () => {
      const built = buildCourse(shipped.spec);
      for (let cp = 1; cp < built.checkpoints.length; cp++) {
        const result = simulateRun(built, { hop: false }, 180, cp);
        expect({ cp, ...result }).toMatchObject({ cp, finished: true, deaths: 0 });
      }
    });
  }
});

describe('random courses', () => {
  it('every seed builds a course both bots finish without dying, from the start and every checkpoint', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const built = buildCourse(randomCourse(seed));
      for (const style of STYLES) {
        const r = simulateRun(built, { hop: style.hop }, 180);
        if (!r.finished || r.deaths > 0) failures.push(`seed ${seed} ${style.name}: finished=${r.finished} deaths=${r.deaths}`);
      }
      for (let cp = 1; cp < built.checkpoints.length; cp++) {
        const r = simulateRun(built, { hop: false }, 180, cp);
        if (!r.finished || r.deaths > 0) failures.push(`seed ${seed} from cp ${cp}: finished=${r.finished} deaths=${r.deaths}`);
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);
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
    'forty segments of everything': {
      name: 'Kitchen Sink', theme: 'lava', difficulty: 'hard',
      segments: Array.from({ length: 40 }, (_, i) =>
        [ramp(60, alt(i), i % 3 === 0 ? 45 : -45, 2000), { type: 'drop', height: 2500 }, { type: 'gap', length: 3000 }, { type: 'booster', strength: 800 }, { type: 'checkpoint' }][i % 5],
      ),
    },
  };

  for (const [label, spec] of Object.entries(extremes)) {
    it(`${label}: beatable from the start and every checkpoint`, () => {
      const built = buildCourse(spec);
      const failures: string[] = [];
      for (const style of STYLES) {
        const r = simulateRun(built, { hop: style.hop }, 240);
        if (!r.finished || r.deaths > 0) failures.push(`${style.name}: finished=${r.finished} deaths=${r.deaths}`);
      }
      for (let cp = 1; cp < built.checkpoints.length; cp++) {
        const r = simulateRun(built, { hop: false }, 240, cp);
        if (!r.finished || r.deaths > 0) failures.push(`from cp ${cp}: finished=${r.finished} deaths=${r.deaths}`);
      }
      expect(failures).toEqual([]);
    }, 120_000);
  }
});
