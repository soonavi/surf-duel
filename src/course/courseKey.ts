import type { Course } from './schema.js';
import { DEFAULT_PHYSICS } from '../physics/constants.js';
import { hashString } from '../util/rng.js';

/**
 * Bump when the layout or builder changes what geometry a spec produces.
 * Old personal bests and ghosts then stop matching instead of replaying a
 * ghost through walls that have moved.
 */
export const LAYOUT_VERSION = 6;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fingerprint of everything that decides how a course plays: the validated
 * spec, the layout version and the default physics. Records and ghosts are
 * stored under it.
 */
export function courseKey(course: Course): string {
  const hash = hashString(`${LAYOUT_VERSION}|${stableStringify(course)}|${stableStringify(DEFAULT_PHYSICS)}`);
  return `c${LAYOUT_VERSION}-${hash.toString(36)}`;
}
