import { Vector3 } from 'three';

/** Degrees of rotation per mouse count at sensitivity 1 (Source's m_yaw / m_pitch). */
export const MOUSE_DEG_PER_COUNT = 0.022;
const DEG = Math.PI / 180;
export const PITCH_LIMIT = 89 * DEG;

export interface ViewAngles {
  /** Radians around +Y. 0 looks down -Z; positive turns left. */
  yaw: number;
  /** Radians. Positive looks up. */
  pitch: number;
}

/** Wrap an angle to [-π, π). */
export function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

export function applyMouseLook(
  angles: ViewAngles,
  dx: number,
  dy: number,
  sensitivity: number,
  invertY: boolean,
): ViewAngles {
  const k = sensitivity * MOUSE_DEG_PER_COUNT * DEG;
  const yaw = wrapAngle(angles.yaw - dx * k);
  const pitchDelta = dy * k * (invertY ? -1 : 1);
  const pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, angles.pitch - pitchDelta));
  return { yaw, pitch };
}

/** Horizontal forward direction for a yaw. */
export function flatForward(yaw: number, out = new Vector3()): Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Horizontal right direction for a yaw. */
export function flatRight(yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Full 3D look direction. */
export function lookDirection(angles: ViewAngles, out = new Vector3()): Vector3 {
  const cp = Math.cos(angles.pitch);
  return out.set(-Math.sin(angles.yaw) * cp, Math.sin(angles.pitch), -Math.cos(angles.yaw) * cp);
}
