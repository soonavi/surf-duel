import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildCourse, type Trigger } from './builder.js';
import { CourseRuntime, applyBoost, triggerContains } from './runtime.js';
import { createPlayer } from '../physics/player.js';
import type { Course } from './schema.js';

const course: Course = {
  name: 'Runtime Test',
  theme: 'neon',
  difficulty: 'medium',
  segments: [
    { type: 'ramp', length: 4000, angle: 60, side: 'right', curve: 0 },
    { type: 'booster', strength: 400 },
    { type: 'ramp', length: 4000, angle: 60, side: 'left', curve: 0 },
    { type: 'checkpoint' },
    { type: 'ramp', length: 4000, angle: 60, side: 'right', curve: 0 },
    { type: 'checkpoint' },
    { type: 'ramp', length: 4000, angle: 60, side: 'left', curve: 0 },
  ],
};

const centerOf = (t: Trigger) => t.center.clone().add(new Vector3(0, -36, 0)); // feet so the capsule centre is at t.center

describe('triggerContains', () => {
  const box: Trigger = {
    kind: 'booster',
    index: 0,
    center: new Vector3(100, 50, -100),
    heading: Math.PI / 2, // track runs toward -X, so "lateral" is along Z
    half: new Vector3(10, 20, 300),
    strength: 0,
  };

  it('uses the track heading for its orientation', () => {
    expect(triggerContains(box, new Vector3(100 - 250, 50, -100))).toBe(true); // 250 along the track
    expect(triggerContains(box, new Vector3(100, 50, -100 - 50))).toBe(false); // 50 to the side
  });

  it('checks height', () => {
    expect(triggerContains(box, new Vector3(100, 75, -100))).toBe(false);
  });
});

describe('applyBoost', () => {
  it('adds speed along the current horizontal velocity', () => {
    const v = new Vector3(300, -100, -400);
    applyBoost(v, 0, 250);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(750, 6);
    expect(v.x / v.z).toBeCloseTo(300 / -400, 9);
    expect(v.y).toBe(-100);
  });

  it('falls back to the track heading when barely moving', () => {
    const v = new Vector3(0, 0, 0);
    applyBoost(v, 0, 250);
    expect(v.z).toBeCloseTo(-250, 9);
  });
});

describe('CourseRuntime', () => {
  const built = buildCourse(course);

  it('fires a booster once per pass, not every tick inside it', () => {
    const rt = new CourseRuntime(built);
    const booster = built.triggers.find((t) => t.kind === 'booster')!;
    const p = createPlayer(centerOf(booster));
    p.vel.set(0, 0, -1000);
    expect(rt.update(p).map((e) => e.type)).toContain('booster');
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeCloseTo(1400, 6);
    expect(rt.update(p).map((e) => e.type)).not.toContain('booster');
  });

  it('advances checkpoints in order and respawns at the latest', () => {
    const rt = new CourseRuntime(built);
    const [cp1, cp2] = built.triggers.filter((t) => t.kind === 'checkpoint');
    const p = createPlayer(centerOf(cp2!));
    expect(rt.update(p)).toContainEqual({ type: 'checkpoint', index: 2 });
    p.pos.copy(centerOf(cp1!));
    rt.update(p);
    expect(rt.lastCheckpoint).toBe(2);
    expect(rt.respawnPoint().pos.distanceTo(built.checkpoints[2]!.pos)).toBe(0);
  });

  it('reports falling below the kill floor', () => {
    const rt = new CourseRuntime(built);
    const p = createPlayer(built.spawn.pos.clone().add(new Vector3(0, -20_000, 0)));
    expect(rt.update(p).map((e) => e.type)).toEqual(['kill']);
  });

  it('reports leaving the start zone and reaching the finish once', () => {
    const rt = new CourseRuntime(built);
    const p = createPlayer(built.spawn.pos);
    expect(rt.update(p)).toEqual([]);
    const ramp = built.pieces.find((x) => x.kind === 'ramp')!;
    p.pos.copy(ramp.kind === 'ramp' ? ramp.points[2]!.pos : new Vector3());
    expect(rt.update(p).map((e) => e.type)).toContain('start');
    const finish = built.triggers.find((t) => t.kind === 'finish')!;
    p.pos.copy(centerOf(finish));
    expect(rt.update(p).map((e) => e.type)).toContain('finish');
    expect(rt.update(p).map((e) => e.type)).not.toContain('finish');
    expect(rt.finished).toBe(true);
  });
});
