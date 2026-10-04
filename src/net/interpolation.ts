/**
 * Remote player playback. Snapshots are stamped with the sender's race time
 * (ms since the shared GO), so the receiver can replay them on its own race
 * clock, a little in the past. Between snapshots we use a cubic Hermite curve
 * built from positions *and* velocities, which stays smooth even when a big
 * room sends samples in sparse batches. Past the newest snapshot we
 * extrapolate briefly, then hold.
 */
import type { Vector3 } from 'three';

export interface Snapshot {
  /** Sender race time, ms. */
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
}

export interface SampleResult {
  ok: boolean;
  yaw: number;
  extrapolated: boolean;
}

const MAX_SNAPSHOTS = 256;
/** Never guess more than this far ahead of the newest snapshot. */
const MAX_EXTRAPOLATION_MS = 300;
/** Slack beyond velocity-predicted travel before a jump counts as a teleport (respawn). */
const TELEPORT_SLACK = 200;

function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

export class SnapshotBuffer {
  private readonly snaps: Snapshot[] = [];

  get newestTime(): number | null {
    return this.snaps.length ? this.snaps[this.snaps.length - 1]!.t : null;
  }

  clear(): void {
    this.snaps.length = 0;
  }

  push(s: Snapshot): void {
    // Insert in time order (batches usually arrive in order, so scan from the end).
    let i = this.snaps.length;
    while (i > 0 && this.snaps[i - 1]!.t > s.t) i--;
    if (i > 0 && this.snaps[i - 1]!.t === s.t) return; // duplicate
    this.snaps.splice(i, 0, s);
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.shift();
  }

  /** Position at sender race time `t` (ms) into `out`. */
  sample(t: number, out: Vector3): SampleResult {
    const n = this.snaps.length;
    if (n === 0) return { ok: false, yaw: 0, extrapolated: false };
    const first = this.snaps[0]!;
    if (t <= first.t) {
      out.set(first.x, first.y, first.z);
      return { ok: true, yaw: first.yaw, extrapolated: false };
    }
    const last = this.snaps[n - 1]!;
    if (t >= last.t) {
      const dt = Math.min(t - last.t, MAX_EXTRAPOLATION_MS) / 1000;
      out.set(last.x + last.vx * dt, last.y + last.vy * dt, last.z + last.vz * dt);
      return { ok: true, yaw: last.yaw, extrapolated: t > last.t };
    }

    let i = n - 2;
    while (i > 0 && this.snaps[i]!.t > t) i--;
    const a = this.snaps[i]!;
    const b = this.snaps[i + 1]!;
    const span = (b.t - a.t) / 1000;
    const s = (t - a.t) / (b.t - a.t);

    const jump = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const fastest = Math.max(Math.hypot(a.vx, a.vy, a.vz), Math.hypot(b.vx, b.vy, b.vz));
    if (jump > fastest * span * 2 + TELEPORT_SLACK) {
      const near = s < 0.5 ? a : b;
      out.set(near.x, near.y, near.z);
      return { ok: true, yaw: near.yaw, extrapolated: false };
    }

    // Cubic Hermite basis.
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    out.set(
      h00 * a.x + h10 * span * a.vx + h01 * b.x + h11 * span * b.vx,
      h00 * a.y + h10 * span * a.vy + h01 * b.y + h11 * span * b.vy,
      h00 * a.z + h10 * span * a.vz + h01 * b.z + h11 * span * b.vz,
    );
    return { ok: true, yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * s, extrapolated: false };
  }
}
