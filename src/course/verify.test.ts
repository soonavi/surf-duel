import { describe, expect, it } from 'vitest';
import { aiShapedCourse } from './aiShapedCourses.js';
import { SHIPPED_COURSES } from './courses/index.js';
import { DIFFICULTY_STYLE, type Course } from './schema.js';
import { validateCourse } from './validator.js';
import { LONGEST_RIDE_SECONDS, ensureBeatable, failuresOn, reinInSpeed, spiralEarly, tameCourse } from './verify.js';

const course = (segments: Course['segments'], difficulty: Course['difficulty'] = 'medium'): Course => ({ name: 'Verify Test', theme: 'neon', difficulty, segments });

describe('tameCourse', () => {
  it("clamps every value into the difficulty's usual ranges and drops custom slopes, keeping walls and spirals", () => {
    const wild = course([
      { type: 'ramp', length: 9000, angle: 46, side: 'left', curve: 45, pitch: -8 },
      { type: 'gap', length: 3000 },
      { type: 'drop', height: 2500 },
      { type: 'booster', strength: 800 },
      { type: 'wall' },
      { type: 'ramp', length: 1500, angle: 60, side: 'right', curve: -45 },
      { type: 'spiral', turn: 'left', ramps: 8, angle: 60 },
    ]);
    const style = DIFFICULTY_STYLE.medium;
    expect(tameCourse(wild).segments).toEqual([
      { type: 'ramp', length: style.length[1], angle: style.angle[0], side: 'left', curve: style.maxCurve },
      { type: 'gap', length: 900 },
      { type: 'drop', height: 1500 },
      { type: 'booster', strength: 500 },
      { type: 'wall' },
      { type: 'ramp', length: style.length[0], angle: style.angle[1], side: 'right', curve: -style.maxCurve },
      { type: 'spiral', turn: 'left', ramps: 8, angle: style.angle[1] },
    ]);
  });
});

describe('reinInSpeed', () => {
  it('shrinks big drops and boosters', () => {
    const fast = course([{ type: 'drop', height: 1500 }, { type: 'booster', strength: 500 }, { type: 'drop', height: 400 }]);
    expect(reinInSpeed(fast).segments).toEqual([{ type: 'drop', height: 800 }, { type: 'booster', strength: 300 }, { type: 'drop', height: 400 }]);
  });
});

describe('spiralEarly', () => {
  it('moves the spiral to just after the first ramp, where riders are still slow', () => {
    const r = { type: 'ramp', length: 4000, angle: 52, side: 'left', curve: 0 } as const;
    const s = { type: 'spiral', turn: 'right', ramps: 6, angle: 54 } as const;
    expect(spiralEarly(course([r, r, { type: 'gap', length: 500 }, r, s, r])).segments).toEqual([r, s, r, { type: 'gap', length: 500 }, r, r]);
    const early = course([r, s, r]);
    expect(spiralEarly(early)).toBe(early);
  });
});

describe('ensureBeatable', () => {
  it('leaves a course its bots can finish exactly as it is', () => {
    const spire = validateCourse(SHIPPED_COURSES.find((c) => c.id === 'spire')!.spec).course;
    expect(ensureBeatable(spire)).toEqual({ course: spire, changes: [], beatable: true });
  }, 60_000);

  it('tames a course that would take riders far longer than a minute or two', () => {
    // A real gpt-5.4-nano reply (Oct 8 2026, "all pink", hard): level ramps and climbs with no
    // boosters at all, which took the skilled bot 165 s.
    const crawl = validateCourse(
      course(
        [
          { type: 'ramp', length: 3900, angle: 58, side: 'left', curve: 30 },
          { type: 'spiral', turn: 'left', ramps: 6, angle: 50 },
          { type: 'wall' },
          { type: 'ramp', length: 2500, angle: 58, side: 'right', curve: -20, pitch: 0 },
          { type: 'ramp', length: 3400, angle: 56, side: 'left', curve: 35, pitch: -6 },
          { type: 'ramp', length: 3200, angle: 57, side: 'right', curve: -25, pitch: 0 },
          { type: 'ramp', length: 2300, angle: 58, side: 'left', curve: 20, pitch: -4 },
          { type: 'wall' },
          { type: 'ramp', length: 3600, angle: 59, side: 'both', curve: 10, pitch: 0 },
          { type: 'ramp', length: 2100, angle: 58, side: 'right', curve: -35, pitch: 0 },
          { type: 'ramp', length: 3800, angle: 57, side: 'left', curve: 40, pitch: -7 },
          { type: 'ramp', length: 2600, angle: 58, side: 'right', curve: -15, pitch: 0 },
          { type: 'ramp', length: 3000, angle: 59, side: 'left', curve: 25, pitch: -2.1 },
          { type: 'ramp', length: 1700, angle: 60, side: 'right', curve: -30, pitch: 0 },
          { type: 'ramp', length: 2400, angle: 58, side: 'left', curve: 18, pitch: 0 },
          { type: 'ramp', length: 3200, angle: 59, side: 'right', curve: -28 },
        ],
        'hard',
      ),
    ).course;
    expect(failuresOn(crawl, 'crawl', 240, true, LONGEST_RIDE_SECONDS)).toEqual([expect.stringMatching(/took \d+ s/)]);
    const out = ensureBeatable(crawl);
    expect(out).toMatchObject({ beatable: true, changes: ["values tamed to the difficulty's usual ranges"] });
    expect(failuresOn(out.course, 'tamed', 240, true, LONGEST_RIDE_SECONDS)).toEqual([]);
  }, 120_000);

  it('simplifies an AI-shaped course its bots can not finish, only as far as it must', () => {
    // Its spiral comes late in a long, fast medium course: the cautious rider slides off the outside.
    const fast = validateCourse(aiShapedCourse(7, 'medium')).course;
    expect(failuresOn(fast, 'as designed', 180, true)).not.toEqual([]);
    const out = ensureBeatable(fast);
    expect(out.beatable).toBe(true);
    expect(out.changes.at(-1)).toBe('spiral moved to the start');
    expect(out.course.segments.some((s) => s.type === 'spiral')).toBe(true);
    expect(failuresOn(out.course, 'simplified')).toEqual([]);
  }, 120_000);
});
