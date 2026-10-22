import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { HandRig } from './hand.js';

let buildHand: () => HandRig;

beforeAll(async () => {
  // The sleeve's knit is painted on a canvas; tests have no DOM, so it paints nothing.
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  ({ buildHand } = await import('./hand.js'));
});

/** The hand's four fingers, then its thumb: each a chain of joints, knuckle first. */
function digits(rig: HandRig): THREE.Object3D[][] {
  return rig.group.children.slice(0, 5).map((base) => {
    const chain: THREE.Object3D[] = [];
    let joint = base.children[0];
    while (joint) {
      chain.push(joint);
      joint = joint.children.find((c) => c instanceof THREE.Group);
    }
    return chain;
  });
}

/** Points along a chain's bones (each runs along its joint's local −X to the next joint), knuckle to fingertip. */
function along(chain: THREE.Object3D[]): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  chain.forEach((joint, i) => {
    const next = chain[i + 1];
    let length: number;
    if (next) length = next.position.length();
    else {
      const tip = joint.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
      tip.geometry.computeBoundingBox();
      length = -tip.geometry.boundingBox!.min.x;
    }
    for (let k = 0; k < 4; k++) points.push(joint.localToWorld(new THREE.Vector3((-length * k) / 4, 0, 0)));
    if (!next) points.push(joint.localToWorld(new THREE.Vector3(-length, 0, 0)));
  });
  return points;
}

/** Angle round the grip, unwrapped along a path so it keeps counting past ±180°. */
function angles(points: THREE.Vector3[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    const a = Math.atan2(p.z, p.x);
    const prev = out[out.length - 1];
    out.push(prev === undefined ? a : prev + Math.atan2(Math.sin(a - prev), Math.cos(a - prev)));
  }
  return out;
}

describe('the gloved hand', () => {
  for (const radius of [0.0126, 0.018, 0.026]) {
    it(`wraps its fingers round the front of a grip ${radius} thick, and its thumb round the near side`, () => {
      const rig = buildHand();
      rig.fit(radius);
      rig.group.updateMatrixWorld(true);
      const chains = digits(rig);
      chains.forEach((chain, i) => {
        const points = along(chain);
        // Every bone runs round the outside of the grip (a glove squashes a little against it).
        for (const p of points.slice(1)) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(radius + 0.002);
        const a = angles(points);
        const thumb = i === 4;
        // Fingers go clockwise from above (front, then left); the thumb the other way.
        for (let k = 1; k < a.length; k++) expect(thumb ? a[k]! - a[k - 1]! : a[k - 1]! - a[k]!).toBeGreaterThan(-1e-6);
        // Fingertips reach round to the left side; the thumb across the near side.
        if (thumb) expect(a[a.length - 1]! - a[0]!).toBeGreaterThan(0.6);
        else expect(a[a.length - 1]!).toBeLessThan(-Math.PI * 0.8);
      });
    });
  }

  it('opens and closes the short way round, never folding through the back of the hand', () => {
    const rig = buildHand();
    rig.fit(0.018);
    const knuckles = () => digits(rig).map((chain) => chain[0]!.rotation.y);
    rig.pose(0);
    const shut = knuckles();
    rig.pose(1);
    const open = knuckles();
    rig.pose(0.5);
    const half = knuckles();
    shut.forEach((s, i) => {
      expect(Math.abs(open[i]! - s)).toBeLessThan(Math.PI);
      expect(half[i]!).toBeCloseTo((s + open[i]!) / 2, 6);
    });
  });

  it('keeps the sleeve opening at the cuff, whatever it holds', () => {
    const rig = buildHand();
    const at = (radius: number) => {
      rig.fit(radius);
      return rig.wristPoint.clone();
    };
    const thin = at(0.0126);
    const thick = at(0.026);
    for (const p of [thin, thick]) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    // A thicker grip moves the hand out, and the cuff with it, but not far.
    expect(thick.distanceTo(thin)).toBeLessThan(0.02);
    expect(rig.forearm.length()).toBeCloseTo(1, 6);
  });
});
