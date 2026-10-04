import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SnapshotBuffer, type Snapshot } from './interpolation';

const snap = (t: number, x: number, vx = 0, yaw = 0): Snapshot => ({ t, x, y: 0, z: 0, vx, vy: 0, vz: 0, yaw });

describe('SnapshotBuffer', () => {
  const out = new Vector3();

  it('reports nothing until it has a snapshot', () => {
    expect(new SnapshotBuffer().sample(0, out).ok).toBe(false);
  });

  it('hits snapshots exactly and interpolates between them', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0, 1000));
    b.push(snap(100, 100, 1000));
    b.sample(0, out);
    expect(out.x).toBeCloseTo(0, 9);
    b.sample(50, out);
    expect(out.x).toBeCloseTo(50, 6); // constant velocity → straight line
    b.sample(100, out);
    expect(out.x).toBeCloseTo(100, 9);
  });

  it('follows the curve implied by velocities (smoother than straight lines)', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0, 0));
    b.push(snap(1000, 1000, 2000)); // accelerating
    b.sample(500, out);
    expect(out.x).toBeLessThan(500);
    expect(out.x).toBeGreaterThan(0);
  });

  it('turns yaw the short way round', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0, 0, 3.1));
    b.push(snap(100, 0, 0, -3.1));
    const { yaw } = b.sample(50, out);
    expect(Math.abs(Math.cos(yaw) + 1)).toBeLessThan(0.01); // ≈ ±π
  });

  it('accepts snapshots out of order and ignores duplicates', () => {
    const b = new SnapshotBuffer();
    b.push(snap(100, 100, 1000));
    b.push(snap(0, 0, 1000));
    b.push(snap(100, 999, 1000));
    b.sample(50, out);
    expect(out.x).toBeCloseTo(50, 6);
  });

  it('extrapolates briefly past the newest snapshot, then holds', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0, 1000));
    const ext = b.sample(100, out);
    expect(ext.extrapolated).toBe(true);
    expect(out.x).toBeCloseTo(100, 6);
    b.sample(10_000, out);
    expect(out.x).toBeLessThanOrEqual(1000 * 0.3 + 1e-6); // capped
  });

  it('snaps across a respawn instead of sliding through the world', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0, 100));
    b.push(snap(50, 9000, 0));
    b.sample(20, out);
    expect([0, 9000].some((x) => Math.abs(out.x - x) < 5)).toBe(true);
  });

  it('holds the oldest snapshot before the start', () => {
    const b = new SnapshotBuffer();
    b.push(snap(500, 42));
    b.sample(0, out);
    expect(out.x).toBe(42);
  });
});
