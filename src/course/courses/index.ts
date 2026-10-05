import tutorial from './tutorial.json' with { type: 'json' };
import easyCruise from './easy-cruise.json' with { type: 'json' };
import speedDemon from './speed-demon.json' with { type: 'json' };
import frostbiteFlow from './frostbite-flow.json' with { type: 'json' };
import eventHorizon from './event-horizon.json' with { type: 'json' };

export interface ShippedCourse {
  id: string;
  /** Raw JSON; always goes through the validator before use. */
  spec: unknown;
  blurb: string;
}

export const SHIPPED_COURSES: readonly ShippedCourse[] = [
  { id: 'tutorial', spec: tutorial, blurb: 'Learn to surf in two minutes, with an on-screen coach.' },
  { id: 'easy-cruise', spec: easyCruise, blurb: 'Wide, gentle ramps through the dunes.' },
  { id: 'frostbite-flow', spec: frostbiteFlow, blurb: 'Sweeping S-bends down a frozen canyon.' },
  { id: 'speed-demon', spec: speedDemon, blurb: 'Steep ramps, huge drops, no mercy.' },
  { id: 'event-horizon', spec: eventHorizon, blurb: 'Big gaps and two-sided ridges over the void.' },
];

export function findCourse(id: string): ShippedCourse | undefined {
  return SHIPPED_COURSES.find((c) => c.id === id);
}
