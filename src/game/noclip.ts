import { Vector3 } from 'three';
import { flatRight, lookDirection, type ViewAngles } from './view';

export interface NoclipInput {
  /** -1..1, W/S */
  forward: number;
  /** -1..1, D/A */
  right: number;
  /** -1..1, Space/C */
  up: number;
  fast: boolean;
}

const fwd = new Vector3();
const right = new Vector3();
const wish = new Vector3();

/** Free-fly dev camera. Mutates `pos`. */
export function noclipStep(pos: Vector3, angles: ViewAngles, input: NoclipInput, speed: number, dt: number): void {
  lookDirection(angles, fwd);
  flatRight(angles.yaw, right);
  wish
    .set(0, 0, 0)
    .addScaledVector(fwd, input.forward)
    .addScaledVector(right, input.right);
  wish.y += input.up;
  if (wish.lengthSq() === 0) return;
  wish.normalize().multiplyScalar(speed * (input.fast ? 3 : 1));
  pos.addScaledVector(wish, dt);
}
