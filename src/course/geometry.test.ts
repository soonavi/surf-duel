import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { rampPrismGeometry } from './geometry';
import { FLOOR_NORMAL_Y } from '../physics/constants';

describe('rampPrismGeometry', () => {
  it('faces every triangle outward and makes 60° slopes surfable', () => {
    const geo = rampPrismGeometry(1000, 400, 60);
    const pos = geo.getAttribute('position');
    const centroid = new Vector3(0, 400 / 3, -500);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const n = new Vector3();
    const slopeNormalYs: number[] = [];

    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const faceCenter = a.clone().add(b).add(c).divideScalar(3);
      expect(n.dot(faceCenter.sub(centroid))).toBeGreaterThan(0);
      if (n.y > 0) slopeNormalYs.push(n.y);
    }

    expect(slopeNormalYs).toHaveLength(4);
    for (const y of slopeNormalYs) {
      expect(y).toBeCloseTo(Math.cos(Math.PI / 3), 5);
      expect(y).toBeLessThan(FLOOR_NORMAL_Y);
    }
  });
});
