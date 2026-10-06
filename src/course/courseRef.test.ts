import { describe, expect, it } from 'vitest';
import { CourseRef } from '../net/protocol.js';
import { resolveCourseRef } from './courseRef.js';
import { randomCourse } from './random.js';

describe('resolveCourseRef: random courses', () => {
  it('rebuilds a random course picked at a difficulty exactly as its host made it', () => {
    const ref = CourseRef.parse({ kind: 'random', seed: 5, difficulty: 'expert' });
    expect(resolveCourseRef(ref)).toEqual(randomCourse(5, { difficulty: 'expert' }));
  });

  it('still rebuilds a plain seed (any difficulty) the same way', () => {
    expect(resolveCourseRef(CourseRef.parse({ kind: 'random', seed: 5 }))).toEqual(randomCourse(5));
  });

  it("drops a random course whose difficulty isn't one of ours", () => {
    expect(CourseRef.safeParse({ kind: 'random', seed: 5, difficulty: 'nightmare' }).success).toBe(false);
  });
});
