import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { buildCourse } from '../course/builder.js';
import { findCourse } from '../course/courses/index.js';
import { COVER_HEIGHT, COVER_WIDTH, coverShot } from './cover.js';

const built = buildCourse(findCourse('speed-demon')!.spec);

describe('coverShot', () => {
  const shot = coverShot(built);

  it('is the same shot every time (the cover is reproducible)', () => {
    const again = coverShot(built);
    expect(again.rider.distanceTo(shot.rider)).toBe(0);
    expect(again.camera.distanceTo(shot.camera)).toBe(0);
  });

  it('catches the rider mid-surf, fast, with a trail behind', () => {
    expect(shot.surfing).toBe(true);
    expect(shot.speed).toBeGreaterThan(1800);
    expect(shot.trail.length).toBeGreaterThan(5);
    expect(shot.trail[shot.trail.length - 1]!.distanceTo(shot.rider)).toBeLessThan(120);
  });

  it('frames the rider in view, near the camera but not on top of it', () => {
    const cam = new PerspectiveCamera(shot.fov, COVER_WIDTH / COVER_HEIGHT, 4, 100_000);
    cam.position.copy(shot.camera);
    cam.lookAt(shot.target);
    cam.updateMatrixWorld();
    const ndc = shot.rider.clone().project(cam);
    expect(Math.abs(ndc.x)).toBeLessThan(0.8);
    expect(Math.abs(ndc.y)).toBeLessThan(0.8);
    expect(ndc.z).toBeLessThan(1);
    const d = shot.camera.distanceTo(shot.rider);
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(1200);
  });

  it('looks along the course, not back up it', () => {
    const view = shot.target.clone().sub(shot.camera).setY(0).normalize();
    const travel = new Vector3(Math.sin(-shot.riderYaw), 0, -Math.cos(shot.riderYaw));
    expect(view.dot(travel)).toBeGreaterThan(0.3);
  });
});
