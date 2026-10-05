import { describe, expect, it } from 'vitest';
import { Course, LIMITS, type Segment } from './schema';
import { validateCourse } from './validator';
import { createRng } from '../util/rng';

const ramp = (over: Partial<Extract<Segment, { type: 'ramp' }>> = {}): Segment => ({
  type: 'ramp',
  length: 4000,
  angle: 60,
  side: 'right',
  curve: 0,
  ...over,
});

const valid = (): Course => ({
  name: 'Test Course',
  theme: 'lava',
  difficulty: 'medium',
  segments: [ramp(), ramp({ side: 'left', curve: 20 }), { type: 'checkpoint' }, ramp({ curve: -15 })],
});

const rampsOf = (c: Course) => c.segments.filter((s): s is Extract<Segment, { type: 'ramp' }> => s.type === 'ramp');

describe('validateCourse', () => {
  it('passes a valid course through untouched', () => {
    const { course, repairs } = validateCourse(valid());
    expect(course).toEqual(valid());
    expect(repairs).toEqual([]);
  });

  it('clamps out-of-range ramp values, including 45° up to the surfable minimum', () => {
    const { course, repairs } = validateCourse({
      ...valid(),
      segments: [ramp({ angle: 45, length: 50, curve: 200 }), ramp({ angle: 90, length: 1e9, curve: -200 })],
    });
    const [a, b] = rampsOf(course);
    expect(a).toMatchObject({ angle: LIMITS.rampAngle.min, length: LIMITS.rampLength.min, curve: LIMITS.rampCurve.max });
    expect(b).toMatchObject({ angle: LIMITS.rampAngle.max, length: LIMITS.rampLength.max });
    expect(b!.curve).toBeLessThan(0);
    expect(repairs.length).toBeGreaterThan(0);
  });

  it('caps ramp steepness at 60° so steep ramps stay holdable', () => {
    const { course } = validateCourse({ ...valid(), segments: [ramp({ angle: 70 }), ramp({ angle: 64, side: 'left' })] });
    expect(rampsOf(course).map((r) => r.angle)).toEqual([60, 60]);
  });

  it('coerces numeric strings and replaces non-numbers with defaults', () => {
    const { course } = validateCourse({
      ...valid(),
      segments: [{ type: 'ramp', length: '3000', angle: 'steep', side: 'right', curve: null }, ramp()],
    });
    const [a] = rampsOf(course);
    expect(a!.length).toBe(3000);
    expect(Number.isFinite(a!.angle)).toBe(true);
    expect(a!.curve).toBe(0);
  });

  it('drops unknown segment types and says so', () => {
    const { course, repairs } = validateCourse({ ...valid(), segments: [ramp(), { type: 'loop-de-loop' }, ramp({ side: 'left' })] });
    expect(course.segments.map((s) => s.type)).toEqual(['ramp', 'ramp']);
    expect(repairs.join(' ')).toMatch(/loop-de-loop/);
  });

  it('fills in a bad name, theme and difficulty', () => {
    const { course } = validateCourse({ ...valid(), name: '   ', theme: 'jungle', difficulty: 'nightmare' });
    expect(course.name.length).toBeGreaterThan(0);
    expect(course.theme).toBe('neon');
    expect(course.difficulty).toBe('medium');
  });

  it('accepts theme and difficulty in any case', () => {
    const { course } = validateCourse({ ...valid(), theme: 'ICE', difficulty: 'Hard' });
    expect(course.theme).toBe('ice');
    expect(course.difficulty).toBe('hard');
  });

  it('replaces names other players should not see: links, blocked words, hidden text', () => {
    for (const name of ['Free robux at robux-gift.xyz', 'Sh1t Canyon', '\u202E\u200B']) {
      const { course, repairs } = validateCourse({ ...valid(), name });
      expect(course.name, name).toBe('Untitled Course');
      expect(repairs.some((r) => r.startsWith('name:'))).toBe(true);
    }
  });

  it('truncates long names and strips control characters', () => {
    const { course } = validateCourse({ ...valid(), name: 'A\u0000B\nC' + 'x'.repeat(100) });
    expect(course.name.startsWith('AB C')).toBe(true);
    expect(course.name.length).toBeLessThanOrEqual(LIMITS.name.max);
  });

  it('never allows two drops in a row', () => {
    const { course } = validateCourse({
      ...valid(),
      segments: [ramp(), { type: 'drop', height: 800 }, { type: 'drop', height: 900 }, ramp({ side: 'left' })],
    });
    const types = course.segments.map((s) => s.type);
    for (let i = 1; i < types.length; i++) expect(types[i] === 'drop' && types[i - 1] === 'drop').toBe(false);
    const drop = course.segments.find((s) => s.type === 'drop');
    expect(drop).toEqual({ type: 'drop', height: 1700 });
  });

  it('removes checkpoints before the first ramp, at the end, and back-to-back', () => {
    const { course } = validateCourse({
      ...valid(),
      segments: [{ type: 'checkpoint' }, ramp(), { type: 'checkpoint' }, { type: 'checkpoint' }, ramp({ side: 'left' }), { type: 'checkpoint' }],
    });
    expect(course.segments.map((s) => s.type)).toEqual(['ramp', 'checkpoint', 'ramp']);
  });

  it('adds ramps when there are too few to race', () => {
    const { course } = validateCourse({ ...valid(), segments: [{ type: 'booster', strength: 300 }] });
    expect(rampsOf(course).length).toBeGreaterThanOrEqual(LIMITS.minRamps);
  });

  it('shortens a gap to what a cautious rider can clear', () => {
    // Straight after the start, a cautious rider is only walking (~260 u/s).
    const { course, repairs } = validateCourse({ ...valid(), segments: [{ type: 'gap', length: 3000 }, ramp(), ramp({ side: 'left' })] });
    const gap = course.segments.find((s) => s.type === 'gap');
    expect(gap && gap.type === 'gap' && gap.length).toBeLessThan(500);
    expect(repairs.join(' ')).toMatch(/gap/i);
  });

  it('allows longer gaps once riders have built speed', () => {
    const { course } = validateCourse({
      ...valid(),
      segments: [ramp({ length: 8000 }), ramp({ side: 'left', length: 8000 }), { type: 'gap', length: 1000 }, ramp()],
    });
    const gap = course.segments.find((s) => s.type === 'gap');
    expect(gap).toEqual({ type: 'gap', length: 1000 });
  });

  it('trims a course that is too long', () => {
    const segments = Array.from({ length: 30 }, (_, i) => ramp({ length: 9000, side: i % 2 ? 'left' : 'right' }));
    const { course } = validateCourse({ ...valid(), segments });
    const total = rampsOf(course).reduce((sum, r) => sum + r.length, 0);
    expect(total).toBeLessThanOrEqual(LIMITS.totalLength.max);
  });

  it('extends a course that is too short', () => {
    const { course } = validateCourse({ ...valid(), segments: [ramp({ length: 1500 }), ramp({ length: 1500, side: 'left' })] });
    const total = rampsOf(course).reduce((sum, r) => sum + r.length, 0);
    expect(total).toBeGreaterThanOrEqual(LIMITS.totalLength.min);
  });

  it('keeps total turning within limits so the course never loops over itself', () => {
    const segments = Array.from({ length: 8 }, (_, i) => ramp({ curve: 45, side: i % 2 ? 'left' : 'right' }));
    const { course } = validateCourse({ ...valid(), segments });
    let heading = 0;
    for (const r of rampsOf(course)) {
      heading += r.curve;
      expect(Math.abs(heading)).toBeLessThanOrEqual(LIMITS.maxHeadingDrift + 1e-9);
    }
  });

  it('caps the number of segments', () => {
    const segments = Array.from({ length: 100 }, (_, i) => (i % 2 ? { type: 'booster', strength: 200 } : ramp({ length: 1500 })));
    const { course } = validateCourse({ ...valid(), segments });
    expect(course.segments.length).toBeLessThanOrEqual(LIMITS.segments.max);
  });

  it.each([null, undefined, 42, 'course', [], {}, { segments: 'nope' }, { segments: [null, 1, 'x', {}] }])(
    'turns garbage (%j) into a playable course',
    (input) => {
      const { course } = validateCourse(input);
      expect(Course.safeParse(course).success).toBe(true);
      expect(rampsOf(course).length).toBeGreaterThanOrEqual(LIMITS.minRamps);
    },
  );

  it('never throws and always returns a schema-valid course for random junk', () => {
    const rng = createRng(1234);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
    const junkValue = (): unknown =>
      pick([() => rng() * 1e5 - 5e4, () => NaN, () => Infinity, () => 'str', () => null, () => true, () => ({}), () => []])();
    for (let i = 0; i < 500; i++) {
      const segments = Array.from({ length: Math.floor(rng() * 60) }, () => ({
        type: pick(['ramp', 'drop', 'gap', 'booster', 'checkpoint', 'bogus', 7]),
        length: junkValue(),
        angle: junkValue(),
        side: pick(['left', 'right', 'both', 'up', 3]),
        curve: junkValue(),
        height: junkValue(),
        strength: junkValue(),
      }));
      const input = { name: junkValue(), theme: pick(['neon', 'lava', 'x', 5]), difficulty: pick(['easy', 'hard', 'x']), segments };
      const { course } = validateCourse(input);
      const parsed = Course.safeParse(course);
      expect(parsed.success).toBe(true);
    }
  });
});
