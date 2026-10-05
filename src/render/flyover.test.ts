import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildCourse } from '../course/builder.js';
import { SHIPPED_COURSES, findCourse } from '../course/courses/index.js';
import { randomCourse } from '../course/random.js';
import type { TrackPath } from '../course/path.js';
import { FADE_SECONDS, flyoverDuration, flyoverFade, flyoverPose } from './flyover.js';

const built = buildCourse(findCourse('easy-cruise')!.spec);
const path = built.path;

describe('flyover camera', () => {
  it('takes a watchable amount of time to cover the course', () => {
    const d = flyoverDuration(path);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThanOrEqual(14);
  });

  it('flies above the riding line, looking ahead along it', () => {
    const pos = new Vector3();
    const target = new Vector3();
    const d = flyoverDuration(path);
    for (let t = 0; t < d; t += 0.25) {
      flyoverPose(path, t, pos, target);
      const s = (t / d) * path.length;
      const here = new Vector3();
      path.pointAt(s, here);
      expect(pos.y).toBeGreaterThan(here.y + 200);
      expect(pos.distanceTo(target)).toBeGreaterThan(500);
      expect(Number.isFinite(pos.x + pos.y + pos.z + target.x + target.y + target.z)).toBe(true);
    }
  });

  it('loops back to the start', () => {
    const a = new Vector3();
    const b = new Vector3();
    const scratch = new Vector3();
    flyoverPose(path, 0.5, a, scratch);
    flyoverPose(path, 0.5 + flyoverDuration(path), b, scratch);
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });
});

/** Worst camera motion over one loop at 60 fps (leaving out the fade at the loop seam). */
function motion(p: TrackPath) {
  const d = flyoverDuration(p);
  const dt = 1 / 60;
  const pos: Vector3[] = [];
  const yaw: number[] = [];
  const pitch: number[] = [];
  for (let t = FADE_SECONDS; t < d - FADE_SECONDS; t += dt) {
    const a = new Vector3();
    const b = new Vector3();
    flyoverPose(p, t, a, b);
    pos.push(a);
    yaw.push(Math.atan2(b.x - a.x, b.z - a.z));
    pitch.push(Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)));
  }
  const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
  const deg = 180 / Math.PI;
  let glide = 0;
  let accel = 0;
  let turnRate = 0;
  let turnAccel = 0;
  let pitchRate = 0;
  for (let i = 2; i < pos.length; i++) {
    const v1 = pos[i - 1]!.clone().sub(pos[i - 2]!).divideScalar(dt);
    const v2 = pos[i]!.clone().sub(pos[i - 1]!).divideScalar(dt);
    glide = Math.max(glide, Math.abs(v2.y) / Math.max(1, Math.hypot(v2.x, v2.z)));
    accel = Math.max(accel, v2.clone().sub(v1).length() / dt);
    const r1 = wrap(yaw[i - 1]! - yaw[i - 2]!) / dt;
    const r2 = wrap(yaw[i]! - yaw[i - 1]!) / dt;
    turnRate = Math.max(turnRate, Math.abs(r2) * deg);
    turnAccel = Math.max(turnAccel, (Math.abs(r2 - r1) / dt) * deg);
    pitchRate = Math.max(pitchRate, (Math.abs(pitch[i]! - pitch[i - 1]!) / dt) * deg);
  }
  return { glide, accel, turnRate, turnAccel, pitchRate };
}

describe('flyover camera: smooth from ramp to ramp', () => {
  const courses = [
    ...SHIPPED_COURSES.map((c) => ({ id: c.id, spec: c.spec as unknown })),
    { id: 'random 7', spec: randomCourse(7) },
    { id: 'random 99', spec: randomCourse(99) },
  ];

  for (const { id, spec } of courses) {
    it(`glides over drops and between ramp faces on ${id}`, () => {
      const m = motion(buildCourse(spec).path);
      expect(m.glide, 'steepest glide (vertical / horizontal speed)').toBeLessThan(0.6);
      expect(m.accel, 'acceleration (u/s²)').toBeLessThan(6000);
      expect(m.turnRate, 'turn rate (°/s)').toBeLessThan(45);
      expect(m.turnAccel, 'turn acceleration (°/s²)').toBeLessThan(200);
      expect(m.pitchRate, 'pitch rate (°/s)').toBeLessThan(30);
    });
  }

  it('never dips below the riding line before a drop', () => {
    const p = buildCourse(findCourse('speed-demon')!.spec).path;
    const d = flyoverDuration(p);
    const pos = new Vector3();
    const target = new Vector3();
    const here = new Vector3();
    for (let t = 0; t < d; t += 1 / 30) {
      flyoverPose(p, t, pos, target);
      p.pointAt((t / d) * p.length, here);
      expect(pos.y).toBeGreaterThan(here.y + 300);
    }
  });
});

describe('flyoverFade', () => {
  it('is clear mid-loop and fades through dark at the loop seam', () => {
    const d = flyoverDuration(path);
    expect(flyoverFade(path, d / 2)).toBe(0);
    expect(flyoverFade(path, 0)).toBeCloseTo(1);
    expect(flyoverFade(path, d - 1e-6)).toBeGreaterThan(0.95);
    expect(flyoverFade(path, d + FADE_SECONDS)).toBeLessThan(1e-6);
    // It ramps rather than flicks.
    expect(flyoverFade(path, FADE_SECONDS / 2)).toBeGreaterThan(0.1);
    expect(flyoverFade(path, FADE_SECONDS / 2)).toBeLessThan(0.9);
  });
});
