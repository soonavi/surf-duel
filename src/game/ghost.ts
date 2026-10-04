/**
 * Ghost runs: position + yaw sampled at 20 Hz, stored compactly.
 *
 * Wire format (then base64url): version, rate, sample count, then per sample
 * and per channel — x, y, z (whole units, ~2 cm) and yaw (16-bit fraction of
 * a turn) — the zigzag varint of the error against a constant-velocity
 * prediction. Smooth surfing predicts well, so most values fit in one byte: a
 * minute of fast riding is ~5 KB, small enough for localStorage and the
 * leaderboard database.
 */
import type { Vector3 } from 'three';

export const GHOST_RATE = 20;
const TICKS_PER_SAMPLE = 100 / GHOST_RATE;
const FORMAT_VERSION = 1;
/** At most 30 minutes of recording. */
const MAX_SAMPLES = GHOST_RATE * 60 * 30;
const YAW_STEPS = 65536;
/** Consecutive samples further apart than this were a respawn: snap, don't slide. */
const TELEPORT_DISTANCE = 600;

export interface GhostSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface GhostData {
  rate: number;
  samples: GhostSample[];
}

/** Collects a sample every 5 ticks, starting at the go tick (tick 0). */
export class GhostRecorder {
  private readonly samples: GhostSample[] = [];

  tick(tick: number, pos: Vector3, yaw: number): void {
    if (tick % TICKS_PER_SAMPLE !== 0 || this.samples.length >= MAX_SAMPLES) return;
    this.samples.push({ x: pos.x, y: pos.y, z: pos.z, yaw });
  }

  data(): GhostData {
    return { rate: GHOST_RATE, samples: this.samples.slice() };
  }
}

// --- encoding ---------------------------------------------------------------

function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

const zigzag = (n: number): number => (n >= 0 ? 2 * n : -2 * n - 1);
const unzigzag = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function pushVarint(out: number[], n: number): void {
  while (n >= 128) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function quantizeYaw(yaw: number): number {
  return Math.round(((wrapAngle(yaw) + Math.PI) / (2 * Math.PI)) * YAW_STEPS) % YAW_STEPS;
}

/** Wrap an integer into (-YAW_STEPS/2, YAW_STEPS/2]. */
function wrapSteps(n: number): number {
  const m = ((n % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  return m > YAW_STEPS / 2 ? m - YAW_STEPS : m;
}

/** Channel 3 (yaw) lives on a circle; the others are plain integers. */
const IS_ANGLE = [false, false, false, true] as const;

export function encodeGhost(g: GhostData): string {
  const bytes: number[] = [FORMAT_VERSION, g.rate];
  pushVarint(bytes, g.samples.length);
  const prev = [0, 0, 0, 0];
  const prev2 = [0, 0, 0, 0];
  for (const s of g.samples) {
    const q = [Math.round(s.x), Math.round(s.y), Math.round(s.z), quantizeYaw(s.yaw)];
    for (let c = 0; c < 4; c++) {
      const predicted = 2 * prev[c]! - prev2[c]!;
      const residual = IS_ANGLE[c] ? wrapSteps(q[c]! - predicted) : q[c]! - predicted;
      pushVarint(bytes, zigzag(residual));
      prev2[c] = prev[c]!;
      prev[c] = q[c]!;
    }
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parse a ghost string; returns null for anything malformed (never throws). */
export function decodeGhost(s: string): GhostData | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
    const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    let i = 0;
    const byte = (): number => {
      if (i >= binary.length) throw new Error('truncated');
      return binary.charCodeAt(i++);
    };
    const varint = (): number => {
      let n = 0;
      let scale = 1;
      for (let k = 0; k < 8; k++) {
        const b = byte();
        n += (b % 128) * scale;
        if (b < 128) return n;
        scale *= 128;
      }
      throw new Error('varint too long');
    };

    if (byte() !== FORMAT_VERSION) return null;
    const rate = byte();
    if (rate < 1 || rate > 120) return null;
    const count = varint();
    if (count > MAX_SAMPLES) return null;

    const samples: GhostSample[] = [];
    const prev = [0, 0, 0, 0];
    const prev2 = [0, 0, 0, 0];
    for (let k = 0; k < count; k++) {
      const q = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        const predicted = 2 * prev[c]! - prev2[c]!;
        const value = predicted + unzigzag(varint());
        q[c] = IS_ANGLE[c] ? ((value % YAW_STEPS) + YAW_STEPS) % YAW_STEPS : value;
        prev2[c] = prev[c]!;
        prev[c] = q[c]!;
      }
      samples.push({ x: q[0]!, y: q[1]!, z: q[2]!, yaw: (q[3]! / YAW_STEPS) * 2 * Math.PI - Math.PI });
    }
    if (i !== binary.length) return null; // trailing junk
    return { rate, samples };
  } catch {
    return null;
  }
}

// --- playback ----------------------------------------------------------------

/**
 * Ghost position at `t` seconds after the go signal, written into `out`.
 * Returns the yaw. Holds the first/last pose outside the recording.
 */
export function sampleGhost(g: GhostData, t: number, out: Vector3): number {
  const n = g.samples.length;
  if (n === 0) {
    out.set(0, 0, 0);
    return 0;
  }
  const f = t * g.rate;
  if (f <= 0 || n === 1) {
    const s = g.samples[0]!;
    out.set(s.x, s.y, s.z);
    return s.yaw;
  }
  if (f >= n - 1) {
    const s = g.samples[n - 1]!;
    out.set(s.x, s.y, s.z);
    return s.yaw;
  }
  const i = Math.floor(f);
  const k = f - i;
  const a = g.samples[i]!;
  const b = g.samples[i + 1]!;
  const jump = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2;
  if (jump > TELEPORT_DISTANCE * TELEPORT_DISTANCE) {
    const s = k < 0.5 ? a : b;
    out.set(s.x, s.y, s.z);
    return s.yaw;
  }
  out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
  return a.yaw + wrapAngle(b.yaw - a.yaw) * k;
}
