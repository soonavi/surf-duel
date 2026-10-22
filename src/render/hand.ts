/**
 * A gloved right hand with jointed fingers and thumb (user, Oct 14 2026: "the
 * hand doesnt move and needs to"), sculpted from lofts (Oct 22: it was "still
 * a little boxy and undeveloped"): a palm that wraps the grip, tapered fingers
 * with knuckles and fuller pads underneath, a thumb on a fleshy base, padded
 * panels, a strapped cuff, and a sleeve. The fingers wrap round whatever's
 * held, whatever its thickness (`fit`), and open or squeeze (`pose`).
 *
 * Frame: the held thing's grip runs up +Y through the origin. The back of the
 * hand is to the right (+X); the fingers wrap across the front (−Z) and round
 * the left, and the thumb comes over the near side (+Z). You see it from
 * behind and to the left, like a shooter's view model.
 */
import * as THREE from 'three';
import { canvasTexture, loft, mesh, seeded, standard, type LoftRing } from './modelKit.js';

const DEG = Math.PI / 180;

interface Digit {
  /** Sits at the knuckle; the joints hang from it. */
  base: THREE.Group;
  /** The joint nodes, knuckle first: each turns about Y; its segment lies along its local −X. */
  joints: THREE.Group[];
  lengths: number[];
  /** Which way round the grip it wraps (seen from above): −1 clockwise (the fingers), +1 the thumb. */
  wrap: number;
  /** Gripping angles (knuckle direction, then bends) for the current fit. */
  grip: number[];
}

/** Index to little finger: knuckle height, where the knuckle sits round the grip, segment lengths (knuckle to tip), thickness. */
const FINGERS: { y: number; at: number; lengths: number[]; radius: number }[] = [
  { y: 0.026, at: -30 * DEG, lengths: [0.032, 0.024, 0.021], radius: 0.0088 },
  { y: 0.0085, at: -32 * DEG, lengths: [0.034, 0.025, 0.022], radius: 0.009 },
  { y: -0.009, at: -34 * DEG, lengths: [0.032, 0.024, 0.021], radius: 0.0086 },
  { y: -0.0255, at: -36 * DEG, lengths: [0.027, 0.02, 0.018], radius: 0.0078 },
];
/** How much a gripping glove finger squashes against the grip. */
const SQUASH = 0.92;
/** The thumb's two bones beyond its base, its thickness, and the height it wraps at (over the index finger). */
const THUMB = { lengths: [0.027, 0.023], radius: 0.0098, y: 0.028 };
/** Its base, deep in the heel of the palm (angle round the grip, distance out from it, height)... */
const THUMB_ROOT = { at: 34 * DEG, out: 0.006, y: -0.002 };
/** ...and its knuckle, out over the index finger's back. */
const THUMB_KNUCKLE_AT = 76 * DEG;

/** Half the palm's thickness. Its middle runs this far out from the grip. */
const PALM_HALF = 0.012;
/**
 * The palm, top (index side) to bottom (little finger side): at each height,
 * where its front (the knuckles) and back (the heel) sit round the grip. The
 * heel reaches further back lower down: the grip runs across the palm, from
 * the index knuckle to the heel, as in a real hammer grip.
 */
const PALM_LEVELS: { y: number; front: number; back: number; size: number }[] = [
  { y: 0.034, front: -26, back: 20, size: 0.78 },
  { y: 0.026, front: -27, back: 26, size: 0.98 },
  { y: 0.009, front: -30, back: 34, size: 1 },
  { y: -0.009, front: -32, back: 42, size: 1 },
  { y: -0.023, front: -34, back: 50, size: 0.97 },
  { y: -0.031, front: -35, back: 54, size: 0.82 },
];
/** The wrist leaves the heel this way, toward the sleeve: down, toward you and a little out. */
const FOREARM = new THREE.Vector3(0.2, -0.78, 0.6).normalize();
/** Where along the wrist (from inside the heel) the glove's cuff flares, its strap sits, and the sleeve begins. */
const WRIST_START = { at: 40 * DEG, y: -0.016 };
const STRAP = [0.049, 0.061];
const SLEEVE_STARTS = 0.067;

/** An open hand: fingers pointing forward and left, barely bent; the thumb out to the side. */
const OPEN_KNUCKLE = -70 * DEG;
const OPEN_BEND = 0.12;
const OPEN_THUMB = 70 * DEG;

export interface HandRig {
  group: THREE.Group;
  /** The glove's strap, coloured to match the course. */
  cuff: THREE.MeshStandardMaterial;
  /** The sleeve, starting at its opening and running up `forearm`: the view model places it. */
  sleeve: THREE.Group;
  /** Where the sleeve's opening sits round the glove's cuff (in the hand's frame, for the current fit). */
  wristPoint: THREE.Vector3;
  /** Which way the forearm runs from there, at rest. */
  readonly forearm: THREE.Vector3;
  /** Wrap the fingers round a grip this thick (radius, metres). */
  fit(radius: number): void;
  /** 0 gripping, 1 open, negative squeezing tighter. */
  pose(open: number): void;
}

/** The angle a segment of length `l` spans on a circle of radius `r`. */
function spans(l: number, r: number): number {
  return 2 * Math.asin(Math.min(1, l / (2 * r)));
}

/** An angle as the equivalent one in [−π, π). */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/** A point `out` from the grip's axis at angle `at` round it (0 right, −90° front), at height `y`. */
function around(at: number, out: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(out * Math.cos(at), y, out * Math.sin(at));
}

/**
 * One bone's worth of glove finger, along −X from its joint: a rounded
 * knuckle at each end, a slimmer waist, a fuller pad underneath, and the back
 * (toward `back`) a little flatter. A fingertip ends in a longer, rounder cap.
 */
function phalanx(length: number, r0: number, r1: number, tip: boolean, back: THREE.Vector3): THREE.BufferGeometry {
  const across = new THREE.Vector3(0, 1, 0);
  const r = (k: number) => r0 + (r1 - r0) * k;
  const ring = (k: number, x: number, w: number, top: number, bottom: number): LoftRing => ({
    at: new THREE.Vector3(-x, 0, 0),
    across,
    up: back,
    width: r(k) * w,
    top: r(k) * top,
    bottom: r(k) * bottom,
  });
  // A bone's far end tucks just inside the next one's knuckle, so the two never shimmer where they meet.
  const rings = tip
    ? [ring(0, 0, 1, 0.9, 0.95), ring(0.4, length * 0.4, 0.95, 0.8, 0.98), ring(1, length - r1 * 1.15, 0.98, 0.78, 0.96)]
    : [ring(0, 0, 1, 0.9, 0.95), ring(0.5, length * 0.5, 0.93, 0.82, 0.97), ring(1, length, 0.93, 0.83, 0.88)];
  return loft(rings, { caps: [r0 * 0.95, tip ? r1 * 1.15 : r1 * 0.8], around: 18, steps: 4, squareness: 2.15 });
}

function buildDigit(lengths: number[], radius: number, wrap: number, glove: THREE.Material, tipMaterial: THREE.Material): Digit {
  const base = new THREE.Group();
  const back = new THREE.Vector3(0, 0, wrap < 0 ? -1 : 1);
  // Thick at the knuckle, thinner toward the tip.
  const radii = [1.04, 0.95, 0.9, 0.85].map((k) => radius * k);
  const joints: THREE.Group[] = [];
  let at: THREE.Object3D = base;
  lengths.forEach((l, i) => {
    const joint = new THREE.Group();
    if (i > 0) joint.position.set(-lengths[i - 1]!, 0, 0);
    at.add(joint);
    const tip = i === lengths.length - 1;
    joint.add(mesh(phalanx(l, radii[i]!, radii[i + 1]!, tip, back), tip ? tipMaterial : glove));
    joints.push(joint);
    at = joint;
  });
  return { base, joints, lengths, wrap, grip: [] };
}

/**
 * Point a digit's bones round the grip: the first from its knuckle to a
 * circle of radius `r` round the grip, the rest along it as chords.
 */
function wrapDigit(d: Digit, knuckle: THREE.Vector3, r: number): void {
  d.base.position.copy(knuckle);
  const points: [number, number][] = [[knuckle.x, knuckle.z]];
  const r0 = Math.hypot(knuckle.x, knuckle.z);
  const l0 = d.lengths[0]!;
  let theta: number;
  if (Math.abs(r0 - r) < l0 && l0 < r0 + r) {
    // Where a circle of the bone's length round the knuckle meets the grip's circle, the way it wraps.
    const a = (r * r - l0 * l0 + r0 * r0) / (2 * r0);
    const h = Math.sqrt(Math.max(0, r * r - a * a));
    const ux = knuckle.x / r0;
    const uz = knuckle.z / r0;
    theta = Math.atan2(a * uz + d.wrap * h * ux, a * ux - d.wrap * h * uz);
  } else {
    theta = Math.atan2(knuckle.z, knuckle.x) + d.wrap * spans(l0, r);
  }
  points.push([r * Math.cos(theta), r * Math.sin(theta)]);
  for (const l of d.lengths.slice(1)) {
    theta += d.wrap * spans(l, r);
    points.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  // A joint turned by φ points its bone (local −X) along (−cos φ, sin φ).
  const headings = points.slice(1).map(([x, z], k) => Math.atan2(z - points[k]![1], points[k]![0] - x));
  d.grip = headings.map((h, k) => (k === 0 ? h : wrapAngle(h - headings[k - 1]!)));
}

/** Between gripping (0) and open (1), the short way round; a squeeze (negative) bends every joint a little further. */
function setDigit(d: Digit, open: number, openKnuckle: number): void {
  d.joints.forEach((joint, i) => {
    const opened = i === 0 ? openKnuckle : -d.wrap * OPEN_BEND;
    const grip = i === 0 ? opened + wrapAngle((d.grip[0] ?? 0) - opened) : (d.grip[i] ?? 0);
    joint.rotation.y = open >= 0 ? grip + (opened - grip) * open : i === 0 ? grip : grip * (1 - open * 0.6);
  });
}

/** The palm's outline at height `y`, eased between its levels. */
function palmLevel(y: number): { front: number; back: number; size: number } {
  const levels = PALM_LEVELS;
  const below = levels.findIndex((l) => l.y < y);
  const i = below < 0 ? levels.length - 2 : Math.max(0, Math.min(levels.length - 2, below - 1));
  const a = levels[i]!;
  const b = levels[i + 1]!;
  const k = Math.max(0, Math.min(1, (a.y - y) / (a.y - b.y)));
  return { front: a.front + (b.front - a.front) * k, back: a.back + (b.back - a.back) * k, size: a.size + (b.size - a.size) * k };
}

/**
 * The palm's cross-section at a height: across from the knuckles to the heel,
 * domed on the back, pressed flat against a grip of radius `radius`.
 */
function palmRing(level: { y: number; front: number; back: number; size: number }, radius: number): LoftRing {
  const mid = radius + PALM_HALF;
  const front = around(level.front * DEG, mid, level.y);
  const back = around(level.back * DEG, mid, level.y);
  const half = ((level.back - level.front) / 2) * DEG;
  const sag = mid * (1 - Math.cos(half));
  const centre = front.clone().add(back).multiplyScalar(0.5);
  const s = level.size;
  return {
    at: centre,
    across: back.clone().sub(front).normalize(),
    up: around(((level.front + level.back) / 2) * DEG, 1, 0),
    width: (front.distanceTo(back) / 2 + 0.0035) * (0.6 + 0.4 * s),
    top: (PALM_HALF + sag) * s,
    bottom: Math.max(0.002, PALM_HALF - sag - 0.0005) * s,
  };
}

/** A point on the back of the palm at height `y`, `k` of the way from the knuckles (0) to the heel (1). */
function palmBack(y: number, k: number, radius: number, squareness: number): { at: THREE.Vector3; ring: LoftRing } {
  const ring = palmRing({ y, ...palmLevel(y) }, radius);
  const x = (k * 2 - 1) * (ring.width - 0.0035);
  const lift = ring.top * Math.max(0, 1 - Math.abs(x / ring.width) ** squareness) ** (1 / squareness);
  return { at: ring.at.clone().addScaledVector(ring.across, x).addScaledVector(ring.up, lift), ring };
}

/** The glove's frame for a ring along the wrist: its width follows the hand's, its back faces out. */
function wristFrame(): { across: THREE.Vector3; up: THREE.Vector3 } {
  const across = new THREE.Vector3(0, 1, 0).addScaledVector(FOREARM, -FOREARM.y).normalize();
  const up = new THREE.Vector3().crossVectors(across, FOREARM).normalize();
  if (up.dot(around(WRIST_START.at, 1, 0)) < 0) up.negate();
  return { across, up };
}

/** The glove's fabric: a fine knit, as a bump map. */
function knit(): THREE.CanvasTexture {
  const texture = canvasTexture(64, 64, (ctx) => {
    const rand = seeded(11);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const rib = 0.5 + 0.5 * Math.sin(((x + (y % 4 < 2 ? 0 : 2)) / 4) * Math.PI);
        const v = Math.round(120 + 70 * rib + 50 * (rand() - 0.5));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

export function buildHand(): HandRig {
  const group = new THREE.Group();
  const glove = standard('#333844', 0.76);
  // Padded panels and fingertips, a shade lighter; the knuckle guard, hard rubber.
  const panel = standard('#4a5260', 0.6);
  const tips = standard('#404654', 0.68);
  const guard = standard('#22262e', 0.4, 0.05);
  const cuff = standard('#3ee6ff', 0.5, 0.1);
  const sleeveCloth = standard('#323848', 0.9, 0, { bumpMap: knit(), bumpScale: 0.3 });

  const fingers = FINGERS.map((f) => {
    const digit = buildDigit(f.lengths, f.radius, -1, glove, tips);
    group.add(digit.base);
    return { f, digit };
  });
  const thumb = buildDigit(THUMB.lengths, THUMB.radius, 1, glove, tips);
  group.add(thumb.base);

  // Everything that's shaped round the grip, rebuilt by `fit`.
  const shell = new THREE.Group();
  group.add(shell);

  const { across, up } = wristFrame();
  const sleeve = new THREE.Group();
  sleeve.add(mesh(sleeveGeometry(across, up), sleeveCloth));

  let openNow = 0;
  const rig: HandRig = {
    group,
    cuff,
    sleeve,
    wristPoint: new THREE.Vector3(),
    forearm: FOREARM,
    fit(radius: number) {
      for (const child of [...shell.children]) {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
        shell.remove(child);
      }

      // The palm: wrapped round the grip from the knuckles to the heel, rounded off at both edges.
      shell.add(mesh(loft(PALM_LEVELS.map((l) => palmRing(l, radius)), { caps: [0.007, 0.008], around: 28, steps: 5, squareness: 2.6 }), glove));

      // A padded panel across the back of the hand, softly domed.
      const panelRings = [0.019, 0.01, 0, -0.01, -0.019].map((y, i) => {
        const { at, ring } = palmBack(y, 0.52, radius, 2.6);
        const swell = [0.78, 0.96, 1, 0.96, 0.78][i]!;
        return { at: at.addScaledVector(ring.up, -0.0016), across: ring.across, up: ring.up, width: 0.0125 * swell, top: 0.0026 * swell, bottom: 0.0008 };
      });
      shell.add(mesh(loft(panelRings, { caps: [0.006, 0.006], around: 24, steps: 4, squareness: 2.2 }), panel));
      // A hard guard over the knuckles, raised over each one.
      const guardRings: LoftRing[] = [];
      for (let i = 0; i < FINGERS.length; i++) {
        const f = FINGERS[i]!;
        const next = FINGERS[i + 1];
        for (const [y, bump] of next ? [[f.y, 1], [(f.y + next.y) / 2, 0.55]] : [[f.y, 1]]) {
          const { at, ring } = palmBack(y!, 0.12, radius, 2.6);
          guardRings.push({ at: at.addScaledVector(ring.up, -0.0014), across: ring.across, up: ring.up, width: 0.0058 * (0.75 + 0.25 * bump!), top: 0.0042 * bump!, bottom: 0.001 });
        }
      }
      shell.add(mesh(loft(guardRings, { caps: [0.0045, 0.0045], around: 20, steps: 3, squareness: 2.3 }), guard));

      // The wrist, from inside the heel down to a flared cuff the sleeve slips over.
      const start = around(WRIST_START.at, radius + PALM_HALF - 0.003, WRIST_START.y);
      const wrist = (s: number, width: number, top: number, bottom = top): LoftRing => ({ at: start.clone().addScaledVector(FOREARM, s), across, up, width, top, bottom });
      shell.add(
        mesh(
          loft([wrist(0, 0.025, 0.013), wrist(0.018, 0.0245, 0.0118), wrist(0.034, 0.0238, 0.0112), wrist(0.047, 0.027, 0.0145), wrist(0.062, 0.0285, 0.0165), wrist(0.08, 0.029, 0.017)], { around: 28, steps: 4, squareness: 2.2 }),
          glove,
        ),
      );
      // The strap round the cuff, in the course's colour, with its tab on the back.
      const [s0, s1] = STRAP as [number, number];
      const band = (s: number, grow: number): LoftRing => {
        const k = (s - 0.047) / 0.015;
        return wrist(s, 0.027 + 0.0015 * k + grow, 0.0145 + 0.002 * k + grow);
      };
      shell.add(mesh(loft([band(s0, 0.0003), band(s0 + 0.002, 0.0015), band(s1 - 0.002, 0.0015), band(s1, 0.0003)], { around: 28, steps: 2 }), cuff));
      const tab = mesh(new THREE.SphereGeometry(1, 16, 10), cuff);
      tab.position.copy(start).addScaledVector(FOREARM, (s0 + s1) / 2).addScaledVector(up, 0.0165 + 0.0005).addScaledVector(across, 0.008);
      tab.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, new THREE.Vector3().crossVectors(across, up)));
      tab.scale.set(0.009, 0.0022, 0.0068);
      shell.add(tab);
      rig.wristPoint.copy(start).addScaledVector(FOREARM, SLEEVE_STARTS);

      // The fingers wrap from their knuckles, at the front of the palm.
      for (const { f, digit } of fingers) wrapDigit(digit, around(f.at, radius + PALM_HALF, f.y), radius + f.radius * SQUASH);

      // The thumb: a fleshy base from deep in the heel out to its knuckle over the index finger, then round the near side.
      const out = radius + 2 * FINGERS[0]!.radius * SQUASH + THUMB.radius * SQUASH;
      const knuckle = around(THUMB_KNUCKLE_AT, out, THUMB.y);
      const root = around(THUMB_ROOT.at, radius + THUMB_ROOT.out, THUMB_ROOT.y);
      shell.add(mesh(thenar(root, knuckle), glove));
      wrapDigit(thumb, knuckle, out);
      rig.pose(openNow);
    },
    pose(open: number) {
      openNow = open;
      const o = Math.max(-0.4, Math.min(1, open));
      for (const { digit } of fingers) setDigit(digit, o, OPEN_KNUCKLE);
      setDigit(thumb, o, OPEN_THUMB);
    },
  };
  rig.fit(0.016);
  return rig;
}

/** The ball of the thumb: thick where it leaves the palm, narrowing to the thumb's knuckle. */
function thenar(root: THREE.Vector3, knuckle: THREE.Vector3): THREE.BufferGeometry {
  const along = knuckle.clone().sub(root);
  const length = along.length();
  along.normalize();
  const mid = root.clone().add(knuckle).multiplyScalar(0.5);
  const up = new THREE.Vector3(mid.x, 0, mid.z).normalize();
  up.addScaledVector(along, -up.dot(along)).normalize();
  const across = new THREE.Vector3().crossVectors(along, up).normalize();
  const r = THUMB.radius;
  const ring = (k: number, width: number, top: number, bottom: number): LoftRing => ({
    at: root.clone().addScaledVector(along, length * k),
    across,
    up,
    width,
    top,
    bottom,
  });
  return loft([ring(0, 0.0135, 0.0125, 0.011), ring(0.45, 0.0128, 0.0118, 0.0098), ring(1, r * 1.05, r * 0.95, r)], { caps: [0.009, r * 0.95], around: 22, steps: 4 });
}

/** A jacket sleeve from its hemmed opening up the forearm, a little bunched near the wrist. */
function sleeveGeometry(across: THREE.Vector3, up: THREE.Vector3): THREE.BufferGeometry {
  const ring = (s: number, width: number, height: number, shift = 0): LoftRing => ({
    at: FOREARM.clone().multiplyScalar(s).addScaledVector(up, shift),
    across,
    up,
    width,
    top: height,
    bottom: height,
  });
  // The lining inside the opening, the hem, then folds as it widens up the arm.
  return loft(
    [
      ring(0.014, 0.029, 0.025),
      ring(0.001, 0.0325, 0.0285),
      ring(0.004, 0.0355, 0.031),
      ring(0.02, 0.0365, 0.032, 0.001),
      ring(0.042, 0.0345, 0.0305),
      ring(0.066, 0.0375, 0.033, -0.0015),
      ring(0.11, 0.0405, 0.036),
      ring(0.19, 0.0435, 0.039),
      ring(0.3, 0.0465, 0.042),
      ring(0.42, 0.048, 0.0435),
    ],
    { around: 28, steps: 5 },
  );
}
