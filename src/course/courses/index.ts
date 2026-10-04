import tutorial from './tutorial.json';
import easyCruise from './easy-cruise.json';
import speedDemon from './speed-demon.json';

export interface ShippedCourse {
  id: string;
  /** Raw JSON; always goes through the validator before use. */
  spec: unknown;
  blurb: string;
}

export const SHIPPED_COURSES: readonly ShippedCourse[] = [
  { id: 'tutorial', spec: tutorial, blurb: 'Learn to surf in under two minutes.' },
  { id: 'easy-cruise', spec: easyCruise, blurb: 'Wide, gentle ramps through the dunes.' },
  { id: 'speed-demon', spec: speedDemon, blurb: 'Steep ramps, huge drops, no mercy.' },
];

export function findCourse(id: string): ShippedCourse | undefined {
  return SHIPPED_COURSES.find((c) => c.id === id);
}
