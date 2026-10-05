import { describe, expect, it } from 'vitest';
import { MAX_ROLL, SPEED_FOV_EXTRA, approachRoll, speedFov, speedLines } from './feel.js';

describe('speedFov', () => {
  it('widens the view slightly with speed, and never by more than the cap', () => {
    expect(speedFov(75, 0)).toBe(75);
    expect(speedFov(75, 1500)).toBeGreaterThan(75);
    expect(speedFov(75, 3000)).toBeGreaterThan(speedFov(75, 1500));
    expect(speedFov(75, 20_000)).toBeCloseTo(75 + SPEED_FOV_EXTRA);
  });

  it('stays put at walking speeds', () => {
    expect(speedFov(90, 300)).toBe(90);
  });
});

describe('approachRoll', () => {
  it('leans toward the strafe key, gently', () => {
    let roll = 0;
    for (let i = 0; i < 120; i++) roll = approachRoll(roll, 1, 1 / 60);
    expect(roll).toBeLessThan(0); // D (strafe right): the view tips right
    expect(Math.abs(roll)).toBeCloseTo(MAX_ROLL, 2);
    expect(Math.abs(approachRoll(0, 1, 1 / 60))).toBeLessThan(MAX_ROLL / 3); // eases in, no snap
  });

  it('levels out again with no strafe key', () => {
    let roll = -MAX_ROLL;
    for (let i = 0; i < 120; i++) roll = approachRoll(roll, 0, 1 / 60);
    expect(Math.abs(roll)).toBeLessThan(1e-3);
  });

  it('is subtle: under two degrees', () => {
    expect(MAX_ROLL).toBeLessThan((2 * Math.PI) / 180);
  });
});

describe('speedLines', () => {
  it('appears only at high speed', () => {
    expect(speedLines(1000)).toBe(0);
    expect(speedLines(2600)).toBeGreaterThan(0);
    expect(speedLines(5000)).toBe(1);
  });
});
