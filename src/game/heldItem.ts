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
 * Offsets from where the item rests in the corner of the view: position in
 * view space (x right, y up, z toward you; roughly metres), rotation in
 * radians about those axes, and squash (0 none; 0.3 squeezed flat; negative stretches).
 */
export interface ItemPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  squash: number;
}

export const REST: Readonly<ItemPose> = Object.freeze({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, squash: 0 });
const CHANNELS = Object.keys(REST) as (keyof ItemPose)[];
const ANGLES: ReadonlySet<keyof ItemPose> = new Set(['rx', 'ry', 'rz']);

/** A key: at `t` seconds, these channels (any left out are at rest). */
type Key = { t: number } & Partial<ItemPose>;

export interface Clip {
  duration: number;
  keys: readonly Key[];
  /** The item turns in your hand (a spin, a twirl): the glove keeps still instead of turning with it. */
  inHand: boolean;
}

const TURN = 2 * Math.PI;

/** Builds a clip; its first key is rest at 0 and its last is rest (or whole turns) at `duration`. */
function clip(keys: Key[], inHand = false): Clip {
  return { duration: keys[keys.length - 1]!.t, keys: [{ t: 0 }, ...keys], inHand };
}

// Held up and toward the middle, where you can see it.
const SHOWN = { x: -0.09, y: 0.05, z: 0.07 } as const;

export const CLIPS: Readonly<Record<ClipName, Clip>> = {
  // Knife inspect: turn the blade's flat to you, admire it, flip it over.
  show: clip([
    { t: 0.35, ...SHOWN, ry: 1.25, rz: 0.35 },
    { t: 1.15, ...SHOWN, y: 0.06, ry: 1.45, rz: 0.2, rx: 0.15 },
    { t: 1.5, x: -0.06, y: 0.04, z: 0.04, ry: -0.45, rz: -0.3 },
    { t: 1.9, x: -0.02, y: 0.01, ry: -0.2 },
    { t: 2.2 },
  ]),
  // Karambit: two spins round the finger ring.
  spin: clip([
    { t: 0.25, x: -0.05, y: 0.04, z: 0.04, rz: 0.3 },
    { t: 0.8, x: -0.05, y: 0.04, z: 0.04, rz: 0.3 + TURN },
    { t: 1.35, x: -0.05, y: 0.04, z: 0.04, rz: 0.3 + 2 * TURN },
    { t: 1.8, rz: 2 * TURN },
  ], true),
  // Butterfly knife: tossed up, twirled twice, caught.
  flip: clip([
    { t: 0.25, x: -0.05, y: 0.03, z: 0.03 },
    { t: 0.7, x: -0.05, y: 0.1, z: 0.03, ry: TURN, rx: 0.3 },
    { t: 1.15, x: -0.05, y: 0.04, z: 0.03, ry: 2 * TURN },
    { t: 1.6, x: -0.03, y: 0.02, z: 0.02, ry: 2 * TURN, rz: 0.2 },
    { t: 2, ry: 2 * TURN },
  ], true),
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
    { t: 0.35, x: -0.12, y: 0.06, z: 0.12, ry: -0.5 },
    { t: 0.6, x: -0.12, y: 0.06, z: 0.13, ry: -0.5, squash: 0.18 },
    { t: 0.8, x: -0.12, y: 0.06, z: 0.12, ry: -0.5 },
    { t: 1.0, x: -0.12, y: 0.06, z: 0.13, ry: -0.5, squash: 0.18 },
    { t: 1.2, x: -0.12, y: 0.06, z: 0.12, ry: -0.5, rz: 0.25 },
    { t: 1.45, x: -0.12, y: 0.06, z: 0.12, ry: -0.5, rz: -0.25 },
    { t: 1.7, x: -0.06, y: 0.03, z: 0.06, ry: -0.25 },
    { t: 2 },
  ]),
  // A poke forward that squishes.
  boop: clip([
    { t: 0.1, y: 0.02, z: -0.08, squash: -0.08 },
    { t: 0.2, y: 0.02, z: -0.1, squash: 0.25 },
    { t: 0.5 },
  ]),
  // Squeezed flat, springs back.
  squeeze: clip([
    { t: 0.08, y: -0.01, squash: 0.35 },
    { t: 0.25, squash: -0.08 },
    { t: 0.4 },
  ]),
  // Held up and turned all the way round.
  look: clip([
    { t: 0.3, x: -0.1, y: 0.05, z: 0.08 },
    { t: 1.4, x: -0.1, y: 0.05, z: 0.08, ry: TURN },
    { t: 1.8, ry: TURN },
  ], true),
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

const smoother = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** The pose `t` seconds into a clip: eased from key to key, at rest outside it. */
export function clipPose(c: Clip, t: number): ItemPose {
  const keys = c.keys;
  if (t <= 0 || t >= c.duration) {
    const end = t >= c.duration ? keys[keys.length - 1]! : keys[0]!;
    return keyPose(end);
  }
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1]!.t) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const w = smoother((t - a.t) / (b.t - a.t));
  const out = { ...REST };
  for (const k of CHANNELS) out[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * w;
  return out;
}

function keyPose(k: Key): ItemPose {
  const out = { ...REST };
  for (const c of CHANNELS) out[c] = k[c] ?? 0;
  return out;
}

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
/** Leaning with the strafe key, and floating up a touch in the air. */
const STRAFE_TILT = 0.06;
const AIR_LIFT = 0.008;
const SETTLE_RATE = 6;
/** A clip cut short blends into the next over this long. */
const BLEND_SECONDS = 0.12;
/** How quickly the glove lets go of (or takes back) an item that spins in it. */
const FOLLOW_RATE = 25;

export type MotionKind = 'inspect' | 'use';

/** The item's motion from frame to frame: clips, plus sway and bob. */
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
  private follow = 1;

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

  /**
   * How much the glove turns with the item (0–1): not at all while the item
   * spins in your hand. Turn it by this times the pose's rotation *wrapped*
   * to ±π, so a spin's whole turns never show up on the glove.
   */
  get handFollow(): number {
    return this.follow;
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
    const followTarget = this.clip?.clip.inHand ? 0 : 1;
    this.follow += (followTarget - this.follow) * (1 - Math.exp(-dt * FOLLOW_RATE));
    if (input.reducedMotion) {
      this.swayX = this.swayY = this.tilt = this.lift = this.bobAmp = 0;
      return pose;
    }

    // Lag behind the view: turn left and the item swings right; look up and it dips.
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

    pose.x += this.swayX + Math.cos(this.bobPhase / 2) * this.bobAmp * 0.5;
    pose.y += this.swayY + this.lift + Math.sin(this.bobPhase) * this.bobAmp;
    pose.rz += this.tilt + this.swayX * 1.5;
    pose.rx += this.swayY * 1.5;
    return pose;
  }
}
