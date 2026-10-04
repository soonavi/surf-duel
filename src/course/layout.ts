/**
 * Course layout: walk a "track cursor" through a validated course and place
 * every piece. Pure numbers (no meshes), so it's cheap to test and reason
 * about.
 *
 * The cursor follows the riding line: where a good rider's feet are. Each
 * transition into the next piece is sized from the speed model so that:
 *  - a cautious (slow) rider is still above the next piece's front edge when
 *    they reach it, so nobody slams into a ramp's front wall, and
 *  - a strong (fast) rider still lands on the next ramp, which is lengthened
 *    if needed.
 */
import { MathUtils, Vector3 } from 'three';
import { PLAYER_RADIUS } from '../physics/constants';
import type { Course, RampSegment, RampSide, Segment } from './schema';
import { TrackPath } from './path';
import {
  DIFFICULTY,
  PLAN_GRAVITY,
  START_SPEED,
  WALK_SPEED,
  afterBooster,
  afterFall,
  afterPad,
  afterRamp,
  type SpeedRange,
} from './tuning';

export interface RidePoint {
  pos: Vector3;
  heading: number;
  /** Distance along this ramp's riding line. */
  s: number;
}

export interface RampPiece {
  kind: 'ramp';
  /** Index into the final segment list. */
  segment: number;
  side: RampSide;
  angleDeg: number;
  /** Vertical size of the prism. */
  height: number;
  /** Horizontal width of each face, ridge to base edge. */
  faceWidth: number;
  /** Horizontal distance from ridge to riding line (0 for 'both'). */
  ride: number;
  /** Lateral offset of the ridge from the riding line; positive = right. */
  centerOffset: number;
  /** Ridge height above the rider's feet on the riding line. */
  peakAboveRide: number;
  /** Built length; at least the spec length. */
  length: number;
  points: RidePoint[];
}

export interface PadPiece {
  kind: 'pad';
  role: 'start' | 'checkpoint' | 'finish';
  /** Centre of the top surface. */
  center: Vector3;
  heading: number;
  width: number;
  length: number;
}

export interface BoosterPiece {
  kind: 'booster';
  center: Vector3;
  heading: number;
  width: number;
  height: number;
  depth: number;
  strength: number;
}

export type Piece = RampPiece | PadPiece | BoosterPiece;

export interface SpawnPoint {
  pos: Vector3;
  heading: number;
}

export interface CourseLayout {
  /** Segments as built, including auto-inserted checkpoints. */
  segments: Segment[];
  pieces: Piece[];
  path: TrackPath;
  spawn: SpawnPoint;
  /** Respawn points: [0] is the start, then one per checkpoint pad. */
  checkpoints: SpawnPoint[];
}

export const PAD_THICKNESS = 64;
export const START_PAD = { width: 1000, length: 700 } as const;
export const CHECKPOINT_PAD = { width: 1300, length: 1000 } as const;
export const FINISH_PAD = { width: 1800, length: 2600, wallHeight: 900 } as const;
export const BOOSTER = { width: 1000, depth: 300, offset: 200, length: 500, margin: 350 } as const;

/** Fall from a pad edge onto the next piece (walking off, like the start). */
const DROP_FROM_PAD = 380;
/** Fall from a ramp exit onto the next piece. */
const DROP_FROM_RAMP = 230;
/**
 * A cautious rider must arrive at least this far above the next ramp's ridge —
 * its highest point — so riders anywhere across the line clear its front wall.
 */
const RIDGE_CLEARANCE = 80;
/**
 * How far below the riding line (measured across the face) a rider may have
 * slid when leaving a ramp. Sliding outward on one ramp moves you *toward* the
 * ridge of the next one when sides alternate, while dropping you by
 * slide·tanθ — so those transitions get extra drop to cover it.
 */
const SLIDE_TOLERANCE = 100;
/** Ramps after a pad start this far back, tucked under the pad, so there's no gap to fall through. */
const PAD_LEAD_IN = 300;
/** Vertical gap kept between a pad's underside and the ramp tucked beneath it. */
const PAD_UNDER_CLEARANCE = 40;
/** How far past the previous exit the next piece begins. */
const LEAD_FROM_RAMP = 120;
/** Fast riders can fly clean over a checkpoint pad; they fall this much further. */
const PAD_OVERSHOOT_DROP = 400;
/** Ramp left to ride after a fast rider's landing point. */
const MIN_RIDE = 1500;
/**
 * Ramps stay straight until this far past the fastest rider's landing point,
 * then turn. Otherwise a rider who lands far down a curving ramp has drifted
 * κ·d²/2 sideways from its line by the time they touch down — sometimes onto
 * the wrong face.
 */
const LANDING_STRAIGHT_MARGIN = 400;
/** Never spend more than this fraction of a ramp running straight. */
const MAX_STRAIGHT_FRACTION = 0.6;
const MAX_RAMP_LENGTH = 14_000;
const MAX_RAMP_HEIGHT = 2400;
/** Riding line sits this fraction of the face width below the ridge. */
const RIDE_FRACTION = 0.28;
const SECTION_SPACING = 250;
const MAX_SECTION_TURN_DEG = 2;
export const RAMPS_PER_CHECKPOINT = 3;
const PATH_SPACING = 150;
const KILL_WINDOW = 1500;
const KILL_MARGIN = 700;

export function forwardOf(heading: number, out = new Vector3()): Vector3 {
  return out.set(-Math.sin(heading), 0, -Math.cos(heading));
}

export function rightOf(heading: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(heading), 0, -Math.sin(heading));
}

/** Height lost after travelling `x` horizontally at speed v, starting with downward speed vy. */
function fallAfter(v: number, vy: number, x: number): number {
  const t = x / Math.max(v, 1);
  return vy * t + 0.5 * PLAN_GRAVITY * t * t;
}

interface Cursor {
  pos: Vector3;
  heading: number;
  from: 'pad' | 'ramp';
  /** The ramp just left (null after a pad): which way its ridge was, and tan of its angle. */
  prevRamp: { side: RampSide; tanTheta: number } | null;
  /** True when leaving a checkpoint pad (fast riders may have flown over it). */
  afterCheckpoint: boolean;
  speed: SpeedRange;
  floorY: number;
}

export function planCourse(course: Course): CourseLayout {
  const diff = DIFFICULTY[course.difficulty];
  const pitch = MathUtils.degToRad(diff.pitchDeg);
  const tanPitch = Math.tan(pitch);

  const segments: Segment[] = [];
  const pieces: Piece[] = [];
  const path = new TrackPath();
  const checkpoints: SpawnPoint[] = [];
  const f = new Vector3();

  // Start pad: top at y = 0, front edge on the origin, facing -Z.
  const start: PadPiece = {
    kind: 'pad',
    role: 'start',
    center: new Vector3(0, 0, START_PAD.length / 2),
    heading: 0,
    width: START_PAD.width,
    length: START_PAD.length,
  };
  pieces.push(start);
  const spawn: SpawnPoint = { pos: new Vector3(0, 0, START_PAD.length * 0.6), heading: 0 };
  checkpoints.push(spawn);
  for (let z = START_PAD.length; z > 0; z -= PATH_SPACING) path.add(new Vector3(0, 0, z), 0, 0, -PAD_THICKNESS);

  const cursor: Cursor = {
    pos: new Vector3(0, 0, 0),
    heading: 0,
    from: 'pad',
    prevRamp: null,
    afterCheckpoint: false,
    speed: { ...START_SPEED },
    floorY: -PAD_THICKNESS,
  };
  let pendingGap = 0;
  let pendingDrop = 0;
  let rampsSinceCheckpoint = 0;

  /**
   * Size the flight from the cursor to the next piece and consume pending
   * gaps/drops. `minDrop` is how far below the exit the next piece's entry
   * must be for its highest point to stay clear of a cautious rider.
   */
  const transition = (minDrop: number): { drop: number; front: number; fastLanding: number } => {
    const fromPad = cursor.from === 'pad';
    const vLo = fromPad ? WALK_SPEED : cursor.speed.lo;
    const vyLo = fromPad ? 0 : vLo * Math.sin(pitch);
    const base = Math.max(fromPad ? DROP_FROM_PAD : DROP_FROM_RAMP, minDrop);
    const drop = base + pendingDrop + fallAfter(vLo, vyLo, pendingGap);
    // From a pad the next piece starts right at the edge (ramps tuck under it);
    // from a ramp there's a short lead so the exit and entry never overlap.
    const front = pendingGap + (fromPad ? 0 : LEAD_FROM_RAMP);
    const vHi = Math.max(cursor.speed.hi, vLo);
    const vyHi = fromPad ? 0 : vHi * Math.sin(pitch);
    const fastDrop = drop + (cursor.afterCheckpoint ? PAD_OVERSHOOT_DROP : 0);
    const t = (-vyHi + Math.sqrt(vyHi * vyHi + 2 * PLAN_GRAVITY * fastDrop)) / PLAN_GRAVITY;
    pendingGap = 0;
    pendingDrop = 0;
    cursor.speed = afterFall(cursor.speed, drop);
    return { drop, front, fastLanding: vHi * t };
  };

  /** Path samples for the flight from the cursor to `to` (exclusive of both ends). */
  const addFlightPath = (to: Vector3, piece: number, toFloorY: number): void => {
    const dist = Math.hypot(to.x - cursor.pos.x, to.z - cursor.pos.z);
    const steps = Math.ceil(dist / PATH_SPACING);
    const floorY = Math.min(cursor.floorY, toFloorY);
    for (let i = 1; i < steps; i++) {
      path.add(new Vector3().lerpVectors(cursor.pos, to, i / steps), cursor.heading, piece, floorY);
    }
  };

  const placeRamp = (seg: RampSegment): void => {
    const theta = MathUtils.degToRad(seg.angle);
    let faceWidth: number = diff.faceWidth;
    let height = faceWidth * Math.tan(theta);
    if (height > MAX_RAMP_HEIGHT) {
      height = MAX_RAMP_HEIGHT;
      faceWidth = height / Math.tan(theta);
    }
    const r = PLAYER_RADIUS;
    const ride = seg.side === 'both' ? 0 : RIDE_FRACTION * faceWidth;
    const sideSign = seg.side === 'right' ? 1 : seg.side === 'left' ? -1 : 0;
    // Exact for a capsule resting on the face: feet sit r(1−cosθ) below the
    // contact point, which is r·sinθ closer to the ridge than the feet.
    const peakAboveRide = seg.side === 'both' ? 0 : r * (1 - Math.cos(theta)) + (ride - r * Math.sin(theta)) * Math.tan(theta);

    const fromPad = cursor.from === 'pad';
    const leadIn = fromPad ? PAD_LEAD_IN : 0;
    const prev = cursor.prevRamp;
    const towardNextRidge =
      prev !== null && (prev.side === 'both' || seg.side === 'both' || prev.side !== seg.side);
    const slideDrop = towardNextRidge ? SLIDE_TOLERANCE * (prev.tanTheta + Math.tan(theta)) : 0;
    const minDrop = fromPad
      ? peakAboveRide + leadIn * tanPitch + PAD_THICKNESS + PAD_UNDER_CLEARANCE
      : peakAboveRide + RIDGE_CLEARANCE + slideDrop;
    const { drop, front, fastLanding } = transition(minDrop);
    const length = Math.min(MAX_RAMP_LENGTH, Math.max(seg.length, fastLanding - front + MIN_RIDE));

    const entry = cursor.pos.clone().addScaledVector(forwardOf(cursor.heading, f), front);
    entry.y = cursor.pos.y - drop;
    const curveRad = MathUtils.degToRad(seg.curve);
    const straight = Math.min(length * MAX_STRAIGHT_FRACTION, Math.max(0, fastLanding - front + LANDING_STRAIGHT_MARGIN));
    const headingAt = (s: number): number =>
      cursor.heading + curveRad * Math.min(1, Math.max(0, (s - straight) / (length - straight)));
    const sections = Math.max(
      2,
      Math.ceil(length / SECTION_SPACING),
      Math.ceil(Math.abs(seg.curve) / MAX_SECTION_TURN_DEG / (1 - straight / length)),
    );
    const ds = length / sections;
    const points: RidePoint[] = [];
    if (leadIn > 0) {
      // Straight lead-in tucked under the pad, continuing the ramp's slope backwards.
      const back = entry.clone().addScaledVector(forwardOf(cursor.heading, f), -leadIn);
      back.y = entry.y + leadIn * tanPitch;
      points.push({ pos: back, heading: cursor.heading, s: -leadIn });
    }
    const p = entry.clone();
    for (let i = 0; i <= sections; i++) {
      const s = i * ds;
      points.push({ pos: p.clone(), heading: headingAt(s), s });
      if (i < sections) {
        p.addScaledVector(forwardOf(headingAt(s + ds / 2), f), ds);
        p.y = entry.y - (s + ds) * tanPitch;
      }
    }

    const pieceIndex = pieces.length;
    pieces.push({
      kind: 'ramp',
      segment: segments.length,
      side: seg.side,
      angleDeg: seg.angle,
      height,
      faceWidth,
      ride,
      centerOffset: sideSign * ride,
      peakAboveRide,
      length,
      points,
    });
    segments.push(seg);

    const floorAt = (pt: RidePoint): number => pt.pos.y + peakAboveRide - height;
    const ridden = points.filter((pt) => pt.s >= 0);
    addFlightPath(entry, pieceIndex, floorAt(ridden[0]!));
    for (const pt of ridden) path.add(pt.pos, pt.heading, pieceIndex, floorAt(pt));

    const last = points[points.length - 1]!;
    cursor.pos.copy(last.pos);
    cursor.heading += curveRad;
    cursor.from = 'ramp';
    cursor.prevRamp = { side: seg.side, tanTheta: Math.tan(theta) };
    cursor.afterCheckpoint = false;
    cursor.speed = afterRamp(cursor.speed, length, course.difficulty);
    cursor.floorY = floorAt(last);
  };

  const placePad = (role: 'checkpoint' | 'finish'): void => {
    const dims = role === 'finish' ? FINISH_PAD : CHECKPOINT_PAD;
    // A rider who slid down the last ramp arrives low; keep the pad's front edge under them.
    const prev = cursor.prevRamp;
    const { drop, front } = transition(prev ? SLIDE_TOLERANCE * prev.tanTheta + RIDGE_CLEARANCE : 0);
    const fwd = forwardOf(cursor.heading);
    const frontEdge = cursor.pos.clone().addScaledVector(fwd, front);
    frontEdge.y = cursor.pos.y - drop;
    const center = frontEdge.clone().addScaledVector(fwd, dims.length / 2);
    const pieceIndex = pieces.length;
    pieces.push({ kind: 'pad', role, center, heading: cursor.heading, width: dims.width, length: dims.length });
    if (role === 'checkpoint') {
      segments.push({ type: 'checkpoint' });
      checkpoints.push({ pos: frontEdge.clone().addScaledVector(fwd, dims.length * 0.45), heading: cursor.heading });
    }

    const floorY = frontEdge.y - PAD_THICKNESS;
    addFlightPath(frontEdge, pieceIndex, floorY);
    for (let d = 0; d <= dims.length; d += PATH_SPACING) {
      path.add(frontEdge.clone().addScaledVector(fwd, d), cursor.heading, pieceIndex, floorY);
    }

    cursor.pos.copy(frontEdge).addScaledVector(fwd, dims.length);
    cursor.from = 'pad';
    cursor.prevRamp = null;
    cursor.afterCheckpoint = role === 'checkpoint';
    cursor.speed = afterPad(cursor.speed);
    cursor.floorY = floorY;
  };

  const placeBooster = (strength: number): void => {
    const fromPad = cursor.from === 'pad';
    const vLo = fromPad ? WALK_SPEED : cursor.speed.lo;
    const vyLo = fromPad ? 0 : vLo * Math.sin(pitch);
    const along = pendingGap + BOOSTER.offset;
    const fall = pendingDrop + fallAfter(vLo, vyLo, along);
    const top = cursor.pos.y + BOOSTER.margin;
    const bottom = cursor.pos.y - fall - BOOSTER.margin;
    const center = cursor.pos.clone().addScaledVector(forwardOf(cursor.heading, f), along);
    center.y = (top + bottom) / 2;
    pieces.push({
      kind: 'booster',
      center,
      heading: cursor.heading,
      width: BOOSTER.width,
      height: top - bottom,
      depth: BOOSTER.depth,
      strength,
    });
    pendingGap += BOOSTER.length;
    cursor.speed = afterBooster(cursor.speed, strength);
  };

  for (const seg of course.segments) {
    switch (seg.type) {
      case 'gap':
        pendingGap += seg.length;
        segments.push(seg);
        break;
      case 'drop':
        pendingDrop += seg.height;
        segments.push(seg);
        break;
      case 'booster':
        placeBooster(seg.strength);
        segments.push(seg);
        break;
      case 'checkpoint':
        placePad('checkpoint');
        rampsSinceCheckpoint = 0;
        break;
      case 'ramp':
        if (rampsSinceCheckpoint >= RAMPS_PER_CHECKPOINT) {
          placePad('checkpoint');
          rampsSinceCheckpoint = 0;
        }
        placeRamp(seg);
        rampsSinceCheckpoint++;
        break;
    }
  }
  placePad('finish');
  path.finish(KILL_WINDOW, KILL_MARGIN);

  return { segments, pieces, path, spawn, checkpoints };
}
