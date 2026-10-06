import tutorial from './tutorial.json' with { type: 'json' };
import easyCruise from './easy-cruise.json' with { type: 'json' };
import speedDemon from './speed-demon.json' with { type: 'json' };
import frostbiteFlow from './frostbite-flow.json' with { type: 'json' };
import eventHorizon from './event-horizon.json' with { type: 'json' };
import spire from './spire.json' with { type: 'json' };

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
  { id: 'speed-demon', spec: speedDemon, blurb: 'Zig-zag transfers over lava, and walls to thread at full speed.' },
  { id: 'event-horizon', spec: eventHorizon, blurb: 'Two-sided ridges, long falls and tight windows over the void.' },
  { id: 'spire', spec: spire, blurb: 'Surf a full circle round the tower, thread the walls, keep your speed.' },
];

export function findCourse(id: string): ShippedCourse | undefined {
  return SHIPPED_COURSES.find((c) => c.id === id);
}
