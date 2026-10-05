/**
 * How a room refers to its course: a shipped course id, a random seed, or a
 * full spec (AI/shared courses). Every client builds the same geometry from it.
 */
import type { CourseRef } from '../net/protocol.js';
import { findCourse } from './courses/index.js';
import { randomCourse } from './random.js';

export function resolveCourseRef(ref: CourseRef): unknown {
  switch (ref.kind) {
    case 'shipped':
      return findCourse(ref.id)?.spec ?? null;
    case 'random':
      return randomCourse(ref.seed);
    case 'spec':
      return ref.spec;
  }
}

export function sameCourseRef(a: CourseRef, b: CourseRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
