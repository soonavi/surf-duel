/**
 * Riding a course before it's served. The layout's guarantees are proven
 * (playability.test.ts) for shipped and random courses, but the AI can combine
 * pieces at the far ends of every range, walls and spirals included, and some
 * of those combinations can't be finished. `ensureBeatable` rides a course
 * with the bots its difficulty is built for, from the start and from every
 * checkpoint; if they can't finish cleanly, it simplifies the course step by
 * step (tamer values, then no walls, then no spiral) until they can.
 *
 * A course takes ~1 s to check, so this runs once per AI course on the server,
 * never in validateCourse (which runs everywhere, all the time).
 */
import { buildCourse } from './builder.js';
import type { BotStyle } from './bot.js';
import { DIFFICULTY_STYLE, type Course, type Difficulty, type Segment } from './schema.js';
import { simulateRun } from './simulate.js';
import { needsAirStrafe } from './tuning.js';
import { validateCourse } from './validator.js';

export type NamedStyle = BotStyle & { name: string };

/** Never air-strafes: only holds into the ramp. Easy and medium are built for it. */
export const CAUTIOUS: readonly NamedStyle[] = [
  { name: 'cautious', hop: false, airStrafe: false },
  { name: 'aggressive', hop: true, airStrafe: false },
];
/** Air-strafes across transfers, like a player. Hard and expert are built for it. */
export const SKILLED: readonly NamedStyle[] = [
  { name: 'skilled', hop: false, airStrafe: true },
  { name: 'skilled hopper', hop: true, airStrafe: true },
];

/** The bots a course of this difficulty must be finishable by. The first one also restarts from every checkpoint. */
export const stylesFor = (difficulty: Difficulty): readonly NamedStyle[] => (needsAirStrafe(difficulty) ? SKILLED : CAUTIOUS);

/**
 * Every way the bots for this course fail to finish cleanly, from the start and from each
 * checkpoint (empty: beatable). With `longestRide`, a first run slower than that fails too.
 */
export function failuresOn(spec: unknown, label: string, maxSeconds = 180, stopAtFirst = false, longestRide = Infinity): string[] {
  const built = buildCourse(spec);
  const styles = stylesFor(built.course.difficulty);
  const failures: string[] = [];
  for (const style of styles) {
    const r = simulateRun(built, style, maxSeconds);
    if (!r.finished || r.deaths > 0) failures.push(`${label} ${style.name}: finished=${r.finished} deaths=${r.deaths}`);
    else if (style === styles[0] && r.time > longestRide) failures.push(`${label} ${style.name}: took ${Math.round(r.time)} s`);
    if (stopAtFirst && failures.length > 0) return failures;
  }
  for (let cp = 1; cp < built.checkpoints.length; cp++) {
    const r = simulateRun(built, styles[0]!, maxSeconds, cp);
    if (!r.finished || r.deaths > 0) failures.push(`${label} from cp ${cp}: finished=${r.finished} deaths=${r.deaths}`);
    if (stopAtFirst && failures.length > 0) return failures;
  }
  return failures;
}

/** Longest a check rides before calling a course unfinishable. */
const CHECK_SECONDS = 180;
/**
 * Courses should take about a minute (user, Oct 6 2026). Level ramps and climbs with too few
 * boosters can leave riders crawling for two and a half; past this, the course is simplified.
 */
export const LONGEST_RIDE_SECONDS = 120;

const beatable = (course: Course): boolean => failuresOn(course, course.name, CHECK_SECONDS, true, LONGEST_RIDE_SECONDS).length === 0;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The course with every value inside the ranges the random courses use, which
 * the playability tests prove beatable: the difficulty's ramp lengths, angles
 * and bends, the usual slopes, and modest gaps, drops and boosters. Walls and
 * spirals stay.
 */
export function tameCourse(course: Course): Course {
  const style = DIFFICULTY_STYLE[course.difficulty];
  const segments = course.segments.map((s): Segment => {
    switch (s.type) {
      case 'ramp': {
        const { pitch: _pitch, ...rest } = s;
        return {
          ...rest,
          length: clamp(s.length, style.length[0], style.length[1]),
          angle: clamp(s.angle, style.angle[0], style.angle[1]),
          curve: clamp(s.curve, -style.maxCurve, style.maxCurve),
        };
      }
      case 'spiral':
        return { ...s, angle: clamp(s.angle, style.angle[0], style.angle[1]) };
      case 'gap':
        return { ...s, length: Math.min(s.length, 900) };
      case 'drop':
        return { ...s, height: Math.min(s.height, 1500) };
      case 'booster':
        return { ...s, strength: Math.min(s.strength, 500) };
      default:
        return s;
    }
  });
  return { ...course, segments };
}

/**
 * Smaller drops and boosters. Long courses full of big drops reach the speed
 * cap, where even a skilled rider can't air-strafe across to a ramp set off
 * to the side.
 */
export function reinInSpeed(course: Course): Course {
  const segments = course.segments.map((s): Segment =>
    s.type === 'drop' ? { ...s, height: Math.min(s.height, 800) } : s.type === 'booster' ? { ...s, strength: Math.min(s.strength, 300) } : s,
  );
  return { ...course, segments };
}

const without = (type: 'wall' | 'spiral') => (course: Course): Course => ({ ...course, segments: course.segments.filter((s) => s.type !== type) });

/** Each step builds on the one before. */
const STAGES: readonly { change: string; apply: (course: Course) => Course }[] = [
  { change: "values tamed to the difficulty's usual ranges", apply: tameCourse },
  { change: 'speed reined in', apply: reinInSpeed },
];

/**
 * The spiral moved to just after the first ramp. Riding round a tower takes
 * holding a tight turn, which a rider who doesn't air-strafe can't do much
 * above ~2,500 u/s: late in a long downhill course they slide off its outside.
 */
export function spiralEarly(course: Course): Course {
  const at = course.segments.findIndex((s) => s.type === 'spiral');
  const firstRamp = course.segments.findIndex((s) => s.type === 'ramp');
  if (at < 0 || firstRamp < 0 || at <= firstRamp + 1) return course;
  const segments = [...course.segments];
  const [spiral] = segments.splice(at, 1);
  segments.splice(firstRamp + 1, 0, spiral!);
  return { ...course, segments };
}

/** Then, alternatives on the last step: the pieces players asked for (walls, a spiral) go only if they must. */
const REMOVALS: readonly { change: string; apply: (course: Course) => Course }[] = [
  { change: 'walls removed', apply: without('wall') },
  { change: 'spiral moved to the start', apply: spiralEarly },
  { change: 'walls removed, spiral moved to the start', apply: (c) => spiralEarly(without('wall')(c)) },
  { change: 'spiral removed', apply: without('spiral') },
  { change: 'walls and spiral removed', apply: (c) => without('spiral')(without('wall')(c)) },
];

export interface EnsureResult {
  course: Course;
  /** What was simplified, in order; empty when the course was fine as it was. */
  changes: string[];
  /** False only if even the simplest version couldn't be finished. */
  beatable: boolean;
}

/** The course (already validated), simplified only as far as its bots need to finish it cleanly. */
export function ensureBeatable(course: Course): EnsureResult {
  if (beatable(course)) return { course, changes: [], beatable: true };
  const same = (a: Course, b: Course): boolean => JSON.stringify(a) === JSON.stringify(b);
  let current = course;
  const changes: string[] = [];
  for (const stage of STAGES) {
    const next = validateCourse(stage.apply(current)).course;
    if (same(next, current)) continue; // nothing to simplify at this stage
    current = next;
    changes.push(stage.change);
    if (beatable(current)) return { course: current, changes, beatable: true };
  }
  let last = { course: current, changes };
  for (const removal of REMOVALS) {
    const next = validateCourse(removal.apply(current)).course;
    if (same(next, current) || same(next, last.course)) continue; // nothing of that kind to remove
    last = { course: next, changes: [...changes, removal.change] };
    if (beatable(next)) return { ...last, beatable: true };
  }
  return { ...last, beatable: false };
}
