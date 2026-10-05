/**
 * Small collision worlds shared by the physics tests. Not imported by game code.
 */
import { BoxGeometry, BufferGeometry, Matrix4, MathUtils, Vector3 } from 'three';
import { BvhWorld } from './collision.js';
import { rampPrismGeometry } from '../course/geometry.js';
import { PLAYER_RADIUS } from './constants.js';

/** A huge box whose top face sits at `y`. */
export function floorGeometry(y = 0): BufferGeometry {
  return new BoxGeometry(100_000, 200, 100_000).translate(0, y - 100, 0);
}

export function floorWorld(y = 0): BvhWorld {
  return new BvhWorld(floorGeometry(y));
}

export interface RampSpec {
  length: number;
  height: number;
  angleDeg: number;
  /** Nose-down tilt along the length, in degrees. */
  pitchDeg?: number;
  /** Centreline x offset. */
  x?: number;
}

/** Ramp running from z = 0 toward -Z, base at y = 0 (before pitch). */
export function rampGeometry(spec: RampSpec): BufferGeometry {
  const geo = rampPrismGeometry(spec.length, spec.height, spec.angleDeg);
  const m = new Matrix4().makeRotationX(-MathUtils.degToRad(spec.pitchDeg ?? 0));
  geo.applyMatrix4(m);
  geo.translate(spec.x ?? 0, 0, 0);
  return geo;
}

export function rampWorld(spec: RampSpec): BvhWorld {
  return new BvhWorld(rampGeometry(spec));
}

function pitchMatrix(spec: RampSpec): Matrix4 {
  return new Matrix4().makeRotationX(-MathUtils.degToRad(spec.pitchDeg ?? 0));
}

/** Outward normal of the left (−X) face of a ramp (pitch applied if the spec has one). */
export function leftFaceNormal(angleDeg: number, spec?: RampSpec): Vector3 {
  const a = MathUtils.degToRad(angleDeg);
  const n = new Vector3(-Math.sin(a), Math.cos(a), 0);
  return spec ? n.transformDirection(pitchMatrix(spec)) : n;
}

/** A point on the left face, `y` above the base and `z` along the length (before pitch). */
function leftFacePoint(spec: RampSpec, y: number, z: number): Vector3 {
  const a = MathUtils.degToRad(spec.angleDeg);
  const x = (spec.x ?? 0) - (spec.height - y) / Math.tan(a);
  return new Vector3(x, y, z).applyMatrix4(pitchMatrix(spec));
}

/**
 * Feet position that puts the capsule's lower sphere exactly touching the left
 * face of a ramp at height `y` and depth `z` (measured before pitch).
 */
export function feetOnLeftFace(spec: RampSpec, y: number, z: number): Vector3 {
  const n = leftFaceNormal(spec.angleDeg, spec);
  return leftFacePoint(spec, y, z).addScaledVector(n, PLAYER_RADIUS).add(new Vector3(0, -PLAYER_RADIUS, 0));
}

/** Signed distance from the capsule's lower sphere centre to the left face plane. */
export function sphereDistanceToLeftFace(spec: RampSpec, feet: Vector3): number {
  const n = leftFaceNormal(spec.angleDeg, spec);
  const center = feet.clone().add(new Vector3(0, PLAYER_RADIUS, 0));
  return center.sub(leftFacePoint(spec, 0, 0)).dot(n);
}
