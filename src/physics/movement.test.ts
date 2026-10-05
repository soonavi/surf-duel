import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DEFAULT_PHYSICS } from './constants.js';
import { accelerate, applyFriction, clipVelocity, clipVelocityToPlanes, wishFromInput } from './movement.js';

const DT = 0.01;

describe('accelerate', () => {
  it('adds accel × dt × wishSpeed along the wish direction', () => {
    const v = new Vector3();
    accelerate(v, new Vector3(1, 0, 0), 260, 10, DT);
    expect(v.x).toBeCloseTo(26);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('never pushes speed along the wish direction past wishSpeed', () => {
    const v = new Vector3(250, 0, 0);
    accelerate(v, new Vector3(1, 0, 0), 260, 10, DT);
    expect(v.x).toBeCloseTo(260);
    accelerate(v, new Vector3(1, 0, 0), 260, 10, DT);
    expect(v.x).toBeCloseTo(260);
  });

  it('with a speed cap (air), adds at most cap − current along the wish direction', () => {
    const v = new Vector3(0, 0, -500);
    accelerate(v, new Vector3(1, 0, 0), 260, 150, DT, 30);
    expect(v.x).toBeCloseTo(30);
    expect(v.z).toBeCloseTo(-500);
  });
});

describe('applyFriction', () => {
  it('scales speed down by max(speed, stopSpeed) × friction × dt', () => {
    const v = new Vector3(200, 0, 0);
    applyFriction(v, DEFAULT_PHYSICS, DT);
    expect(v.x).toBeCloseTo(200 - 200 * 4 * DT);
  });

  it('uses stopSpeed as the floor so slow movement stops quickly', () => {
    const v = new Vector3(3, 0, 0);
    applyFriction(v, DEFAULT_PHYSICS, DT);
    expect(v.x).toBe(0);
  });

  it('leaves a stationary player alone', () => {
    const v = new Vector3();
    applyFriction(v, DEFAULT_PHYSICS, DT);
    expect(v.length()).toBe(0);
  });
});

describe('clipVelocity', () => {
  it('removes the component into the plane and keeps the tangent part', () => {
    const n = new Vector3(-Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 0); // 60° ramp face
    const v = new Vector3(300, -400, -800);
    const tangentBefore = v.clone().sub(n.clone().multiplyScalar(v.dot(n)));
    clipVelocity(v, n);
    expect(v.dot(n)).toBeCloseTo(0, 9);
    expect(v.distanceTo(tangentBefore)).toBeLessThan(1e-9);
  });
});

describe('clipVelocityToPlanes', () => {
  it('slides along the crease when wedged between two planes', () => {
    const a = new Vector3(1, 1, 0).normalize();
    const b = new Vector3(-1, 1, 0).normalize();
    const v = new Vector3(0, -300, -500);
    clipVelocityToPlanes(v, [a, b], 2);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-500);
  });

  it('stops dead in a three-plane corner', () => {
    const planes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    const v = new Vector3(-100, -100, -100);
    clipVelocityToPlanes(v, planes, 3);
    expect(v.length()).toBeCloseTo(0);
  });

  it('only clips against one plane when that is enough', () => {
    const v = new Vector3(100, -50, 0);
    clipVelocityToPlanes(v, [new Vector3(0, 1, 0), new Vector3(1, 0, 0)], 2);
    // Clipping against the floor leaves +x motion, which already moves away from the wall.
    expect(v.x).toBeCloseTo(100);
    expect(v.y).toBeCloseTo(0);
  });
});

describe('wishFromInput', () => {
  it('maps W at yaw 0 to -Z at full ground speed', () => {
    const dir = new Vector3();
    const speed = wishFromInput(0, 1, 0, 260, dir);
    expect(speed).toBe(260);
    expect(dir.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-9);
  });

  it('normalises diagonals so W+D is not faster', () => {
    const dir = new Vector3();
    const speed = wishFromInput(0, 1, 1, 260, dir);
    expect(speed).toBe(260);
    expect(dir.length()).toBeCloseTo(1);
    expect(dir.x).toBeGreaterThan(0);
    expect(dir.z).toBeLessThan(0);
  });

  it('returns zero speed with no input', () => {
    const dir = new Vector3();
    expect(wishFromInput(1.2, 0, 0, 260, dir)).toBe(0);
  });
});
