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
 *
 * Each ramp runs at its own slope (level and climbing ones too). A wall
 * stands across the ramp after it with a window round the riding line, and a
 * spiral lays one full turn of ramps on a circle round a tower.
 */
import { MathUtils, Vector3 } from 'three';
import { DEFAULT_PHYSICS, PLAYER_HEIGHT, PLAYER_RADIUS } from '../physics/constants.js';
import type { Course, RampSegment, RampSide, Segment, SpiralSegment } from './schema.js';
import { TrackPath } from './path.js';
import {
  AIR_STRAFE_REACH,
  MIN_CLIMB_SPEED,
  DIFFICULTY,
  PLAN_GRAVITY,
  SPIRAL_GAP_DEG,
  SPIRAL_PITCH_DEG,
  SPIRAL_RADIUS,
  START_SPEED,
  WALK_SPEED,
  afterBooster,
  afterFall,
  afterRamp,
  rampPitchDeg,
  type SpeedRange,
} from './tuning.js';

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
  role: 'start' | 'finish';
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

/** A fly-through checkpoint arch spanning the flight into the next ramp. */
export interface GatePiece {
  kind: 'gate';
  /** Checkpoint number, 1-based (the start is 0). */
  index: number;
  center: Vector3;
  heading: number;
  width: number;
  height: number;
  depth: number;
}

/** A wall standing across a ramp, with a window round the riding line: stay on your line or hit it. */
/**
 * A free-standing wall just past the end of a ramp, with a small window set
 * off the riding line (user, Oct 8 2026: walls were "too easy", and they
 * shouldn't be connected to the ramps). Where you leave the ramp decides
 * where you fly through, so you line up on the face before its end.
 */
export interface WallPiece {
  kind: 'wall';
  /** Index (into pieces) of the ramp it stands past the end of. */
  ramp: number;
  /** Where the riding line, carried on, crosses the wall (a rider's feet), and the ramp's end heading. */
  pos: Vector3;
  heading: number;
  /** The window's centre, as a distance down the face from the ramp's ridge (0 on a two-sided ridge). */
  target: number;
  /** The window: across the wall from `pos` (positive is to the right), and between these heights. */
  windowLeft: number;
  windowRight: number;
  windowBottom: number;
  windowTop: number;
  /** The whole wall: half its width, and its bottom and top heights. */
  halfWidth: number;
  bottom: number;
  top: number;
}

/** The tower a spiral turns round. */
export interface TowerPiece {
  kind: 'tower';
  /** Centre of the spiral (y: the tower's mid-height). */
  center: Vector3;
  /** Radius of the spiral's riding line. */
  rideRadius: number;
  /** The tower's own radius, clear inside every ramp of the spiral. */
  radius: number;
  bottom: number;
  top: number;
}

export type Piece = RampPiece | PadPiece | BoosterPiece | GatePiece | WallPiece | TowerPiece;

export interface SpawnPoint {
  pos: Vector3;
  heading: number;
  /** Horizontal speed along `heading` on (re)spawning; 0 at the start. */
  speed: number;
}

export interface CourseLayout {
  /** Segments as built, including auto-inserted checkpoints. */
  segments: Segment[];
  pieces: Piece[];
  path: TrackPath;
  spawn: SpawnPoint;
  /** Respawn points: [0] is the start, then one per checkpoint gate. */
  checkpoints: SpawnPoint[];
}

export const PAD_THICKNESS = 64;
export const START_PAD = { width: 1000, length: 700 } as const;
export const FINISH_PAD = { width: 1800, length: 2600, wallHeight: 900 } as const;
export const BOOSTER = { width: 1000, depth: 300, offset: 200, length: 500, margin: 350 } as const;
/** Checkpoint arches: wide and tall enough that nobody on a sane line misses one. */
export const GATE = { width: 2600, above: 900, below: 600, depth: 400 } as const;
/** Respawns land you this far down the ramp after a checkpoint. */
const RESPAWN_ALONG = 250;

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
/** Finish pad left past the fastest rider's landing point. */
const FINISH_OVERRUN = 900;
/** A sideways transfer clears the face by this much for a rider who flies straight on. */
const TRANSFER_MISS_MARGIN = 150;
/** Sideways transfers never shift a ramp further than this, however long the fall. */
const MAX_TRANSFER_SHIFT = 2500;
/** Ramps after a pad start this far back, tucked under the pad, so there's no gap to fall through. */
const PAD_LEAD_IN = 300;
/** Vertical gap kept between a pad's underside and the ramp tucked beneath it. */
const PAD_UNDER_CLEARANCE = 40;
/** How far past the previous exit the next piece begins. */
const LEAD_FROM_RAMP = 120;
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
const PATH_SPACING = 150;
const KILL_WINDOW = 1500;
const KILL_MARGIN = 700;
/** A wall stands this far past the end of its ramp, clear of it. */
export const WALL_GATE_AFTER = 200;
/** Whatever follows a wall starts at least this far beyond it, so the wall never touches a ramp. */
const WALL_CLEARANCE = 500;
/** A walled ramp runs at least this far past the fastest rider's landing: time to settle, then line up for the window. */
const WALL_SETTLE = 1200;
const WALL_RUNOUT = 900;
/**
 * ...and long enough that a rider far faster than the speed model's fastest (who lands late) still
 * gets this long on the face to line up: at 4,000 u/s a bot landed a quarter-second before the wall.
 */
const WALL_LINEUP_TIME = 0.9;
const FASTEST_RIDER = DEFAULT_PHYSICS.maxVelocity * 1.2;
/** Windows sit low on the face (this fraction of its width from the ridge) or high, a little above the riding line. */
const WINDOW_LOW = 0.56;
const WINDOW_HIGH_MIN = 0.12;
/** On a two-sided ridge riders ride this far down either face (the bot does too); its window is centred on the ridge. */
export const RIDGE_RIDE = 120;
/** At speed, riders who don't air-strafe ride this much below their line... */
const CAUTIOUS_SAG = 60;
/** ...and sag this much further down a two-sided ridge's face. */
const CAUTIOUS_RIDGE_SAG = 150;
/** The window reaches this far below the lowest feet in it (riders drop a little after leaving the ramp), and this far above the highest head. */
const WINDOW_FLOOR = 250;
const WINDOW_HEADROOM = 100;
/** The wall reaches this far beyond the ramp's faces, below its base and above the riding line. */
const WALL_REACH = 1400;
const WALL_BELOW = 800;
const WALL_ABOVE = 1600;
/** A spiral's riding line passes at least this far (beyond a ramp's height) under its own start. */
const SPIRAL_CLEARANCE = 1200;
/** A spiral's gaps span at most this fraction of what its slowest rider flies while falling between ramps. */
const SPIRAL_REACH = 0.6;
/** Room between a spiral's tower and the inside of its ramps, and how far it reaches above and below them. */
const TOWER_GAP = 250;
const TOWER_ABOVE = 1500;
const TOWER_BELOW = 2500;

export function forwardOf(heading: number, out = new Vector3()): Vector3 {
  return out.set(-Math.sin(heading), 0, -Math.cos(heading));
}

export function rightOf(heading: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(heading), 0, -Math.sin(heading));
}

/** How long a ramp with a wall past its end must be, to give every rider time to line up for its window. */
function wallRunUp(fastLanding: number, front: number, flight: number): number {
  return Math.max(fastLanding - front + WALL_SETTLE + WALL_RUNOUT, FASTEST_RIDER * (flight + WALL_LINEUP_TIME) - front);
}

/**
 * The wall past the end of ramp `ramp`. Its window is `w` either side of a
 * point on the face: low down it, or high just above the riding line
 * (alternating), or round the ridge of a two-sided ramp. Riders fly on from
 * where they leave the face, so that's where they cross the wall.
 */
function wallPast(
  ramp: number,
  end: RidePoint,
  shape: { side: RampSide; faceWidth: number; ride: number; theta: number; peakAboveRide: number; height: number },
  w: number,
  index: number,
  /** Built for riders who don't air-strafe (easy, medium): at speed they skim the face and can't climb much. */
  cautious: boolean,
): WallPiece {
  const { side, faceWidth, ride, theta, peakAboveRide, height } = shape;
  const tanTheta = Math.tan(theta);
  const pos = end.pos.clone().addScaledVector(forwardOf(end.heading), WALL_GATE_AFTER);
  pos.y = end.pos.y;
  let target: number;
  let windowLeft: number;
  let windowRight: number;
  let lowestFeet: number;
  let highestFeet: number;
  if (side === 'both') {
    target = 0;
    const reach = RIDGE_RIDE + w + (cautious ? CAUTIOUS_RIDGE_SAG : 0);
    windowLeft = -reach;
    windowRight = reach;
    lowestFeet = end.pos.y - reach * tanTheta;
    highestFeet = end.pos.y;
  } else {
    // High windows sit half a window above the riding line: riding within ~70 of the ridge tips you over it.
    // (For cautious riders, "high" is tight round the riding line itself: they can't climb much at speed.)
    const high = cautious ? ride + CAUTIOUS_SAG : Math.max(WINDOW_HIGH_MIN * faceWidth, ride - w / 2);
    target = index % 2 === 0 ? WINDOW_LOW * faceWidth : high;
    // The face runs away from the ridge: to the left of a right-hand ramp, to the right of a left-hand one.
    const sign = side === 'right' ? 1 : -1;
    const lateral = (fromRidge: number): number => sign * (ride - fromRidge);
    windowLeft = Math.min(lateral(target - w), lateral(target + w));
    windowRight = Math.max(lateral(target - w), lateral(target + w));
    const feet = (fromRidge: number): number => end.pos.y + (ride - fromRidge) * tanTheta;
    lowestFeet = feet(target + w);
    highestFeet = feet(target - w);
  }
  return {
    kind: 'wall',
    ramp,
    pos,
    heading: end.heading,
    target,
    windowLeft,
    windowRight,
    windowBottom: lowestFeet - WINDOW_FLOOR,
    windowTop: highestFeet + PLAYER_HEIGHT + WINDOW_HEADROOM,
    halfWidth: faceWidth + WALL_REACH,
    bottom: end.pos.y + peakAboveRide - height - WALL_BELOW,
    top: end.pos.y + peakAboveRide + WALL_ABOVE,
  };
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
  /** The ramp just left (null after a pad): which way its ridge was, tan of its angle, and its face width. */
  prevRamp: { side: RampSide; tanTheta: number; faceWidth: number } | null;
  speed: SpeedRange;
  floorY: number;
  /** Slope of the ramp just left, radians downhill (negative: it climbed, so you leave it rising). 0 after a pad. */
  exitPitch: number;
  /** A wall stands just past the end of the ramp just left: what follows keeps clear of it. */
  wallBehind: boolean;
}

/**
 * A ramp laid on a circle (a spiral) rather than straight ahead: its riding
 * line runs from angle `start` to `start + span` round `center`, turning
 * `dir` (+1 left, −1 right); `h0` is the heading at angle 0.
 */
interface Arc {
  center: Vector3;
  radius: number;
  dir: 1 | -1;
  h0: number;
  start: number;
  span: number;
  /** Least drop into this ramp (spirals pass under their own start). */
  minDrop: number;
}

function arcPoint(arc: Arc, angle: number, out = new Vector3()): Vector3 {
  return rightOf(arc.h0 + arc.dir * angle, out).multiplyScalar(arc.dir * arc.radius).add(arc.center);
}

/** The heading of a horizontal direction (inverse of forwardOf). */
function headingOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Which way (+1 right, −1 left) the next ramp is shifted on a course with
 * sideways transfers: toward the side you fly off the last ramp, like the
 * zig-zag of a surf map. A ramp on your right (hold D) has its face sloping
 * away to the left, so you leave it leftward. Two-sided ridges alternate.
 */
function transferSide(prev: RampSide, count: number): number {
  if (prev === 'right') return -1;
  if (prev === 'left') return 1;
  return count % 2 === 0 ? 1 : -1;
}

export function planCourse(course: Course): CourseLayout {
  const diff = DIFFICULTY[course.difficulty];

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
  const spawn: SpawnPoint = { pos: new Vector3(0, 0, START_PAD.length * 0.6), heading: 0, speed: 0 };
  checkpoints.push(spawn);
  for (let z = START_PAD.length; z > 0; z -= PATH_SPACING) path.add(new Vector3(0, 0, z), 0, 0, -PAD_THICKNESS);

  const cursor: Cursor = {
    pos: new Vector3(0, 0, 0),
    heading: 0,
    from: 'pad',
    prevRamp: null,
    speed: { ...START_SPEED },
    floorY: -PAD_THICKNESS,
    exitPitch: 0,
    wallBehind: false,
  };
  let pendingGap = 0;
  let pendingDrop = 0;
  /** A checkpoint is waiting for the next ramp: its gate spans the flight into it. */
  let pendingCheckpoint = false;
  /** A wall is waiting to stand past the end of the next ramp. */
  let pendingWall = false;
  /** Walls so far (their windows alternate low and high). */
  let walls = 0;
  let rampsSinceCheckpoint = 0;
  /** Sideways transfers so far (two-sided ridges alternate their direction). */
  let transfers = 0;

  /**
   * Size the flight from the cursor to the next piece and consume pending
   * gaps/drops. `minDrop` is how far below the exit the next piece's entry
   * must be for its highest point to stay clear of a cautious rider.
   */
  /** Past a wall, the flight to the next piece is long enough for that piece to start well beyond it. */
  const clearWall = (): void => {
    if (cursor.wallBehind) pendingGap = Math.max(pendingGap, WALL_GATE_AFTER + WALL_CLEARANCE - LEAD_FROM_RAMP);
  };

  const transition = (minDrop: number, minAirTime = 0): { drop: number; front: number; fastLanding: number; airTime: number } => {
    clearWall();
    const fromPad = cursor.from === 'pad';
    // Leaving a climb you're still rising (negative downward speed): more time in the air.
    const sinExit = fromPad ? 0 : Math.sin(cursor.exitPitch);
    const vLo = fromPad ? WALK_SPEED : cursor.speed.lo;
    const vyLo = vLo * sinExit;
    const vHi = Math.max(cursor.speed.hi, vLo);
    const vyHi = vHi * sinExit;
    const base = Math.max(fromPad ? DROP_FROM_PAD : DROP_FROM_RAMP, minDrop);
    // Deep enough that even the fastest rider (who starts falling fastest) gets minAirTime.
    const drop = Math.max(
      base + pendingDrop + Math.max(0, fallAfter(vLo, vyLo, pendingGap)),
      vyHi * minAirTime + 0.5 * PLAN_GRAVITY * minAirTime ** 2,
    );
    // From a pad the next piece starts right at the edge (ramps tuck under it);
    // from a ramp there's a short lead so the exit and entry never overlap.
    const front = pendingGap + (fromPad ? 0 : LEAD_FROM_RAMP);
    const t = (-vyHi + Math.sqrt(vyHi * vyHi + 2 * PLAN_GRAVITY * drop)) / PLAN_GRAVITY;
    pendingGap = 0;
    pendingDrop = 0;
    cursor.speed = afterFall(cursor.speed, drop);
    return { drop, front, fastLanding: vHi * t, airTime: t };
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

  const placeRamp = (seg: RampSegment, arc: Arc | null = null): void => {
    const theta = MathUtils.degToRad(seg.angle);
    let pitchDeg = rampPitchDeg(seg, course.difficulty);
    let tanPitch = Math.tan(MathUtils.degToRad(pitchDeg));
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
      ? peakAboveRide + Math.max(0, leadIn * tanPitch) + PAD_THICKNESS + PAD_UNDER_CLEARANCE
      : peakAboveRide + RIDGE_CLEARANCE + slideDrop;
    const entrySpeed = cursor.speed.lo;
    // Hard courses: the ramp sits off to the side, so you air-strafe across to it. Far
    // enough that a rider who doesn't misses the whole face; near enough to be a fixed
    // fraction of what a perfect air-strafe could cover in the time spent in the air.
    // (A spiral's ramps sit on its circle instead, and its transfers cut across it.)
    // Not right after a wall: you fly straight through its window, and that's this jump's challenge.
    const transfer = arc === null && prev !== null && diff.transferReach > 0 && !cursor.wallBehind;
    // In t seconds a perfect air-strafe moves you AIR_STRAFE_REACH·t² sideways, but never
    // faster than you're going: a slow rider turning out and back again covers about v·t/2.
    // (Never below walking pace: a stalled rider would make every transfer infinitely long.)
    const vSlow = fromPad ? WALK_SPEED : Math.max(WALK_SPEED, cursor.speed.lo);
    const reachIn = (t: number): number => diff.transferReach * Math.min(AIR_STRAFE_REACH * t * t, 0.5 * vSlow * t);
    const missFace = (seg.side === 'both' ? faceWidth : faceWidth * (1 - RIDE_FRACTION)) + TRANSFER_MISS_MARGIN;
    const airTime = transfer
      ? Math.max(diff.transferAirTime, Math.sqrt(missFace / (diff.transferReach * AIR_STRAFE_REACH)), missFace / (diff.transferReach * 0.5 * vSlow))
      : arc !== null && prev !== null
        ? diff.transferAirTime
        : 0;
    const { drop, front, fastLanding, airTime: flight } = transition(Math.max(minDrop, arc?.minDrop ?? 0), airTime);
    const length = arc
      ? arc.radius * arc.span
      : Math.min(MAX_RAMP_LENGTH, Math.max(seg.length, fastLanding - front + MIN_RIDE, pendingWall ? wallRunUp(fastLanding, front, flight) : 0));
    if (pitchDeg < 0 && length > seg.length) {
      // A climb stretched to catch fast riders climbs further than the validator planned for: ease
      // it, like the validator does, until a cautious rider still has MIN_CLIMB_SPEED at the top
      // (an AI course's 1750-long climb, stretched to 7263, stopped the rider dead and broke the layout).
      const sin = (cursor.speed.lo ** 2 - MIN_CLIMB_SPEED ** 2) / (2 * PLAN_GRAVITY * length);
      const maxClimb = sin > 0 ? MathUtils.radToDeg(Math.asin(Math.min(1, sin))) : 0;
      if (-pitchDeg > maxClimb) {
        pitchDeg = -maxClimb;
        tanPitch = Math.tan(MathUtils.degToRad(pitchDeg));
      }
    }
    const shift = transfer ? transferSide(prev.side, transfers++) * Math.min(MAX_TRANSFER_SHIFT, Math.max(missFace, reachIn(flight))) : 0;

    const heading0 = arc ? arc.h0 + arc.dir * arc.start : cursor.heading;
    const entry = arc
      ? arcPoint(arc, arc.start)
      : cursor.pos.clone().addScaledVector(forwardOf(cursor.heading, f), front).addScaledVector(rightOf(cursor.heading, f), shift);
    entry.y = cursor.pos.y - drop;

    let respawnIndex = -1;
    if (pendingCheckpoint) {
      // The gate hangs across the flight into this ramp, spanning everyone
      // from a rider leaving the last ridge to one diving onto this ramp.
      const top = cursor.pos.y + GATE.above;
      const bottom = entry.y - GATE.below;
      const dx = entry.x - cursor.pos.x;
      const dz = entry.z - cursor.pos.z;
      const center = new Vector3((cursor.pos.x + entry.x) / 2, (top + bottom) / 2, (cursor.pos.z + entry.z) / 2);
      pieces.push({
        kind: 'gate',
        index: checkpoints.length,
        center,
        // Square to the track; round a spiral, square to the chord across its gap. (Square to the chord
        // of a big sideways transfer, a gate faced almost sideways and riders flew past it.)
        heading: arc && Math.hypot(dx, dz) > 1 ? headingOf(dx, dz) : cursor.heading,
        width: GATE.width,
        height: top - bottom,
        depth: GATE.depth,
      });
      segments.push({ type: 'checkpoint' });
      respawnIndex = checkpoints.length;
      checkpoints.push(spawn); // placeholder, replaced once the ramp exists
      pendingCheckpoint = false;
    }

    const points: RidePoint[] = [];
    if (leadIn > 0) {
      // Straight lead-in tucked under the pad, continuing the ramp's slope backwards.
      const back = entry.clone().addScaledVector(forwardOf(heading0, f), -leadIn);
      back.y = entry.y + leadIn * tanPitch;
      points.push({ pos: back, heading: heading0, s: -leadIn });
    }
    // A ramp with a wall past it runs straight: on a bend, a fast rider can't hold the line its
    // window needs (they're flung over the ridge or slide down the face).
    const curveRad = arc ? arc.dir * arc.span : pendingWall ? 0 : MathUtils.degToRad(seg.curve);
    if (arc) {
      const sections = Math.max(2, Math.ceil(length / SECTION_SPACING));
      for (let i = 0; i <= sections; i++) {
        const s = (i * length) / sections;
        const angle = arc.start + s / arc.radius;
        const pos = arcPoint(arc, angle);
        pos.y = entry.y - s * tanPitch;
        points.push({ pos, heading: arc.h0 + arc.dir * angle, s });
      }
    } else {
      const straight = Math.min(length * MAX_STRAIGHT_FRACTION, Math.max(0, fastLanding - front + LANDING_STRAIGHT_MARGIN));
      const headingAt = (s: number): number =>
        cursor.heading + curveRad * Math.min(1, Math.max(0, (s - straight) / (length - straight)));
      const sections = Math.max(
        2,
        Math.ceil(length / SECTION_SPACING),
        Math.ceil(Math.abs(seg.curve) / MAX_SECTION_TURN_DEG / (1 - straight / length)),
      );
      const ds = length / sections;
      const p = entry.clone();
      for (let i = 0; i <= sections; i++) {
        const s = i * ds;
        points.push({ pos: p.clone(), heading: headingAt(s), s });
        if (i < sections) {
          p.addScaledVector(forwardOf(headingAt(s + ds / 2), f), ds);
          p.y = entry.y - (s + ds) * tanPitch;
        }
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

    if (respawnIndex >= 0) {
      // Respawn on this ramp's face, already moving at the speed a cautious
      // rider would have here, so the rest of the course stays beatable.
      const at = ridden.find((pt) => pt.s >= RESPAWN_ALONG) ?? ridden[0]!;
      const pos = at.pos.clone();
      if (seg.side === 'both') {
        // The riding line is the ridge; put the rider on the right-hand face instead.
        const d = RIDE_FRACTION * faceWidth;
        pos.addScaledVector(rightOf(at.heading, f), d);
        pos.y -= r * (1 - Math.cos(theta)) + (d - r * Math.sin(theta)) * Math.tan(theta);
      }
      checkpoints[respawnIndex] = { pos, heading: at.heading, speed: entrySpeed };
    }

    const last = points[points.length - 1]!;
    cursor.wallBehind = pendingWall;
    if (pendingWall) {
      const shape = { side: seg.side, faceWidth, ride, theta, peakAboveRide, height };
      pieces.push(wallPast(pieceIndex, last, shape, diff.windowSlack, walls++, diff.transferReach === 0));
      pendingWall = false;
    }
    cursor.pos.copy(last.pos);
    cursor.heading = arc ? arc.h0 + arc.dir * (arc.start + arc.span) : cursor.heading + curveRad;
    cursor.from = 'ramp';
    cursor.prevRamp = { side: seg.side, tanTheta: Math.tan(theta), faceWidth };
    cursor.speed = afterRamp(cursor.speed, length, pitchDeg);
    cursor.floorY = floorAt(last);
    cursor.exitPitch = MathUtils.degToRad(pitchDeg);
  };

  /** One ramp of the course, with a checkpoint gate before it if it's been a while. */
  const stepRamp = (seg: RampSegment, arc: Arc | null = null): void => {
    if (rampsSinceCheckpoint >= diff.rampsPerCheckpoint) pendingCheckpoint = true;
    if (pendingCheckpoint) rampsSinceCheckpoint = 0;
    placeRamp(seg, arc);
    rampsSinceCheckpoint++;
  };

  /**
   * One full turn of ramps round a tower. The first ramp starts straight ahead
   * like any other; the circle's centre is beside it, toward the turn. Each
   * transfer cuts a chord across the circle, so you air-strafe in toward the
   * next ramp. The turn ends heading the way it came in, below its own start
   * by at least a ramp's height plus SPIRAL_CLEARANCE.
   */
  const placeSpiral = (seg: SpiralSegment): void => {
    const dir = seg.turn === 'left' ? 1 : -1;
    const h0 = cursor.heading;
    clearWall();
    const front = pendingGap + (cursor.from === 'pad' ? 0 : LEAD_FROM_RAMP);
    const entry = cursor.pos.clone().addScaledVector(forwardOf(h0, f), front);
    const center = entry.clone().addScaledVector(rightOf(h0, f), -dir * SPIRAL_RADIUS);
    const step = (2 * Math.PI) / seg.ramps;
    const prismHeight = Math.min(MAX_RAMP_HEIGHT, diff.faceWidth * Math.tan(MathUtils.degToRad(seg.angle)));
    const minDrop = (prismHeight + SPIRAL_CLEARANCE) / (seg.ramps - 1);
    // The gaps between its ramps never span more than its slowest rider covers while falling
    // from one to the next: off a start pad you're only walking.
    const slowest = cursor.from === 'pad' ? WALK_SPEED : cursor.speed.lo;
    const fallTime = Math.sqrt((2 * Math.max(DROP_FROM_RAMP, minDrop)) / PLAN_GRAVITY);
    const chord = SPIRAL_REACH * slowest * fallTime;
    const gap = Math.min(MathUtils.degToRad(SPIRAL_GAP_DEG), 2 * Math.asin(Math.min(1, chord / (2 * SPIRAL_RADIUS))));
    const first = pieces.length;
    for (let k = 0; k < seg.ramps; k++) {
      // The last ramp closes the gap back round to where the turn began.
      const span = k === seg.ramps - 1 ? 2 * Math.PI - k * step : step - gap;
      // Ridge toward the tower: you hold the key that points at it.
      const ramp: RampSegment = { type: 'ramp', length: SPIRAL_RADIUS * span, angle: seg.angle, side: seg.turn, curve: (dir * span * 180) / Math.PI, pitch: SPIRAL_PITCH_DEG };
      // A checkpoint halfway round: the spiral ends right under where it starts, and without
      // one you could drop straight down and skip it (user, Oct 8 2026, on Spire).
      if (k === Math.floor(seg.ramps / 2)) pendingCheckpoint = true;
      stepRamp(ramp, { center, radius: SPIRAL_RADIUS, dir, h0, start: k * step, span, minDrop: k === 0 ? 0 : minDrop });
    }
    const arcs = pieces.slice(first).filter((p): p is RampPiece => p.kind === 'ramp');
    const inner = Math.min(...arcs.map((a) => SPIRAL_RADIUS - Math.abs(a.centerOffset) - a.faceWidth));
    const top = arcs[0]!.points[0]!.pos.y + TOWER_ABOVE;
    const lastArc = arcs[arcs.length - 1]!;
    const bottom = lastArc.points[lastArc.points.length - 1]!.pos.y - lastArc.height - TOWER_BELOW;
    pieces.push({
      kind: 'tower',
      center: new Vector3(center.x, (top + bottom) / 2, center.z),
      rideRadius: SPIRAL_RADIUS,
      radius: inner - TOWER_GAP,
      bottom,
      top,
    });
  };

  const placeFinish = (): void => {
    // A rider who slid down the last ramp arrives low; keep the pad's front edge under them.
    const prev = cursor.prevRamp;
    // Low enough to catch a rider who slid half a face down the last ramp (at top speed, round its curve).
    const { drop, front, fastLanding } = transition(prev ? (SLIDE_TOLERANCE + prev.faceWidth / 2) * prev.tanTheta + RIDGE_CLEARANCE : 0);
    // Long enough that the fastest rider comes down on it, not over the far wall.
    const length = Math.max(FINISH_PAD.length, fastLanding - front + FINISH_OVERRUN);
    const fwd = forwardOf(cursor.heading);
    const frontEdge = cursor.pos.clone().addScaledVector(fwd, front);
    frontEdge.y = cursor.pos.y - drop;
    const center = frontEdge.clone().addScaledVector(fwd, length / 2);
    const pieceIndex = pieces.length;
    pieces.push({ kind: 'pad', role: 'finish', center, heading: cursor.heading, width: FINISH_PAD.width, length });

    const floorY = frontEdge.y - PAD_THICKNESS;
    addFlightPath(frontEdge, pieceIndex, floorY);
    for (let d = 0; d <= length; d += PATH_SPACING) {
      path.add(frontEdge.clone().addScaledVector(fwd, d), cursor.heading, pieceIndex, floorY);
    }
  };

  const placeBooster = (strength: number): void => {
    const fromPad = cursor.from === 'pad';
    const vLo = fromPad ? WALK_SPEED : cursor.speed.lo;
    const vyLo = fromPad ? 0 : vLo * Math.sin(cursor.exitPitch);
    // Clear of a wall standing just past the ramp we left.
    const clearOfWall = cursor.wallBehind ? WALL_GATE_AFTER + BOOSTER.depth : 0;
    const along = pendingGap + BOOSTER.offset + clearOfWall;
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
    pendingGap += BOOSTER.length + clearOfWall;
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
        // Becomes a gate over the flight into the next ramp. A checkpoint with
        // no ramp after it would guard nothing, so it's simply never placed.
        pendingCheckpoint = true;
        break;
      case 'wall':
        // Stands across the next ramp, once we know where riders land on it.
        pendingWall = true;
        segments.push(seg);
        break;
      case 'ramp':
        stepRamp(seg);
        break;
      case 'spiral':
        placeSpiral(seg);
        break;
    }
  }
  placeFinish();
  path.finish(KILL_WINDOW, KILL_MARGIN);

  return { segments, pieces, path, spawn, checkpoints };
}
