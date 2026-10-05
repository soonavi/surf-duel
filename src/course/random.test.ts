import { describe, expect, it } from 'vitest';
import { Course } from './schema.js';
import { randomCourse } from './random.js';
import { validateCourse } from './validator.js';

describe('randomCourse', () => {
  it('is deterministic per seed', () => {
    expect(randomCourse(42)).toEqual(randomCourse(42));
    expect(randomCourse(42)).not.toEqual(randomCourse(43));
  });

  it('always produces a valid course that needs no further repair', () => {
    for (let seed = 0; seed < 200; seed++) {
      const course = randomCourse(seed);
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
