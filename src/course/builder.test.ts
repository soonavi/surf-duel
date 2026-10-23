import { describe, expect, it } from 'vitest';
import { BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { buildCourse, type PadPiece, type RampPiece, type TowerPiece, type WallPiece } from './builder.js';
import { forwardOf, inWindow, rightOf, windowCorners } from './layout.js';
import { DIFFICULTIES, type Course, type Segment } from './schema.js';
import { BvhWorld, ContactList } from '../physics/collision.js';
import { DEFAULT_PHYSICS, EYE_HEIGHT, FLOOR_NORMAL_Y, TICK_DT } from '../physics/constants.js';
import { createPlayer, stepPlayer } from '../physics/player.js';
import { aiShapedCourse } from './aiShapedCourses.js';
import { DIFFICULTY } from './tuning.js';

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
    const built = buildCourse(spec([ramp({ length: 9000 }), { type: 'booster', strength: 800 }, ramp({ side: 'left', pitch: 0 }), ramp({ pitch: -4 })], { difficulty: 'hard' }));
    const [, level, climb] = rampsIn(built);
    const rise = (r: RampPiece) => r.points[r.points.length - 1]!.pos.y - r.points.find((p) => p.s === 0)!.pos.y;
    expect(rise(level!)).toBeCloseTo(0, 6);
    expect(rise(climb!)).toBeCloseTo(climb!.length * Math.tan((4 * Math.PI) / 180), 3);
  });
});

describe('buildCourse: walls', () => {
  // User, Oct 8 2026: the walls were "too easy", and their frames shouldn't be connected to the ramps.
  const walled = spec([ramp({ length: 6000 }), { type: 'wall' }, ramp({ side: 'left', length: 6000 }), ramp()], { difficulty: 'hard' });
  const theWall = (built: ReturnType<typeof buildCourse>) => built.pieces.find((p): p is WallPiece => p.kind === 'wall')!;
  const endOf = (r: RampPiece) => r.points[r.points.length - 1]!;

  it('stands free past the end of the ramp after it, with a clear gap, and clear of every ramp', () => {
    // User, Oct 11 2026: "there should be a gap between the ramps and the wall" (at 200 it looked attached).
    const built = buildCourse(walled);
    const walls = built.pieces.filter((p): p is WallPiece => p.kind === 'wall');
    expect(walls).toHaveLength(1);
    const r = built.pieces[walls[0]!.ramp] as RampPiece;
    expect(r.side).toBe('left');
    const end = endOf(r);
    const past = walls[0]!.pos.clone().sub(end.pos).dot(forwardOf(end.heading));
    expect(past).toBeGreaterThanOrEqual(500);
    // The next ramp starts well beyond it.
    const next = rampsIn(built)[2]!;
    const entry = next.points.find((p) => p.s === 0)!.pos;
    expect(entry.clone().sub(walls[0]!.pos).dot(forwardOf(end.heading))).toBeGreaterThanOrEqual(400);
  });

  it('ends the ramp before it in a lip, 5–20° above level, that launches you through', () => {
    const built = buildCourse(walled);
    const wall = theWall(built);
    const pts = (built.pieces[wall.ramp] as RampPiece).points;
    const [before, end] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
    const rise = (end.pos.y - before.pos.y) / Math.hypot(end.pos.x - before.pos.x, end.pos.z - before.pos.z);
    expect(wall.launchDeg).toBeGreaterThanOrEqual(5);
    expect(wall.launchDeg).toBeLessThanOrEqual(20);
    expect(rise).toBeGreaterThan(Math.tan(((wall.launchDeg - 2) * Math.PI) / 180));
  });

  it('cuts a square window turned to the face, with wall all round it', () => {
    // User, Oct 11 2026: "there should be a cutout in the wall" (a 190×750 slit read as a crack).
    const built = buildCourse(walled);
    const wall = theWall(built);
    const r = built.pieces[wall.ramp] as RampPiece;
    // Its sides run along the face and square to it (a left-hand ramp's face falls away to the right).
    expect(wall.windowTilt).toBeCloseTo((-r.angleDeg * Math.PI) / 180, 6);
    for (const [across, y] of windowCorners(wall)) {
      expect(y - wall.bottom).toBeGreaterThan(300);
      expect(wall.top - y).toBeGreaterThan(300);
      expect(across + wall.halfWidth).toBeGreaterThan(300);
      expect(wall.halfWidth - across).toBeGreaterThan(300);
    }
  });

  it('frames the window in the gates’ colour, without narrowing it', () => {
    const built = buildCourse(walled);
    const wall = theWall(built);
    const r = rightOf(wall.heading);
    const pos = built.visuals.gates.getAttribute('position');
    const p = new Vector3();
    let near = 0;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const d = p.clone().sub(wall.pos);
      if (Math.abs(d.dot(forwardOf(wall.heading))) > 200) continue;
      near++;
      // Nothing of the frame inside the opening.
      expect(inWindow(wall, d.dot(r), p.y, 1)).toBe(false);
    }
    expect(near).toBeGreaterThan(0);
  });

  it('shows you the whole window above the ramp’s edge as you line up, on every difficulty', () => {
    // User, Oct 22 2026: "there should be a reasonable gap between the holes in the walls and the ramp".
    // Flying straight off a face you're level with it, so the ramp hid ~40% of every window.
    for (const difficulty of DIFFICULTIES) {
      const built = buildCourse(spec([ramp({ length: 6000 }), { type: 'wall' }, ramp({ side: 'left', length: 6000 }), { type: 'wall' }, ramp({ length: 6000 }), ramp({ side: 'left' })], { difficulty }));
      const ramps = new MeshBVH(mergeGeometries([built.visuals.rampLeft, built.visuals.rampRight])!);
      for (const wall of built.pieces.filter((p): p is WallPiece => p.kind === 'wall')) {
        const r = built.pieces[wall.ramp] as RampPiece;
        const tan = Math.tan((r.angleDeg * Math.PI) / 180);
        const sideSign = r.side === 'right' ? 1 : -1;
        const [c, s] = [Math.cos(wall.windowTilt), Math.sin(wall.windowTilt)];
        // From the window's own line and from the usual one, at the foot of the lip and further back.
        for (const fromRidge of [wall.target, r.ride]) {
          for (const back of [0, 600, 1500]) {
            const at = rideAt(r, r.length - 400 - back);
            const eye = at.pos.clone().addScaledVector(rightOf(at.heading), r.centerOffset - sideSign * fromRidge);
            eye.y += (r.ride - fromRidge) * tan + EYE_HEIGHT;
            let hidden = 0;
            const h = wall.windowHalf * 0.98;
            for (let i = 0; i <= 10; i++) {
              for (let j = 0; j <= 10; j++) {
                const [u, v] = [-h + (2 * h * i) / 10, -h + (2 * h * j) / 10];
                const p = wall.pos.clone().addScaledVector(rightOf(wall.heading), wall.windowAcross + u * c - v * s);
                p.y = wall.windowY + u * s + v * c;
                const dir = p.clone().sub(eye);
                const far = dir.length();
                if (ramps.raycastFirst(new Ray(eye, dir.normalize()), DoubleSide, 0, far - 1)) hidden++;
              }
            }
            expect(hidden, `${difficulty}, window at ${wall.target.toFixed(0)}, from ${fromRidge.toFixed(0)}, ${back} back`).toBe(0);
          }
        }
      }
    }
  });

  /** Ride off the end of the walled ramp `fromRidge` units down the face, and say how far past the wall you got. */
  function rideOff(fromRidge: number): number {
    const built = buildCourse(walled);
    const wall = theWall(built);
    const r = built.pieces[wall.ramp] as RampPiece;
    const start = rideAt(r, r.length - 400);
    const theta = (r.angleDeg * Math.PI) / 180;
    // Left ramp: the ridge is to the left of the riding line, the face runs right of it.
    const lateral = r.centerOffset + fromRidge;
    const player = createPlayer(start.pos.clone().addScaledVector(rightOf(start.heading), lateral));
    player.pos.y += (r.ride - fromRidge) * Math.tan(theta) + 2;
    const fwd = forwardOf(start.heading);
    player.vel.copy(fwd).multiplyScalar(1500);
    const world = new BvhWorld(built.collision);
    for (let i = 0; i < 120; i++) stepPlayer(player, { forward: 0, side: -1, jump: false, yaw: start.heading }, DEFAULT_PHYSICS, world, TICK_DT);
    return player.pos.clone().sub(wall.pos).dot(forwardOf(wall.heading));
  }

  it('lets a rider lined up with the window through', () => {
    const wall = theWall(buildCourse(walled));
    expect(rideOff(wall.target)).toBeGreaterThan(150);
  });

  it('stops a rider who stays on the usual riding line', () => {
    const built = buildCourse(walled);
    const r = built.pieces[theWall(built).ramp] as RampPiece;
    expect(rideOff(r.ride)).toBeLessThan(0);
  });

  it('stays tight: a little further up or down the face than its line, you hit the wall', () => {
    const wall = theWall(buildCourse(walled));
    const slack = DIFFICULTY.hard.windowSlack;
    expect(rideOff(wall.target - slack - 50)).toBeLessThan(0);
    expect(rideOff(wall.target + slack + 50)).toBeLessThan(0);
  });

  it('alternates its windows low and high on the face', () => {
    const twoWalls = buildCourse(spec([ramp({ length: 6000 }), { type: 'wall' }, ramp({ side: 'left', length: 6000 }), { type: 'wall' }, ramp({ length: 6000 }), ramp({ side: 'left' })], { difficulty: 'hard' }));
    const walls = twoWalls.pieces.filter((p): p is WallPiece => p.kind === 'wall');
    const ride = (w: WallPiece) => (twoWalls.pieces[w.ramp] as RampPiece).ride;
    expect(walls[0]!.target).toBeGreaterThan(ride(walls[0]!));
    expect(walls[1]!.target).toBeLessThan(ride(walls[1]!));
  });
});

describe('buildCourse: flares and S-bends', () => {
  // Surf-map research, Oct 14 2026: "jump" ramps whose end curves up, and ramps that bend one way and back.
  const flared = spec([ramp({ length: 7000 }), ramp({ side: 'left', length: 5000, flare: 18 }), { type: 'gap', length: 1200 }, ramp({ length: 6000 }), ramp({ side: 'left' })], { difficulty: 'hard' });

  it('bends the end of a flared ramp up, so you leave it climbing', () => {
    const r = rampsIn(buildCourse(flared))[1]!;
    const pts = r.points;
    const end = pts[pts.length - 1]!;
    const before = pts[pts.length - 2]!;
    const run = Math.hypot(end.pos.x - before.pos.x, end.pos.z - before.pos.z);
    // Rising at the lip (near the 18° it ends at), where an unflared ramp would still be running downhill.
    expect((end.pos.y - before.pos.y) / run).toBeGreaterThan(Math.tan((12 * Math.PI) / 180));
    // Well above where its straight slope (hard's usual 10°) would have run it.
    const start = r.points.find((q) => q.s === 0)!.pos.y;
    expect(end.pos.y - (start - r.length * Math.tan((10 * Math.PI) / 180))).toBeGreaterThan(150);
  });

  it('is long enough for fast riders to land and ride before it bends up', () => {
    const plain = rampsIn(buildCourse({ ...flared, segments: flared.segments.map((s, i) => (i === 1 ? ramp({ side: 'left', length: 5000 }) : s)) }))[1]!;
    expect(rampsIn(buildCourse(flared))[1]!.length).toBeGreaterThan(plain.length);
  });

  it('launches a rider off its lip, rising', () => {
    const built = buildCourse(flared);
    const r = rampsIn(built)[1]!;
    const start = rideAt(r, r.length - 2200);
    const player = createPlayer(start.pos.clone().add(new Vector3(0, 2, 0)));
    player.vel.copy(forwardOf(start.heading)).multiplyScalar(2200);
    const world = new BvhWorld(built.collision);
    let rising = 0;
    for (let i = 0; i < 160; i++) {
      stepPlayer(player, { forward: 0, side: -1, jump: false, yaw: start.heading }, DEFAULT_PHYSICS, world, TICK_DT);
      if (!player.surfing && !player.onGround) rising = Math.max(rising, player.vel.y);
    }
    expect(rising).toBeGreaterThan(300);
  });

  it('swerves one way and back, then carries on where its curve points', () => {
    const swerved = spec([ramp({ length: 7000, swerve: 20, curve: 10 }), ramp({ side: 'left' })], { difficulty: 'hard' });
    const r = rampsIn(buildCourse(swerved))[0]!;
    const pts = r.points.filter((p) => p.s >= 0);
    const h0 = pts[0]!.heading;
    const headings = pts.map((p) => p.heading - h0);
    expect(Math.max(...headings)).toBeGreaterThan((25 * Math.PI) / 180);
    expect(Math.min(...headings)).toBeGreaterThanOrEqual(-1e-9);
    expect(headings[headings.length - 1]!).toBeCloseTo((10 * Math.PI) / 180, 6);
    // Gentle enough to ride: no two sections turn more than the layout allows.
    for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i]!.heading - pts[i - 1]!.heading)).toBeLessThanOrEqual((2.01 * Math.PI) / 180);
  });

  it('keeps every flared and swerved face surfable', () => {
    const { visuals } = buildCourse(spec([ramp({ swerve: -25, flare: 20 }), ramp({ side: 'left', flare: 20, pitch: 0 }), ramp({ side: 'both', swerve: 25 })], { difficulty: 'expert' }));
    for (const geo of [visuals.rampRight, visuals.rampLeft]) {
      for (const n of triangleNormals(geo)) if (n.y > 0.05) expect(n.y).toBeLessThan(FLOOR_NORMAL_Y);
    }
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

  it('hangs a checkpoint gate halfway round, so dropping from its start to its end skips a checkpoint', () => {
    const built = buildCourse(spiralled);
    const tower = built.pieces.find((p): p is TowerPiece => p.kind === 'tower')!;
    const arcs = rampsIn(built).slice(1, 7);
    const halfway = arcs[3]!;
    // The gate just before the ramp halfway round, on the far side of the tower from the start.
    const gates = built.pieces.filter((p) => p.kind === 'gate');
    const entry = halfway.points.find((p) => p.s === 0)!.pos;
    expect(gates.some((g) => g.kind === 'gate' && g.center.distanceTo(entry) < 2500)).toBe(true);
    const start = arcs[0]!.points.find((p) => p.s === 0)!.pos;
    const angle = (v: Vector3) => Math.atan2(v.x - tower.center.x, v.z - tower.center.z);
    expect(Math.abs(Math.cos(angle(entry) - angle(start)))).toBeGreaterThan(0.4);
    expect(Math.cos(angle(entry) - angle(start))).toBeLessThan(0);
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

describe('buildCourse: anything the AI might send', () => {
  // Seeded courses shaped like AI replies (walls, spirals, steep climbs, big boosters, every value
  // anywhere in range): every one must lay out with finite geometry. An AI expert course with
  // stretched climbs once crashed it.
  it('lays out 300 random AI-shaped courses without failing', () => {
    const DIFFS = ['easy', 'medium', 'hard', 'expert'] as const;
    for (let n = 0; n < 300; n++) {
      const spec = aiShapedCourse(20261008 + n, DIFFS[n % 4]!);
      let built: ReturnType<typeof buildCourse>;
      try {
        built = buildCourse(spec);
      } catch (err) {
        throw new Error(`course ${n} failed to build: ${String(err)}\n${JSON.stringify(spec)}`);
      }
      const pos = built.collision.attributes.position!.array as ArrayLike<number>;
      for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error(`course ${n} has non-finite geometry`);
      for (const r of rampsIn(built)) expect(Number.isFinite(r.length) && r.length > 0).toBe(true);
    }
  }, 120_000);
});
