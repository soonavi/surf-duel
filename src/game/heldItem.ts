/**
 * What you hold in your hand while you surf (user, Oct 11 2026: "add some
 * knives like counterstrike and also some creative things like a stuffed
 * animal"), and how it moves: a little sway behind the mouse, a gentle bob,
 * an inspect (F) and a use (click). Purely cosmetic: physics never sees it.
 *
 * Kept pure so it's tested; `render/viewmodel.ts` draws the result.
 */

export type ItemKind = 'none' | 'knife' | 'plush' | 'toy' | 'food';
export type ClipName = 'show' | 'spin' | 'flip' | 'slash' | 'stab' | 'hug' | 'boop' | 'squeeze' | 'look' | 'lick' | 'bonk';
export type ItemSound = 'swish' | 'squeak' | 'squish';

export interface HeldItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** Clips for F (inspect) and a click (use). */
  inspect: ClipName;
  use: ClipName;
  /** What a click sounds like, if anything. */
  sound: ItemSound | null;
}

export const HELD_ITEMS = [
  { id: 'none', name: 'Nothing', kind: 'none', inspect: 'look', use: 'look', sound: null },
  { id: 'karambit', name: 'Karambit', kind: 'knife', inspect: 'spin', use: 'slash', sound: 'swish' },
  { id: 'butterfly', name: 'Butterfly knife', kind: 'knife', inspect: 'flip', use: 'slash', sound: 'swish' },
  { id: 'bayonet', name: 'Bayonet', kind: 'knife', inspect: 'show', use: 'stab', sound: 'swish' },
  { id: 'bowie', name: 'Bowie knife', kind: 'knife', inspect: 'show', use: 'slash', sound: 'swish' },
  { id: 'teddy', name: 'Teddy bear', kind: 'plush', inspect: 'hug', use: 'boop', sound: 'squish' },
  { id: 'shark', name: 'Shark plush', kind: 'plush', inspect: 'hug', use: 'boop', sound: 'squish' },
  { id: 'duck', name: 'Rubber duck', kind: 'toy', inspect: 'look', use: 'squeeze', sound: 'squeak' },
  { id: 'icecream', name: 'Ice cream', kind: 'food', inspect: 'look', use: 'lick', sound: null },
  { id: 'baguette', name: 'Baguette', kind: 'food', inspect: 'look', use: 'bonk', sound: 'swish' },
] as const satisfies readonly HeldItemDef[];

export type HeldItemId = (typeof HELD_ITEMS)[number]['id'];

/** CS surfers ride with their knife out. */
export const DEFAULT_HELD_ITEM: HeldItemId = 'karambit';

const BY_ID = new Map<string, HeldItemDef>(HELD_ITEMS.map((i) => [i.id, i]));

export function heldItem(id: HeldItemId): HeldItemDef {
  return BY_ID.get(id)!;
}

/** A stored or received item id, or the default for anything unknown (an item removed in a later version). */
export function parseHeldItem(value: unknown): HeldItemId {
  return typeof value === 'string' && BY_ID.has(value) ? (value as HeldItemId) : DEFAULT_HELD_ITEM;
}

// ---------------------------------------------------------------------------
// Poses and clips

/**
 * Offsets from where the hand rests in the corner of the view.
 * - The wrist: position in view space (x right, y up, z toward you; roughly
 *   metres) and rotation in radians about those axes. Hand and item move together.
 * - In the hand: `spin` turns the item round its pivot (a karambit round your
 *   finger), `flip` works a butterfly knife's handles (0 open, π shut, 2π open
 *   again), and `squash` squeezes it (0.3 flat; negative stretches).
 * - `open`: the fingers (0 gripping, 1 open; negative squeezes tighter).
 */
export interface ItemPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  spin: number;
  flip: number;
  squash: number;
  open: number;
}

export const REST: Readonly<ItemPose> = Object.freeze({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, spin: 0, flip: 0, squash: 0, open: 0 });
const CHANNELS = Object.keys(REST) as (keyof ItemPose)[];
/** Channels that are angles: whole turns of these count as rest. */
const ANGLES: ReadonlySet<keyof ItemPose> = new Set(['rx', 'ry', 'rz', 'spin', 'flip']);

/** A key: at `t` seconds, these channels. A channel a key leaves out isn't keyed there: it flows on through. */
type Key = { t: number } & Partial<ItemPose>;

/** One channel's keys: times and values, from rest at 0 to its end value at the clip's end. */
interface Track {
  t: number[];
  v: number[];
}

export interface Clip {
  duration: number;
  tracks: Partial<Record<keyof ItemPose, Track>>;
}

const TURN = 2 * Math.PI;

/**
 * Builds a clip from keys; the last key is its end. Every channel starts at
 * rest and ends at rest, or (spin, flip) whole turns from it.
 */
function clip(keys: Key[]): Clip {
  const last = keys[keys.length - 1]!;
  const duration = last.t;
  const tracks: Partial<Record<keyof ItemPose, Track>> = {};
  for (const ch of CHANNELS) {
    const track: Track = { t: [0], v: [0] };
    for (const k of keys) {
      const v = k[ch];
      if (v !== undefined && k.t < duration) {
        track.t.push(k.t);
        track.v.push(v);
      }
    }
    track.t.push(duration);
    track.v.push(last[ch] ?? 0);
    if (track.v.some((v) => v !== 0)) tracks[ch] = track;
  }
  return { duration, tracks };
}

export const CLIPS: Readonly<Record<ClipName, Clip>> = {
  // Knife inspect: brought up with the flat to you, admired, then the wrist rolls to show the other side.
  show: clip([
    { t: 0.4, x: -0.07, y: 0.05, z: 0.03, rx: 0.15, ry: -0.35, rz: 0.5, open: 0.08 },
    { t: 1.1, x: -0.08, y: 0.055, z: 0.035, rx: 0.2, ry: -0.5, rz: 0.45 },
    { t: 1.5, x: -0.06, y: 0.045, z: 0.03, rx: 0.05, ry: 1.3, rz: 0.35 },
    { t: 2.0, x: -0.05, y: 0.04, z: 0.025, rx: 0, ry: 1.45, rz: 0.3, open: 0.08 },
    { t: 2.6 },
  ]),
  // Karambit: the hand opens, the knife spins twice round your finger in its ring, you catch it and admire it.
  spin: clip([
    { t: 0.3, x: -0.05, y: 0.03, z: 0.02, rx: 0.1, rz: 0.35, spin: 0, open: 0.6 },
    { t: 0.8, y: 0.045, rz: 0.55 },
    { t: 1.2, open: 0.6 },
    { t: 1.3, y: 0.025, rz: 0.3, spin: 2 * TURN },
    { t: 1.45, open: 0 },
    { t: 1.85, x: -0.06, y: 0.04, z: 0.025, rx: 0.15, ry: -0.6, rz: 0.4 },
    { t: 2.4, spin: 2 * TURN },
  ]),
  // Butterfly knife: flipped shut and open twice, the wrist rocking with each flip, then shown off.
  flip: clip([
    { t: 0.25, x: -0.05, y: 0.035, z: 0.02, rz: 0.2, flip: 0, open: 0.45 },
    { t: 0.55, rz: -0.15 },
    { t: 0.85, rz: 0.3, flip: TURN },
    { t: 1.2, rz: -0.15 },
    { t: 1.45, open: 0.45 },
    { t: 1.5, rz: 0.25, flip: 2 * TURN },
    { t: 1.65, open: 0 },
    { t: 1.95, x: -0.06, y: 0.04, z: 0.025, ry: -0.5, rz: 0.35 },
    { t: 2.4, flip: 2 * TURN },
  ]),
  // Wind up to the right, swipe down to the left.
  slash: clip([
    { t: 0.08, x: 0.05, y: 0.06, z: 0.02, rz: -0.5, rx: 0.3 },
    { t: 0.2, x: -0.16, y: -0.06, z: -0.06, rz: 0.9, rx: -0.4 },
    { t: 0.45 },
  ]),
  // Pull back, thrust forward.
  stab: clip([
    { t: 0.08, y: -0.01, z: 0.06, rx: 0.25 },
    { t: 0.2, x: -0.04, y: 0.03, z: -0.16, rx: -0.35 },
    { t: 0.5 },
  ]),
  // Plush inspect: a close hug (two squeezes), a wiggle.
  hug: clip([
    { t: 0.35, x: -0.12, y: 0.06, z: 0.12, ry: -0.5, open: 0 },
    { t: 0.6, z: 0.13, squash: 0.18, open: -0.3 },
    { t: 0.8, z: 0.12, squash: 0, open: 0 },
    { t: 1.0, z: 0.13, squash: 0.18, open: -0.3 },
    { t: 1.2, z: 0.12, squash: 0, rz: 0.25, open: 0 },
    { t: 1.45, rz: -0.25 },
    { t: 1.7, x: -0.06, y: 0.03, z: 0.06, ry: -0.25, rz: 0 },
    { t: 2 },
  ]),
  // A poke forward that squishes.
  boop: clip([
    { t: 0.1, y: 0.02, z: -0.08, squash: -0.08 },
    { t: 0.2, y: 0.02, z: -0.1, squash: 0.25, open: -0.2 },
    { t: 0.5 },
  ]),
  // Squeezed flat, springs back.
  squeeze: clip([
    { t: 0.08, y: -0.01, squash: 0.35, open: -0.35 },
    { t: 0.25, y: 0, squash: -0.08, open: 0 },
    { t: 0.4 },
  ]),
  // Held up, and the wrist turns it one way and the other.
  look: clip([
    { t: 0.35, x: -0.09, y: 0.05, z: 0.08, ry: 0 },
    { t: 0.95, rx: 0.1, ry: -1.1 },
    { t: 1.6, rx: -0.05, ry: 0.9 },
    { t: 2.2 },
  ]),
  // Up to your mouth.
  lick: clip([
    { t: 0.2, x: -0.14, y: 0.1, z: 0.25, rx: 0.3 },
    { t: 0.35, x: -0.14, y: 0.11, z: 0.27, rx: 0.25 },
    { t: 0.7 },
  ]),
  // Raised, brought down.
  bonk: clip([
    { t: 0.1, y: 0.05, z: 0.04, rx: 0.6 },
    { t: 0.22, y: -0.05, z: -0.1, rx: -0.9 },
    { t: 0.5 },
  ]),
};

/**
 * A channel's value at `t`: a smooth curve through its keys (cubic Hermite).
 * It flows through keys in a run, comes to rest at a key where it turns back
 * or holds (so it never overshoots), and starts and ends at rest.
 */
function trackValue(track: Track, t: number): number {
  const { t: times, v } = track;
  const n = times.length;
  if (t <= times[0]!) return v[0]!;
  if (t >= times[n - 1]!) return v[n - 1]!;
  let i = 0;
  while (i < n - 2 && t > times[i + 1]!) i++;
  const slope = (k: number): number => {
    if (k === 0 || k === n - 1) return 0;
    if ((v[k]! - v[k - 1]!) * (v[k + 1]! - v[k]!) <= 0) return 0;
    return (v[k + 1]! - v[k - 1]!) / (times[k + 1]! - times[k - 1]!);
  };
  const h = times[i + 1]! - times[i]!;
  const u = (t - times[i]!) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v[i]! + (u3 - 2 * u2 + u) * h * slope(i) + (-2 * u3 + 3 * u2) * v[i + 1]! + (u3 - u2) * h * slope(i + 1);
}

/** The pose `t` seconds into a clip (rest before it, its end pose after). */
export function clipPose(c: Clip, t: number): ItemPose {
  const out = { ...REST };
  for (const ch of CHANNELS) {
    const track = c.tracks[ch];
    if (track) out[ch] = trackValue(track, t);
  }
  return out;
}

const smoother = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** An angle as the equivalent one in [−π, π). */
function wrap(a: number): number {
  return a - TURN * Math.floor((a + Math.PI) / TURN);
}

// ---------------------------------------------------------------------------
// Live motion

export interface MotionInput {
  /** How far the view turned this frame (radians; positive is left, like yaw). */
  yawDelta: number;
  /** How far the view pitched this frame (radians; positive is up). */
  pitchDelta: number;
  /** Horizontal speed, u/s. */
  speed: number;
  /** Strafe key held: −1 A, 0, +1 D. */
  side: number;
  /** In the air (not on a ramp or the ground). */
  airborne: boolean;
  reducedMotion: boolean;
}

/** The most the item swings behind the view when you turn (view-space units). */
export const MAX_SWAY = 0.035;
/** Sway per rad/s of turning, and how quickly it follows. */
const SWAY_GAIN = 0.006;
const SWAY_RATE = 10;
/** Bob at full speed, and how fast it cycles. */
const BOB_AMPLITUDE = 0.004;
const BOB_HZ = 1.1;
const TOP_SPEED = 3500;
/** Breathing, even standing still: a slow rise and fall, the fingers easing with it. */
const BREATH_AMPLITUDE = 0.0015;
const BREATH_HZ = 0.25;
/** Leaning with the strafe key, and floating up a touch in the air. */
const STRAFE_TILT = 0.06;
const AIR_LIFT = 0.008;
const SETTLE_RATE = 6;
/** A clip cut short blends into the next over this long. */
const BLEND_SECONDS = 0.12;

export type MotionKind = 'inspect' | 'use';

/** The hand's motion from frame to frame: clips, plus sway, bob and breathing. */
export class HeldItemMotion {
  private item: HeldItemDef;
  private clip: { kind: MotionKind; clip: Clip; t: number } | null = null;
  private blend: { from: ItemPose; t: number } | null = null;
  private last: ItemPose = { ...REST };
  private swayX = 0;
  private swayY = 0;
  private tilt = 0;
  private lift = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private breathPhase = 0;

  constructor(id: HeldItemId) {
    this.item = heldItem(id);
  }

  get id(): HeldItemId {
    return this.item.id as HeldItemId;
  }

  /** Which clip is playing, if any. */
  get playing(): MotionKind | null {
    return this.clip?.kind ?? null;
  }

  setItem(id: HeldItemId): void {
    this.item = heldItem(id);
    this.clip = null;
    this.blend = null;
    this.last = { ...REST };
  }

  /**
   * Start a clip. A use always (re)starts, cutting anything short; an inspect
   * only starts when nothing's playing. False if nothing started.
   */
  trigger(kind: MotionKind): boolean {
    if (this.item.kind === 'none') return false;
    if (kind === 'inspect' && this.clip) return false;
    if (this.clip) {
      // Ease out of where the cut-short clip had got to (whole turns dropped).
      const from = { ...this.last };
      for (const k of ANGLES) from[k] = wrap(from[k]);
      this.blend = { from, t: 0 };
    }
    this.clip = { kind, clip: CLIPS[kind === 'inspect' ? this.item.inspect : this.item.use], t: 0 };
    return true;
  }

  update(dt: number, input: MotionInput): ItemPose {
    let pose: ItemPose = { ...REST };
    if (this.clip) {
      this.clip.t += dt;
      if (this.clip.t >= this.clip.clip.duration) this.clip = null;
      else pose = clipPose(this.clip.clip, this.clip.t);
    }
    if (this.blend) {
      this.blend.t += dt;
      const w = smoother(this.blend.t / BLEND_SECONDS);
      if (w >= 1) this.blend = null;
      else for (const k of CHANNELS) pose[k] = this.blend.from[k] + (pose[k] - this.blend.from[k]) * w;
    }
    this.last = { ...pose };
    if (input.reducedMotion) {
      this.swayX = this.swayY = this.tilt = this.lift = this.bobAmp = 0;
      return pose;
    }

    // Lag behind the view: turn left and the hand swings right; look up and it dips.
    const follow = 1 - Math.exp(-dt * SWAY_RATE);
    const yawRate = dt > 0 ? input.yawDelta / dt : 0;
    const pitchRate = dt > 0 ? input.pitchDelta / dt : 0;
    const clampSway = (v: number): number => Math.max(-MAX_SWAY, Math.min(MAX_SWAY, v));
    this.swayX += (clampSway(yawRate * SWAY_GAIN) - this.swayX) * follow;
    this.swayY += (clampSway(-pitchRate * SWAY_GAIN) - this.swayY) * follow;

    const settle = 1 - Math.exp(-dt * SETTLE_RATE);
    this.tilt += (-Math.sign(input.side) * STRAFE_TILT - this.tilt) * settle;
    this.lift += ((input.airborne ? AIR_LIFT : 0) - this.lift) * settle;
    this.bobAmp += (BOB_AMPLITUDE * Math.min(1, input.speed / TOP_SPEED) - this.bobAmp) * settle;
    this.bobPhase = (this.bobPhase + dt * BOB_HZ * TURN) % TURN;
    this.breathPhase = (this.breathPhase + dt * BREATH_HZ * TURN) % TURN;
    const breath = Math.sin(this.breathPhase);

    pose.x += this.swayX + Math.cos(this.bobPhase / 2) * this.bobAmp * 0.5;
    pose.y += this.swayY + this.lift + Math.sin(this.bobPhase) * this.bobAmp + breath * BREATH_AMPLITUDE;
    pose.rz += this.tilt + this.swayX * 1.5;
    pose.rx += this.swayY * 1.5 + breath * BREATH_AMPLITUDE * 2;
    pose.open += breath * 0.008;
    return pose;
  }
}
