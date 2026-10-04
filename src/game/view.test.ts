import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { PITCH_LIMIT, applyMouseLook, flatForward, flatRight, lookDirection, wrapAngle } from './view';

describe('view angles', () => {
  it('turns right when the mouse moves right', () => {
    const next = applyMouseLook({ yaw: 0, pitch: 0 }, 100, 0, 2, false);
    expect(next.yaw).toBeLessThan(0);
  });

  it('looks up when the mouse moves up, and inverts on request', () => {
    expect(applyMouseLook({ yaw: 0, pitch: 0 }, 0, -100, 2, false).pitch).toBeGreaterThan(0);
    expect(applyMouseLook({ yaw: 0, pitch: 0 }, 0, -100, 2, true).pitch).toBeLessThan(0);
  });

  it('clamps pitch short of straight up/down', () => {
    expect(applyMouseLook({ yaw: 0, pitch: 0 }, 0, -1e6, 2, false).pitch).toBe(PITCH_LIMIT);
    expect(applyMouseLook({ yaw: 0, pitch: 0 }, 0, 1e6, 2, false).pitch).toBe(-PITCH_LIMIT);
  });

  it('wraps yaw into [-π, π)', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it('matches the camera: yaw 0 looks down -Z with +X to the right', () => {
    expect(flatForward(0).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-12);
    expect(flatRight(0).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12);
  });

  it('agrees with a three.js YXZ camera rotation', () => {
    const angles = { yaw: 0.7, pitch: -0.3 };
    const fromCamera = new Vector3(0, 0, -1).applyEuler(new Euler(angles.pitch, angles.yaw, 0, 'YXZ'));
    const ours = lookDirection(angles);
    expect(ours.distanceTo(fromCamera)).toBeLessThan(1e-9);
  });
});
