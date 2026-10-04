import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildCourse } from '../course/builder';
import { findCourse } from '../course/courses';
import { flyoverDuration, flyoverPose } from './flyover';

const built = buildCourse(findCourse('easy-cruise')!.spec);
const path = built.path;

describe('flyover camera', () => {
  it('takes a watchable amount of time to cover the course', () => {
    const d = flyoverDuration(path);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThanOrEqual(14);
  });

  it('flies above the riding line, looking ahead along it', () => {
    const pos = new Vector3();
    const target = new Vector3();
    const d = flyoverDuration(path);
    for (let t = 0; t < d; t += 0.25) {
      flyoverPose(path, t, pos, target);
      const s = (t / d) * path.length;
      const here = new Vector3();
      path.pointAt(s, here);
      expect(pos.y).toBeGreaterThan(here.y + 200);
      expect(pos.distanceTo(target)).toBeGreaterThan(500);
      expect(Number.isFinite(pos.x + pos.y + pos.z + target.x + target.y + target.z)).toBe(true);
    }
  });

  it('loops back to the start', () => {
    const a = new Vector3();
    const b = new Vector3();
    const scratch = new Vector3();
    flyoverPose(path, 0.5, a, scratch);
    flyoverPose(path, 0.5 + flyoverDuration(path), b, scratch);
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });
});
