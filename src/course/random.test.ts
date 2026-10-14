import { describe, expect, it } from 'vitest';
import { Course, DIFFICULTIES, type Difficulty, type Segment } from './schema.js';
import { designRandomCourse, randomCourse } from './random.js';
import { validateCourse } from './validator.js';

/** What a course is made of: counts of each piece, flares and S-bends counted apart from plain ramps. */
function kinds(course: Course): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string) => out.set(k, (out.get(k) ?? 0) + 1);
  for (const s of course.segments) {
    add(s.type);
    if (s.type === 'ramp' && s.flare) add('flare');
    if (s.type === 'ramp' && s.swerve) add('swerve');
    if (s.type === 'ramp' && s.pitch !== undefined && s.pitch !== null && s.pitch <= 0) add('level or climb');
  }
  return out;
}

const count = (segments: Segment[], type: Segment['type']) => segments.filter((s) => s.type === type).length;

describe('randomCourse', () => {
  it('is deterministic per seed', () => {
    expect(designRandomCourse(42)).toEqual(designRandomCourse(42));
    expect(designRandomCourse(42)).not.toEqual(designRandomCourse(43));
    expect(randomCourse(42, { difficulty: 'medium' })).toEqual(randomCourse(42, { difficulty: 'medium' }));
  });

  it('always designs a valid course that needs no further repair', () => {
    for (let seed = 0; seed < 200; seed++) {
      const course = designRandomCourse(seed);
      expect(Course.safeParse(course).success).toBe(true);
      expect(validateCourse(course).repairs).toEqual([]);
    }
  });

  it('honours a requested difficulty and theme', () => {
    const course = randomCourse(7, { difficulty: 'hard', theme: 'ice' });
    expect(course.difficulty).toBe('hard');
    expect(course.theme).toBe('ice');
  });
});

describe('randomCourse, built like a staged surf map (Oct 14 2026)', () => {
  // User: "do more research into surf maps, and increase the complexity of the map generation overall".
  it('runs in stages, a checkpoint between each, about as long as an AI course', () => {
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 1; seed <= 6; seed++) {
        const course = designRandomCourse(seed, { difficulty });
        const sections = count(course.segments, 'ramp') + count(course.segments, 'spiral');
        expect(sections, `${difficulty} ${seed}`).toBeGreaterThanOrEqual(10);
        expect(count(course.segments, 'checkpoint'), `${difficulty} ${seed}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('uses the pieces real surf maps do: flares, S-bends, walls, drops and gaps everywhere, spirals from medium, climbs on hard and expert', () => {
    const seen = (difficulty: Difficulty): Map<string, number> => {
      const total = new Map<string, number>();
      for (let seed = 1; seed <= 12; seed++) for (const [k, v] of kinds(designRandomCourse(seed, { difficulty }))) total.set(k, (total.get(k) ?? 0) + v);
      return total;
    };
    for (const difficulty of DIFFICULTIES) {
      const k = seen(difficulty);
      for (const piece of ['flare', 'swerve', 'wall', 'drop', 'gap']) expect(k.get(piece) ?? 0, `${difficulty} ${piece}`).toBeGreaterThan(0);
      if (difficulty !== 'easy') expect(k.get('spiral') ?? 0, `${difficulty} spiral`).toBeGreaterThan(0);
      if (difficulty === 'hard' || difficulty === 'expert') expect(k.get('level or climb') ?? 0, `${difficulty} climbs`).toBeGreaterThan(0);
    }
  });

  it('sometimes wears its own colours', () => {
    const coloured = Array.from({ length: 20 }, (_, seed) => designRandomCourse(seed)).filter((c) => c.colors).length;
    expect(coloured).toBeGreaterThan(2);
    expect(coloured).toBeLessThan(18);
  });
});
