/**
 * The strongest guarantee the builder makes: every course it produces can be
 * finished. A simple bot runs each course in the real physics — once riding
 * cautiously (walks across pads, stalling its speed), once aggressively
 * (bunny-hops across pads, keeping it) — and must finish without dying.
 */
import { describe, expect, it } from 'vitest';
import { buildCourse } from './builder';
import { SHIPPED_COURSES } from './courses';
import { randomCourse } from './random';
import { simulateRun } from './simulate';

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
  }
});

describe('random courses', () => {
  it('every seed builds a course both bots finish without dying', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const built = buildCourse(randomCourse(seed));
      for (const style of STYLES) {
        const r = simulateRun(built, { hop: style.hop }, 180);
        if (!r.finished || r.deaths > 0) failures.push(`seed ${seed} ${style.name}: finished=${r.finished} deaths=${r.deaths}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
