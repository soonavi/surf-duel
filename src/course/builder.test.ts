import { describe, expect, it } from 'vitest';
import { BufferGeometry, Vector3 } from 'three';
import { buildCourse, type PadPiece, type RampPiece, type TowerPiece, type WallPiece } from './builder.js';
import { forwardOf, rightOf } from './layout.js';
import type { Course, Segment } from './schema.js';
import { BvhWorld, ContactList } from '../physics/collision.js';
import { DEFAULT_PHYSICS, FLOOR_NORMAL_Y, TICK_DT } from '../physics/constants.js';
import { createPlayer, stepPlayer } from '../physics/player.js';

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

const rampsIn = (built: ReturnType<typeof buildCourse>): RampPiece[] => built.pieces.filter((p): p is RampPiece => p.kind === 'ramp');

/** The riding line point `s` along a ramp (linear between its points). */
function rideAt(r: RampPiece, s: number): { pos: Vector3; heading: number } {
  const pts = r.points.filter((p) => p.s >= 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (s <= b.s) {
      const t = (s - a.s) / (b.s - a.s);
      return { pos: a.pos.clone().lerp(b.pos, t), heading: a.heading + (b.heading - a.heading) * t };
    }
  }
  const last = pts[pts.length - 1]!;
  return { pos: last.pos.clone(), heading: last.heading };
}

describe('buildCourse: level and climbing ramps', () => {
  it('lays each ramp at its own slope: a level one stays level, a climb rises', () => {
    const built = buildCourse(spec([ramp({ length: 9000 }), { type: 'booster', strength: 800 }, ramp({ side: 'left', pitch: 0 }), ramp({ pitch: -4 })]));
    const [, level, climb] = rampsIn(built);
    const rise = (r: RampPiece) => r.points[r.points.length - 1]!.pos.y - r.points.find((p) => p.s === 0)!.pos.y;
    expect(rise(level!)).toBeCloseTo(0, 6);
    expect(rise(climb!)).toBeCloseTo(climb!.length * Math.tan((4 * Math.PI) / 180), 3);
  });
});

describe('buildCourse: walls', () => {
  const walled = spec([ramp({ length: 6000 }), { type: 'wall' }, ramp({ side: 'left', length: 6000 }), ramp()]);

  it('stands a wall across the ramp after it, past where riders land', () => {
    const built = buildCourse(walled);
    const walls = built.pieces.filter((p): p is WallPiece => p.kind === 'wall');
    expect(walls).toHaveLength(1);
    const target = built.pieces[walls[0]!.ramp];
    expect(target?.kind === 'ramp' && target.side).toBe('left');
    expect(walls[0]!.s).toBeGreaterThan(1500);
  });

  /** Slide along the ramp from 300 before the wall, `offset` toward the ridge, and say how far past the wall you got. */
  function rideThroughWall(offset: number): number {
    const built = buildCourse(walled);
    const wall = built.pieces.find((p): p is WallPiece => p.kind === 'wall')!;
    const r = built.pieces[wall.ramp] as RampPiece;
    const start = rideAt(r, wall.s - 300);
    const towardRidge = (r.side === 'right' ? 1 : -1) * offset;
    const theta = (r.angleDeg * Math.PI) / 180;
    const fwd = forwardOf(start.heading);
    const player = createPlayer(start.pos.clone().addScaledVector(rightOf(start.heading), towardRidge));
    player.pos.y += Math.abs(offset) * Math.tan(theta) * Math.sign(offset) + 2;
    player.vel.copy(fwd).multiplyScalar(1500);
    const world = new BvhWorld(built.collision);
    for (let i = 0; i < 40; i++) stepPlayer(player, { forward: 0, side: 0, jump: false, yaw: start.heading }, DEFAULT_PHYSICS, world, TICK_DT);
    const end = rideAt(r, wall.s);
    return player.pos.clone().sub(end.pos).dot(fwd);
  }

  it('lets a rider on the riding line through its window', () => {
    expect(rideThroughWall(0)).toBeGreaterThan(200);
  });

  it('stops a rider who is too high or too low on the face', () => {
    const built = buildCourse(walled);
    const wall = built.pieces.find((p): p is WallPiece => p.kind === 'wall')!;
    expect(rideThroughWall(wall.slack + 80)).toBeLessThan(0);
    expect(rideThroughWall(-(wall.slack + 80))).toBeLessThan(0);
  });
});

describe('buildCourse: spirals', () => {
  const spiralled = spec(
    [ramp({ length: 6000 }), { type: 'booster', strength: 600 }, { type: 'spiral', turn: 'left', ramps: 6, angle: 58 }, ramp({ side: 'right' })],
    { difficulty: 'expert' },
  );

  it('wraps its ramps one full turn round a tower, then carries on the way it came in', () => {
    const built = buildCourse(spiralled);
    const tower = built.pieces.find((p): p is TowerPiece => p.kind === 'tower')!;
    expect(tower).toBeDefined();
    const arcs = rampsIn(built).slice(1, 7);
    expect(arcs).toHaveLength(6);
    for (const arc of arcs) {
      // Holding the key toward the tower: the ridge is on its side.
      expect(arc.side).toBe('left');
      for (const p of arc.points) expect(Math.hypot(p.pos.x - tower.center.x, p.pos.z - tower.center.z)).toBeCloseTo(tower.rideRadius, 0);
      // The tower stands clear inside every ramp.
      expect(tower.radius).toBeLessThan(tower.rideRadius - Math.abs(arc.centerOffset) - arc.faceWidth - 100);
    }
    const finish = built.pieces.find((p): p is PadPiece => p.kind === 'pad' && p.role === 'finish')!;
    expect(Math.cos(finish.heading)).toBeCloseTo(1, 6);
  });

  it('never passes close above or below itself', () => {
    const { path } = buildCourse(spiralled);
    let closest = Infinity;
    for (let i = 0; i < path.count; i++) {
      for (let j = i + 1; j < path.count; j++) {
        const a = path.sample(i);
        const b = path.sample(j);
        if (b.s - a.s < 8000 || Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 900) continue;
        closest = Math.min(closest, Math.abs(a.pos.y - b.pos.y));
      }
    }
    expect(closest).toBeGreaterThan(1500);
  });

  it('re-finds the right turn of the spiral after a respawn, not the one above or below', () => {
    const built = buildCourse(spiralled);
    const lastArc = rampsIn(built)[6]!;
    const at = rideAt(lastArc, lastArc.length - 200).pos;
    const hit = built.path.relocate(at);
    expect(hit.sample.pos.distanceTo(at)).toBeLessThan(400);
  });
});
