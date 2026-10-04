import { describe, expect, it } from 'vitest';
import { BufferGeometry, Vector3 } from 'three';
import { buildCourse } from './builder';
import type { Course, Segment } from './schema';
import { BvhWorld, ContactList } from '../physics/collision';
import { DEFAULT_PHYSICS, FLOOR_NORMAL_Y, TICK_DT } from '../physics/constants';
import { createPlayer, stepPlayer } from '../physics/player';

const ramp = (over: Partial<Extract<Segment, { type: 'ramp' }>> = {}): Segment => ({
  type: 'ramp',
  length: 4000,
  angle: 60,
  side: 'right',
  curve: 0,
  ...over,
});

const spec = (segments: Segment[], over: Partial<Course> = {}): Course => ({
  name: 'Builder Test',
  theme: 'neon',
  difficulty: 'medium',
  segments,
  ...over,
});

const mixed = spec([
  ramp({ curve: 20 }),
  ramp({ side: 'left', angle: 65, curve: -30 }),
  { type: 'booster', strength: 300 },
  ramp({ side: 'both', angle: 55 }),
  { type: 'checkpoint' },
  { type: 'drop', height: 900 },
  ramp({ side: 'right', angle: 50, curve: 10 }),
  { type: 'gap', length: 400 },
  ramp({ side: 'left', angle: 70, curve: 25 }),
]);

function triangleNormals(geo: BufferGeometry): Vector3[] {
  const pos = geo.getAttribute('position');
  const out: Vector3[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    out.push(b.clone().sub(a).cross(c.clone().sub(a)).normalize());
  }
  return out;
}

describe('buildCourse', () => {
  it('is deterministic', () => {
    const a = buildCourse(mixed).collision.getAttribute('position').array;
    const b = buildCourse(mixed).collision.getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('always has a start, a finish and at least two ramps, even from garbage', () => {
    for (const input of [null, 'nope', { segments: [{ type: 'gap', length: 99999 }] }]) {
      const built = buildCourse(input);
      const kinds = built.triggers.map((t) => t.kind);
      expect(kinds).toContain('start');
      expect(kinds).toContain('finish');
      expect(built.pieces.filter((p) => p.kind === 'ramp').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('inserts a checkpoint after every three ramps that lack one', () => {
    const built = buildCourse(spec(Array.from({ length: 7 }, (_, i) => ramp({ side: i % 2 ? 'left' : 'right' }))));
    expect(built.segments.map((s) => s.type).join(',')).toBe(
      'ramp,ramp,ramp,checkpoint,ramp,ramp,ramp,checkpoint,ramp',
    );
    expect(built.checkpoints).toHaveLength(3); // start + two checkpoints
  });

  it('makes checkpoints fly-through gates, not landing pads', () => {
    const built = buildCourse(mixed);
    const pads = built.pieces.filter((p) => p.kind === 'pad').map((p) => (p.kind === 'pad' ? p.role : ''));
    expect(pads).toEqual(['start', 'finish']);
    const gates = built.pieces.filter((p) => p.kind === 'gate');
    expect(gates).toHaveLength(built.segments.filter((s) => s.type === 'checkpoint').length);
  });

  it('respawns you at a checkpoint on the next ramp face, already moving', () => {
    const withBoth = spec([
      ramp(),
      ramp({ side: 'left' }),
      { type: 'checkpoint' },
      ramp({ side: 'both' }),
      { type: 'checkpoint' },
      ramp({ side: 'left', angle: 50 }),
    ]);
    for (const built of [buildCourse(mixed), buildCourse(withBoth)]) {
      const world = new BvhWorld(built.collision);
      expect(built.checkpoints[0]!.speed).toBe(0);
      for (const cp of built.checkpoints.slice(1)) {
        expect(cp.speed).toBeGreaterThan(DEFAULT_PHYSICS.maxSpeed);
        const feet = cp.pos.clone().add(new Vector3(0, -2, 0));
        const contacts = new ContactList();
        expect(world.resolveCapsule(feet, contacts)).toBeGreaterThan(0);
        // On a surfable face — never balanced on a ridge.
        expect(contacts.normals[0]!.y).toBeLessThan(FLOOR_NORMAL_Y);
      }
    }
  });

  it('never builds a ramp shorter than the spec asks for', () => {
    const built = buildCourse(mixed);
    const specRamps = built.segments.filter((s) => s.type === 'ramp');
    const pieces = built.pieces.filter((p) => p.kind === 'ramp');
    pieces.forEach((p, i) => expect(p.length).toBeGreaterThanOrEqual((specRamps[i] as { length: number }).length));
  });

  it('makes every upward-facing ramp surface surfable', () => {
    const { visuals } = buildCourse(mixed);
    for (const geo of [visuals.rampRight, visuals.rampLeft]) {
      for (const n of triangleNormals(geo)) {
        if (n.y > 0.05) expect(n.y).toBeLessThan(FLOOR_NORMAL_Y);
      }
    }
  });

  it('puts the riding line on the face of each side ramp', () => {
    const built = buildCourse(mixed);
    const world = new BvhWorld(built.collision);
    const contacts = new ContactList();
    for (const piece of built.pieces) {
      if (piece.kind !== 'ramp' || piece.side === 'both') continue;
      for (let i = 1; i < piece.points.length - 1; i += 3) {
        const feet = piece.points[i]!.pos.clone().add(new Vector3(0, -2, 0)); // nudge into the face
        const before = feet.clone();
        contacts.clear();
        expect(world.resolveCapsule(feet, contacts)).toBeGreaterThan(0);
        expect(feet.distanceTo(before)).toBeLessThan(6);
        const n = contacts.normals[0]!;
        expect(n.y).toBeLessThan(FLOOR_NORMAL_Y);
        expect(n.y).toBeGreaterThan(0.05);
      }
    }
  });

  it('spawns the player on solid ground', () => {
    const built = buildCourse(mixed);
    const world = new BvhWorld(built.collision);
    const player = createPlayer(built.spawn.pos);
    for (let i = 0; i < 20; i++) stepPlayer(player, { forward: 0, side: 0, jump: false, yaw: 0 }, DEFAULT_PHYSICS, world, TICK_DT);
    expect(player.onGround).toBe(true);
    expect(player.pos.distanceTo(built.spawn.pos)).toBeLessThan(1);
  });

  it('creates one trigger per checkpoint and booster, plus start and finish', () => {
    const built = buildCourse(mixed);
    const count = (k: string) => built.triggers.filter((t) => t.kind === k).length;
    expect(count('start')).toBe(1);
    expect(count('finish')).toBe(1);
    expect(count('checkpoint')).toBe(built.segments.filter((s) => s.type === 'checkpoint').length);
    expect(count('booster')).toBe(1);
  });

  it('turns by the sum of the ramp curves', () => {
    const built = buildCourse(mixed);
    const totalCurve = built.segments.reduce((sum, s) => sum + (s.type === 'ramp' ? s.curve : 0), 0);
    const finish = built.pieces.find((p) => p.kind === 'pad' && p.role === 'finish');
    expect(finish && finish.kind === 'pad' ? finish.heading : NaN).toBeCloseTo((totalCurve * Math.PI) / 180, 9);
  });

  it('keeps the kill floor below the course geometry everywhere', () => {
    const { path } = buildCourse(mixed);
    for (let i = 0; i < path.count; i++) {
      const s = path.sample(i);
      expect(s.killY).toBeLessThan(s.floorY);
      expect(s.killY).toBeLessThan(s.pos.y);
    }
  });
});
