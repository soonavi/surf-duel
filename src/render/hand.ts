/**
 * A gloved right hand with jointed fingers and thumb (user, Oct 14 2026: "the
 * hand doesnt move and needs to"). The fingers wrap round whatever's held,
 * whatever its thickness (`fit`), and open or squeeze (`pose`).
 *
 * Frame: the held thing's grip runs up +Y through the origin. The back of the
 * hand is to the right (+X); the fingers wrap across the front (−Z) and round
 * the left, and the thumb comes over the near side (+Z). You see it from
 * behind and to the left, like a shooter's view model.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mesh, standard } from './modelKit.js';

const DEG = Math.PI / 180;

interface Digit {
  /** The joint nodes, knuckle first: each turns about Y; its segment lies along its local −X. */
  joints: THREE.Group[];
  lengths: number[];
  radius: number;
  /** The chain wraps the other way (the thumb goes round the near side). */
  thumb: boolean;
  /** Gripping angles (knuckle direction, then bends) for the current fit. */
  grip: number[];
}

/** Index to little finger: height on the grip, segment lengths, thickness. */
const FINGERS: { y: number; lengths: number[]; radius: number }[] = [
  { y: 0.025, lengths: [0.026, 0.019, 0.017], radius: 0.0086 },
  { y: 0.008, lengths: [0.028, 0.02, 0.018], radius: 0.0088 },
  { y: -0.009, lengths: [0.026, 0.019, 0.017], radius: 0.0084 },
  { y: -0.025, lengths: [0.021, 0.016, 0.014], radius: 0.0076 },
];
const THUMB = { y: 0.017, lengths: [0.026, 0.022], radius: 0.0098 };
/**
 * Where things sit on the circle round the grip (angles in the X/Z plane: 0 right, −90° front,
 * ±180° left, 90° near). The palm presses on the near right; the knuckles are at the front right,
 * the fingers wrap the front and the left, and the thumb lies across the near side, over them.
 */
const PALM_AT = 35 * DEG;
const FINGER_START = -35 * DEG;
const THUMB_START = 62 * DEG;
/** An open hand: fingers pointing forward and left, barely bent; the thumb out to the side. */
const OPEN_KNUCKLE = -70 * DEG;
const OPEN_BEND = 0.12;
const OPEN_THUMB = 70 * DEG;

export interface HandRig {
  group: THREE.Group;
  /** The glove's cuff, coloured to match the course. */
  cuff: THREE.MeshStandardMaterial;
  /** Wrap the fingers round a grip this thick (radius, metres). */
  fit(radius: number): void;
  /** 0 gripping, 1 open, negative squeezing tighter. */
  pose(open: number): void;
}

/** The angle a segment of length `l` spans on a circle of radius `r`. */
function spans(l: number, r: number): number {
  return 2 * Math.asin(Math.min(1, l / (2 * r)));
}

function buildDigit(parent: THREE.Object3D, lengths: number[], radius: number, material: THREE.Material, thumb: boolean): Digit {
  const joints: THREE.Group[] = [];
  let at: THREE.Object3D = parent;
  lengths.forEach((l, i) => {
    const joint = new THREE.Group();
    if (i > 0) joint.position.set(-lengths[i - 1]!, 0, 0);
    at.add(joint);
    // Each segment a little thinner toward the tip, with a round knuckle at its base.
    const r = radius * (1 - i * 0.08);
    const segment = new THREE.CapsuleGeometry(r, Math.max(0.001, l - r), 4, 10).rotateZ(Math.PI / 2).translate(-l / 2, 0, 0);
    joint.add(mesh(segment, material));
    joints.push(joint);
    at = joint;
  });
  return { joints, lengths, radius, thumb, grip: [] };
}

export function buildHand(): HandRig {
  const group = new THREE.Group();
  const glove = standard('#2b2f38', 0.72);
  const panel = standard('#3a404c', 0.6);
  const cuff = standard('#3ee6ff', 0.5, 0.1);

  // The back of the hand and the heel of the palm, then the wrist.
  const palm = new THREE.Group();
  group.add(palm);
  palm.add(mesh(new RoundedBoxGeometry(0.024, 0.074, 0.058, 3, 0.009), glove));
  palm.add(mesh(new RoundedBoxGeometry(0.008, 0.05, 0.034, 2, 0.003), panel, 0.012, 0.004, -0.004)); // padded panel
  const wrist = mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.04, 16), glove, -0.004, -0.052, 0.006);
  palm.add(wrist);
  const band = mesh(new THREE.CylinderGeometry(0.0255, 0.0255, 0.016, 18), cuff, -0.004, -0.066, 0.006);
  palm.add(band);

  const fingers = FINGERS.map((f) => {
    const base = new THREE.Group();
    base.position.y = f.y;
    group.add(base);
    return { base, digit: buildDigit(base, f.lengths, f.radius, glove, false) };
  });
  const thumbBase = new THREE.Group();
  thumbBase.position.y = THUMB.y;
  // Tipped up a little, so the thumb rises over the fingers.
  const thumbTilt = new THREE.Group();
  thumbTilt.rotation.z = 0.25;
  thumbBase.add(thumbTilt);
  group.add(thumbBase);
  const thumb = buildDigit(thumbTilt, THUMB.lengths, THUMB.radius, glove, true);

  let openNow = 0;
  const rig: HandRig = {
    group,
    cuff,
    fit(radius: number) {
      const pr = radius + 0.012;
      palm.position.set(pr * Math.cos(PALM_AT), -0.004, pr * Math.sin(PALM_AT));
      palm.rotation.y = -PALM_AT;
      // Fingers on a circle round the grip, from the front right, going round the left.
      for (const { base, digit } of fingers) {
        const r = radius + digit.radius;
        base.position.set(r * Math.cos(FINGER_START), base.position.y, r * Math.sin(FINGER_START));
        const a = digit.lengths.map((l) => spans(l, r));
        // Knuckle direction (a joint turned by θ points its segment at 180° − θ), then each bend.
        digit.grip = [3 * Math.PI / 2 - FINGER_START + a[0]! / 2, ...a.slice(1).map((ak, k) => (a[k]! + ak) / 2)];
      }
      // The thumb on a wider circle (over the fingers), from the near right, round the near side.
      const rt = radius + FINGERS[0]!.radius * 2 + thumb.radius;
      thumbBase.position.set(rt * Math.cos(THUMB_START), THUMB.y, rt * Math.sin(THUMB_START));
      const b = thumb.lengths.map((l) => spans(l, rt));
      thumb.grip = [90 * DEG - THUMB_START - b[0]! / 2, ...b.slice(1).map((bk, k) => -(b[k]! + bk) / 2)];
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

/** Between gripping (0) and open (1); a squeeze (negative) bends every joint a little further. */
function setDigit(d: Digit, open: number, openKnuckle: number): void {
  d.joints.forEach((joint, i) => {
    const grip = d.grip[i] ?? 0;
    const sign = d.thumb && i > 0 ? -1 : 1;
    const opened = i === 0 ? openKnuckle : sign * OPEN_BEND;
    joint.rotation.y = open >= 0 ? grip + (opened - grip) * open : i === 0 ? grip : grip * (1 - open * 0.6);
  });
}

/** A sleeve from the wrist down toward the corner of the view. */
export function buildSleeve(): THREE.Group {
  const g = new THREE.Group();
  const sleeve = standard('#323848', 0.85);
  const arm = mesh(new THREE.CylinderGeometry(0.03, 0.046, 0.34, 20), sleeve, 0.045, -0.21, 0.1);
  arm.rotation.set(-0.5, 0, 0.25);
  g.add(arm);
  return g;
}
