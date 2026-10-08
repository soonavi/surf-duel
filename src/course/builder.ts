/**
 * Course builder: spec → validated course → layout → geometry + triggers.
 * Deterministic: the same input always yields the same course. Never throws on
 * bad input (the validator repairs it first).
 */
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, MathUtils, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Course, Segment } from './schema.js';
import { validateCourse } from './validator.js';
import type { TrackPath } from './path.js';
import {
  FINISH_PAD,
  PAD_THICKNESS,
  forwardOf,
  planCourse,
  rightOf,
  type BoosterPiece,
  type GatePiece,
  type PadPiece,
  type Piece,
  type RampPiece,
  type SpawnPoint,
  type TowerPiece,
  type WallPiece,
} from './layout.js';

export type { BoosterPiece, GatePiece, PadPiece, Piece, RampPiece, RidePoint, SpawnPoint, TowerPiece, WallPiece } from './layout.js';

export type TriggerKind = 'start' | 'checkpoint' | 'booster' | 'finish';

export interface Trigger {
  kind: TriggerKind;
  /** Checkpoint number (1-based; the start is 0) or booster number. */
  index: number;
  center: Vector3;
  heading: number;
  /** Half extents in track space: x lateral, y vertical, z along the track. */
  half: Vector3;
  /** Booster strength in u/s; 0 for other triggers. */
  strength: number;
}

/** Geometry per material slot, each with position, normal and uv. */
export interface CourseVisuals {
  /** Ramps you ride on the left face of (ramp on your right) — and 'both' ramps. */
  rampRight: BufferGeometry;
  /** Ramps on your left. */
  rampLeft: BufferGeometry;
  pads: BufferGeometry;
  finish: BufferGeometry;
  gates: BufferGeometry;
  boosters: BufferGeometry;
  /** Walls with windows, and the towers spirals turn round: solid, so they're in the collision too. */
  obstacles: BufferGeometry;
}

export interface BuiltCourse {
  course: Course;
  segments: Segment[];
  repairs: string[];
  pieces: Piece[];
  /** Position-only, world-space geometry for the collision BVH. */
  collision: BufferGeometry;
  visuals: CourseVisuals;
  triggers: Trigger[];
  checkpoints: SpawnPoint[];
  path: TrackPath;
  spawn: SpawnPoint;
  bounds: Box3;
}

const GATE = { post: 48, height: 700 } as const;
const TRIGGER_HEADROOM = 3000;

// ---------------------------------------------------------------------------
// Geometry helpers

class TriangleSoup {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];

  vertex(p: Vector3, n: Vector3, u: number, v: number): void {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    return g;
  }
}

function emptyGeometry(): BufferGeometry {
  return new TriangleSoup().toGeometry();
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  if (parts.length === 0) return emptyGeometry();
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('course builder: could not merge geometry');
  return merged;
}

/** Box oriented to a track heading, positioned by its centre. */
function orientedBox(w: number, h: number, d: number, center: Vector3, heading: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d).toNonIndexed();
  g.rotateY(heading);
  g.translate(center.x, center.y, center.z);
  return g;
}

/**
 * Swept triangular prism along the ramp's riding line. Faces get smooth
 * shading normals and ramp-local UVs (u = distance along, v = distance down
 * the face from the ridge) so grid lines run with the ramp.
 */
function rampGeometry(piece: RampPiece): BufferGeometry {
  const soup = new TriangleSoup();
  const theta = MathUtils.degToRad(piece.angleDeg);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const slant = piece.height / sinT;
  const up = new Vector3(0, 1, 0);
  const down = new Vector3(0, -1, 0);

  const ridge: Vector3[] = [];
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  const nLeft: Vector3[] = [];
  const nRight: Vector3[] = [];
  const r = new Vector3();
  for (const pt of piece.points) {
    rightOf(pt.heading, r);
    const peak = pt.pos.clone().addScaledVector(r, piece.centerOffset);
    peak.y = pt.pos.y + piece.peakAboveRide;
    ridge.push(peak);
    left.push(peak.clone().addScaledVector(r, -piece.faceWidth).setY(peak.y - piece.height));
    right.push(peak.clone().addScaledVector(r, piece.faceWidth).setY(peak.y - piece.height));
    nLeft.push(r.clone().multiplyScalar(-sinT).addScaledVector(up, cosT).normalize());
    nRight.push(r.clone().multiplyScalar(sinT).addScaledVector(up, cosT).normalize());
  }

  for (let i = 0; i < piece.points.length - 1; i++) {
    const u0 = piece.points[i]!.s;
    const u1 = piece.points[i + 1]!.s;
    const [a, b, la, lb, ra, rb] = [ridge[i]!, ridge[i + 1]!, left[i]!, left[i + 1]!, right[i]!, right[i + 1]!];
    // Left face (outward = left/up).
    soup.vertex(a, nLeft[i]!, u0, 0);
    soup.vertex(lb, nLeft[i + 1]!, u1, slant);
    soup.vertex(la, nLeft[i]!, u0, slant);
    soup.vertex(a, nLeft[i]!, u0, 0);
    soup.vertex(b, nLeft[i + 1]!, u1, 0);
    soup.vertex(lb, nLeft[i + 1]!, u1, slant);
    // Right face (outward = right/up).
    soup.vertex(a, nRight[i]!, u0, 0);
    soup.vertex(ra, nRight[i]!, u0, slant);
    soup.vertex(rb, nRight[i + 1]!, u1, slant);
    soup.vertex(a, nRight[i]!, u0, 0);
    soup.vertex(rb, nRight[i + 1]!, u1, slant);
    soup.vertex(b, nRight[i + 1]!, u1, 0);
    // Bottom.
    soup.vertex(la, down, u0, slant);
    soup.vertex(lb, down, u1, slant);
    soup.vertex(rb, down, u1, slant);
    soup.vertex(la, down, u0, slant);
    soup.vertex(rb, down, u1, slant);
    soup.vertex(ra, down, u0, slant);
  }

  const n = piece.points.length - 1;
  const back = forwardOf(piece.points[0]!.heading).negate();
  soup.vertex(ridge[0]!, back, 0, 0);
  soup.vertex(left[0]!, back, 0, slant);
  soup.vertex(right[0]!, back, 0, slant);
  const ahead = forwardOf(piece.points[n]!.heading);
  const uEnd = piece.points[n]!.s;
  soup.vertex(ridge[n]!, ahead, uEnd, 0);
  soup.vertex(right[n]!, ahead, uEnd, slant);
  soup.vertex(left[n]!, ahead, uEnd, slant);

  return soup.toGeometry();
}

function padGeometry(pad: PadPiece): BufferGeometry {
  const center = pad.center.clone().setY(pad.center.y - PAD_THICKNESS / 2);
  return orientedBox(pad.width, PAD_THICKNESS, pad.length, center, pad.heading);
}

function finishWallGeometry(pad: PadPiece): BufferGeometry {
  const fwd = forwardOf(pad.heading);
  const center = pad.center.clone().addScaledVector(fwd, pad.length / 2 + PAD_THICKNESS / 2);
  center.y = pad.center.y + FINISH_PAD.wallHeight / 2 - PAD_THICKNESS;
  return orientedBox(pad.width, FINISH_PAD.wallHeight + PAD_THICKNESS, PAD_THICKNESS, center, pad.heading);
}

/** Two posts and a crossbar across the front edge of a pad. */
function gateGeometry(pad: PadPiece): BufferGeometry[] {
  const fwd = forwardOf(pad.heading);
  const r = rightOf(pad.heading);
  const front = pad.center.clone().addScaledVector(fwd, -pad.length / 2);
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const c = front.clone().addScaledVector(r, side * (pad.width / 2 + GATE.post / 2));
    c.y = pad.center.y + GATE.height / 2;
    parts.push(orientedBox(GATE.post, GATE.height, GATE.post, c, pad.heading));
  }
  const bar = front.clone().setY(pad.center.y + GATE.height);
  parts.push(orientedBox(pad.width + GATE.post * 2, GATE.post, GATE.post, bar, pad.heading));
  return parts;
}

/** Checkpoint arch: two tall posts and a crossbar, framing the flight into the next ramp. */
function checkpointArchGeometry(g: GatePiece): BufferGeometry[] {
  const r = rightOf(g.heading);
  const post = 64;
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(orientedBox(post, g.height, post, g.center.clone().addScaledVector(r, (side * g.width) / 2), g.heading));
  }
  const top = g.center.clone();
  top.y += g.height / 2;
  parts.push(orientedBox(g.width + post, post, post, top, g.heading));
  return parts;
}

/** Frame around the booster gate plus three forward-pointing chevrons. */
function boosterGeometry(b: BoosterPiece): BufferGeometry[] {
  const r = rightOf(b.heading);
  const fwd = forwardOf(b.heading);
  const t = 36;
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(orientedBox(t, b.height, t, b.center.clone().addScaledVector(r, (side * b.width) / 2), b.heading));
  }
  for (const side of [-1, 1]) {
    const c = b.center.clone();
    c.y += (side * b.height) / 2;
    parts.push(orientedBox(b.width, t, t, c, b.heading));
  }
  // Chevrons: two bars each, angled back from a forward tip, stacked along the gate.
  const armLength = 260;
  const armAngle = MathUtils.degToRad(35);
  for (const along of [-180, 0, 180]) {
    const tip = b.center.clone().addScaledVector(fwd, along + armLength / 2);
    for (const side of [-1, 1]) {
      const yaw = b.heading + side * armAngle;
      const armCenter = tip.clone().addScaledVector(forwardOf(yaw), -armLength / 2);
      parts.push(orientedBox(t * 1.5, t / 2, armLength, armCenter, yaw));
    }
  }
  return parts;
}

const WALL_THICKNESS = 60;

/** Four panels round the window: either side of it full height, and above and below it. */
function wallGeometry(w: WallPiece): BufferGeometry[] {
  const r = rightOf(w.heading);
  const panel = (lateralFrom: number, lateralTo: number, bottom: number, top: number): BufferGeometry => {
    const center = w.pos.clone().addScaledVector(r, (lateralFrom + lateralTo) / 2);
    center.y = (bottom + top) / 2;
    return orientedBox(lateralTo - lateralFrom, top - bottom, WALL_THICKNESS, center, w.heading);
  };
  return [
    panel(-w.halfWidth, w.windowLeft, w.bottom, w.top),
    panel(w.windowRight, w.halfWidth, w.bottom, w.top),
    panel(w.windowLeft, w.windowRight, w.windowTop, w.top),
    panel(w.windowLeft, w.windowRight, w.bottom, w.windowBottom),
  ];
}

function towerGeometry(t: TowerPiece): BufferGeometry {
  const g = new CylinderGeometry(t.radius, t.radius, t.top - t.bottom, 48, 1).toNonIndexed();
  g.translate(t.center.x, (t.top + t.bottom) / 2, t.center.z);
  return g;
}

function positionsOnly(g: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  out.setAttribute('position', g.getAttribute('position').clone());
  return out;
}

// ---------------------------------------------------------------------------

export function buildCourse(input: unknown): BuiltCourse {
  const { course, repairs } = validateCourse(input);
  const layout = planCourse(course);

  const rampRight: BufferGeometry[] = [];
  const rampLeft: BufferGeometry[] = [];
  const pads: BufferGeometry[] = [];
  const finish: BufferGeometry[] = [];
  const gates: BufferGeometry[] = [];
  const boosters: BufferGeometry[] = [];
  const obstacles: BufferGeometry[] = [];
  const triggers: Trigger[] = [];
  let boosterNo = 0;

  for (const piece of layout.pieces) {
    switch (piece.kind) {
      case 'ramp':
        (piece.side === 'left' ? rampLeft : rampRight).push(rampGeometry(piece));
        break;
      case 'wall':
        obstacles.push(...wallGeometry(piece));
        break;
      case 'tower':
        obstacles.push(towerGeometry(piece));
        break;
      case 'booster':
        boosters.push(...boosterGeometry(piece));
        triggers.push({
          kind: 'booster',
          index: boosterNo++,
          center: piece.center.clone(),
          heading: piece.heading,
          half: new Vector3(piece.width / 2, piece.height / 2, piece.depth / 2),
          strength: piece.strength,
        });
        break;
      case 'gate':
        gates.push(...checkpointArchGeometry(piece));
        // Checkpoints count only in order, so the trigger reaches far above the arch: a fast rider
        // flying clean over it still passed it. (Skipping a spiral means dropping far from its gate.)
        triggers.push({
          kind: 'checkpoint',
          index: piece.index,
          center: piece.center.clone().setY(piece.center.y + TRIGGER_HEADROOM / 2),
          heading: piece.heading,
          half: new Vector3(piece.width / 2, (piece.height + TRIGGER_HEADROOM) / 2, piece.depth / 2),
          strength: 0,
        });
        break;
      case 'pad': {
        if (piece.role === 'finish') {
          finish.push(padGeometry(piece), finishWallGeometry(piece));
        } else {
          pads.push(padGeometry(piece));
        }
        gates.push(...gateGeometry(piece));
        // The finish volume is tall, so flying clean over the pad still counts.
        const isFinish = piece.role === 'finish';
        const bottom = piece.center.y - 150;
        const top = piece.center.y + TRIGGER_HEADROOM;
        triggers.push({
          kind: piece.role,
          index: 0,
          center: piece.center.clone().setY((top + bottom) / 2),
          heading: piece.heading,
          half: new Vector3(piece.width / 2 + (isFinish ? 300 : 0), (top - bottom) / 2, piece.length / 2 + (isFinish ? 100 : 0)),
          strength: 0,
        });
        break;
      }
    }
  }

  const visuals: CourseVisuals = {
    rampRight: merge(rampRight),
    rampLeft: merge(rampLeft),
    pads: merge(pads),
    finish: merge(finish),
    gates: merge(gates),
    boosters: merge(boosters),
    obstacles: merge(obstacles),
  };
  const collision = merge([visuals.rampRight, visuals.rampLeft, visuals.pads, visuals.finish, visuals.obstacles].map(positionsOnly));
  collision.computeBoundingBox();
  const bounds = collision.boundingBox?.clone() ?? new Box3();

  return {
    course,
    segments: layout.segments,
    repairs,
    pieces: layout.pieces,
    collision,
    visuals,
    triggers,
    checkpoints: layout.checkpoints,
    path: layout.path,
    spawn: layout.spawn,
    bounds,
  };
}
