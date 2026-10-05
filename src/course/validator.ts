/**
 * Turns anything — hand-written JSON, AI output, a corrupted share code —
 * into a valid, playable Course. It repairs rather than rejects, records each
 * repair, and never throws.
 */
import {
  Course,
  DIFFICULTIES,
  LIMITS,
  RAMP_SIDES,
  THEMES,
  type Difficulty,
  type RampSegment,
  type RampSide,
  type Segment,
  type ThemeName,
} from './schema.js';
import { cleanName as cleanPublicName } from '../util/text.js';
import { START_SPEED, afterBooster, afterFall, afterRamp, maxGapLength, type SpeedRange } from './tuning.js';

export interface ValidationResult {
  course: Course;
  /** Human-readable notes on every repair made. Empty when the input was already valid. */
  repairs: string[];
}

/** Used when a course has no name, or one other players shouldn't see. */
export const DEFAULT_NAME = 'Untitled Course';
const DEFAULT_RAMP: Omit<RampSegment, 'side'> = { type: 'ramp', length: 4000, angle: 60, curve: 0 };

type Range = { readonly min: number; readonly max: number };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.trim().toLowerCase();
  return options.find((o) => o === lower);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

class Repairer {
  readonly repairs: string[] = [];

  note(msg: string): void {
    this.repairs.push(msg);
  }

  /** Coerce to a finite number within range, noting any change. */
  number(value: unknown, range: Range, fallback: number, label: string): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isFinite(n)) {
      this.note(`${label}: ${JSON.stringify(value) ?? String(value)} is not a number, used ${fallback}`);
      return fallback;
    }
    const clamped = round(Math.min(range.max, Math.max(range.min, n)));
    if (clamped !== n) this.note(`${label}: ${n} clamped to ${clamped}`);
    return clamped;
  }
}

function cleanName(value: unknown, r: Repairer): string {
  if (typeof value !== 'string') {
    r.note('name: missing, used a default');
    return DEFAULT_NAME;
  }
  // Names are shown to other players (share codes, rooms), so they get the same checks as player names:
  // no hidden text, links or blocked words.
  const cleaned = cleanPublicName(value, LIMITS.name.max, DEFAULT_NAME);
  if (cleaned === DEFAULT_NAME && value !== DEFAULT_NAME) {
    r.note('name: empty or not suitable, used a default');
    return DEFAULT_NAME;
  }
  if (cleaned !== value) r.note('name: cleaned up');
  return cleaned;
}

function sanitizeSegment(raw: unknown, index: number, lastSide: RampSide | null, r: Repairer): Segment | null {
  const label = `segment ${index + 1}`;
  if (!isRecord(raw)) {
    r.note(`${label}: not an object, removed`);
    return null;
  }
  const type = oneOf(raw.type, ['ramp', 'drop', 'gap', 'booster', 'checkpoint'] as const);
  switch (type) {
    case 'ramp': {
      let side = oneOf(raw.side, RAMP_SIDES);
      if (!side) {
        side = lastSide === 'right' ? 'left' : 'right';
        r.note(`${label}: unknown ramp side ${JSON.stringify(raw.side)}, used ${side}`);
      }
      return {
        type: 'ramp',
        length: r.number(raw.length, LIMITS.rampLength, DEFAULT_RAMP.length, `${label} length`),
        angle: r.number(raw.angle, LIMITS.rampAngle, DEFAULT_RAMP.angle, `${label} angle`),
        side,
        curve: raw.curve === undefined || raw.curve === null ? 0 : r.number(raw.curve, LIMITS.rampCurve, 0, `${label} curve`),
      };
    }
    case 'drop':
      return { type: 'drop', height: r.number(raw.height, LIMITS.dropHeight, 800, `${label} drop height`) };
    case 'gap':
      return { type: 'gap', length: r.number(raw.length, LIMITS.gapLength, 600, `${label} gap length`) };
    case 'booster':
      return { type: 'booster', strength: r.number(raw.strength, LIMITS.boosterStrength, 300, `${label} booster strength`) };
    case 'checkpoint':
      return { type: 'checkpoint' };
    default:
      r.note(`${label}: unknown type ${JSON.stringify(raw.type) ?? String(raw.type)}, removed`);
      return null;
  }
}

/** Merge back-to-back drops and gaps, and tidy up checkpoints. */
function fixStructure(segments: Segment[], r: Repairer): Segment[] {
  const out: Segment[] = [];
  let seenRamp = false;
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (seg.type === 'drop' && prev?.type === 'drop') {
      prev.height = Math.min(LIMITS.dropHeight.max, prev.height + seg.height);
      r.note('two drops in a row merged into one');
      continue;
    }
    if (seg.type === 'gap' && prev?.type === 'gap') {
      prev.length = Math.min(LIMITS.gapLength.max, prev.length + seg.length);
      r.note('two gaps in a row merged into one');
      continue;
    }
    if (seg.type === 'checkpoint') {
      if (!seenRamp) {
        r.note('checkpoint before the first ramp removed');
        continue;
      }
      if (prev?.type === 'checkpoint') {
        r.note('back-to-back checkpoint removed');
        continue;
      }
    }
    if (seg.type === 'ramp') seenRamp = true;
    out.push({ ...seg });
  }
  // A trailing checkpoint is pointless: the finish comes right after.
  while (out[out.length - 1]?.type === 'checkpoint') {
    out.pop();
    r.note('checkpoint at the very end removed');
  }
  return out;
}

function rampCount(segments: Segment[]): number {
  return segments.filter((s) => s.type === 'ramp').length;
}

function lastRampSide(segments: Segment[]): RampSide | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]!;
    if (s.type === 'ramp') return s.side;
  }
  return null;
}

function newRamp(segments: Segment[]): RampSegment {
  return { ...DEFAULT_RAMP, side: lastRampSide(segments) === 'right' ? 'left' : 'right' };
}

function totalLength(segments: Segment[]): number {
  let sum = 0;
  for (const s of segments) {
    if (s.type === 'ramp' || s.type === 'gap') sum += s.length;
    else if (s.type === 'drop') sum += s.height;
  }
  return sum;
}

function ensureMinRamps(segments: Segment[], r: Repairer): void {
  while (rampCount(segments) < LIMITS.minRamps) {
    segments.push(newRamp(segments));
    r.note('added a ramp: a course needs at least two');
  }
}

function fitTotalLength(segments: Segment[], r: Repairer): void {
  // Too long: drop segments from the end (keeping the minimum ramps).
  while (totalLength(segments) > LIMITS.totalLength.max && segments.length > 0) {
    const last = segments[segments.length - 1]!;
    if (last.type === 'ramp' && rampCount(segments) <= LIMITS.minRamps) {
      last.length = Math.max(LIMITS.rampLength.min, last.length - (totalLength(segments) - LIMITS.totalLength.max));
      break;
    }
    segments.pop();
    r.note('course too long: trimmed segments from the end');
  }
  // Too short: stretch existing ramps, then add more if they're maxed out.
  for (const s of segments) {
    const shortfall = LIMITS.totalLength.min - totalLength(segments);
    if (shortfall <= 0) return;
    if (s.type === 'ramp' && s.length < LIMITS.rampLength.max) {
      const grow = Math.min(shortfall, LIMITS.rampLength.max - s.length);
      s.length = round(s.length + grow);
      r.note('course too short: lengthened a ramp');
    }
  }
  while (totalLength(segments) < LIMITS.totalLength.min && segments.length < LIMITS.segments.max) {
    segments.push(newRamp(segments));
    r.note('course too short: added a ramp');
  }
}

function limitHeadingDrift(segments: Segment[], r: Repairer): void {
  let heading = 0;
  for (const s of segments) {
    if (s.type !== 'ramp') continue;
    const next = Math.min(LIMITS.maxHeadingDrift, Math.max(-LIMITS.maxHeadingDrift, heading + s.curve));
    if (next !== heading + s.curve) {
      s.curve = round(next - heading);
      r.note('ramp curve reduced so the course does not loop back on itself');
    }
    heading = next;
  }
}

/** Walk the course with the speed model and shorten gaps a cautious rider couldn't clear. */
function limitGaps(segments: Segment[], difficulty: Difficulty, r: Repairer): void {
  let speed: SpeedRange = { ...START_SPEED };
  for (const s of segments) {
    switch (s.type) {
      case 'ramp':
        speed = afterRamp(speed, s.length, difficulty);
        break;
      case 'drop':
        speed = afterFall(speed, s.height);
        break;
      case 'booster':
        speed = afterBooster(speed, s.strength);
        break;
      case 'checkpoint':
        break; // fly-through gate: no effect on speed
      case 'gap': {
        const max = Math.max(LIMITS.gapLength.min, Math.floor(maxGapLength(speed)));
        if (s.length > max) {
          r.note(`gap of ${s.length} shortened to ${max}: riders here are too slow to clear it`);
          s.length = max;
        }
        break;
      }
    }
  }
}

function fallbackCourse(): Course {
  return {
    name: DEFAULT_NAME,
    theme: 'neon',
    difficulty: 'medium',
    segments: [
      { ...DEFAULT_RAMP, side: 'right' },
      { ...DEFAULT_RAMP, side: 'left' },
    ],
  };
}

export function validateCourse(input: unknown): ValidationResult {
  const r = new Repairer();
  try {
    if (!isRecord(input)) r.note('course is not an object; started from scratch');
    const obj = isRecord(input) ? input : {};

    const name = cleanName(obj.name, r);
    let theme: ThemeName | undefined = oneOf(obj.theme, THEMES);
    if (!theme) {
      r.note(`theme ${JSON.stringify(obj.theme) ?? 'missing'} unknown, used neon`);
      theme = 'neon';
    }
    let difficulty: Difficulty | undefined = oneOf(obj.difficulty, DIFFICULTIES);
    if (!difficulty) {
      r.note(`difficulty ${JSON.stringify(obj.difficulty) ?? 'missing'} unknown, used medium`);
      difficulty = 'medium';
    }

    let raw: unknown[] = [];
    if (Array.isArray(obj.segments)) raw = obj.segments;
    else r.note('segments missing or not a list');
    if (raw.length > LIMITS.segments.max * 2) raw = raw.slice(0, LIMITS.segments.max * 2); // bound the work

    const sanitized: Segment[] = [];
    raw.forEach((s, i) => {
      const seg = sanitizeSegment(s, i, lastRampSide(sanitized), r);
      if (seg) sanitized.push(seg);
    });

    let segments = fixStructure(sanitized, r);
    if (segments.length > LIMITS.segments.max) {
      segments = segments.slice(0, LIMITS.segments.max);
      r.note(`more than ${LIMITS.segments.max} segments: extras removed`);
      segments = fixStructure(segments, r);
    }
    ensureMinRamps(segments, r);
    limitHeadingDrift(segments, r);
    fitTotalLength(segments, r);
    ensureMinRamps(segments, r);
    limitGaps(segments, difficulty, r);

    const course: Course = { name, theme, difficulty, segments };
    const parsed = Course.safeParse(course);
    if (parsed.success) return { course: parsed.data, repairs: r.repairs };
    r.note('course still invalid after repair; used the fallback course');
  } catch (err) {
    r.note(`unexpected error while validating: ${String(err)}`);
  }
  return { course: fallbackCourse(), repairs: r.repairs };
}
