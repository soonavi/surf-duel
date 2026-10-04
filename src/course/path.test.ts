import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { TrackPath } from './path';

/** A straight line down -Z, then a 90° left turn heading -X. */
function lPath(): TrackPath {
  const path = new TrackPath();
  for (let z = 0; z >= -2000; z -= 100) path.add(new Vector3(0, -z * 0.1, z), 0, 0, -500);
  for (let x = -100; x >= -2000; x -= 100) path.add(new Vector3(x, 200, -2000), Math.PI / 2, 1, 0);
  path.finish(1000, 300);
  return path;
}

describe('TrackPath', () => {
  it('interpolates a point at any distance along the path', () => {
    const path = lPath();
    const out = new Vector3();
    expect(path.pointAt(1050, out)).toBe(0); // heading on the first leg
    expect(out.z).toBeCloseTo(-1050, 6);
    expect(out.y).toBeCloseTo(105, 6);
    path.pointAt(3000, out);
    expect(out.x).toBeCloseTo(-1000, 6);
    // Clamped at both ends.
    path.pointAt(-50, out);
    expect(out.z).toBeCloseTo(0, 6);
    path.pointAt(99999, out);
    expect(out.x).toBeCloseTo(-2000, 6);
  });

  it('accumulates distance along the samples', () => {
    const path = lPath();
    expect(path.length).toBeCloseTo(4000, 6);
    expect(path.sample(0).s).toBe(0);
  });

  it('finds the nearest sample and reports progress and lateral offset', () => {
    const path = lPath();
    const hit = path.locate(new Vector3(30, 0, -1010), 0);
    expect(hit.s).toBeCloseTo(1000, 6);
    // Heading 0 means right = +X, so x = 30 is 30 units right of the line.
    expect(hit.lateral).toBeCloseTo(30, 6);
  });

  it('tracks progress around corners when given the previous hint', () => {
    const path = lPath();
    let hint = 0;
    for (let z = 0; z >= -2000; z -= 50) hint = path.locate(new Vector3(0, 0, z), hint).index;
    const hit = path.locate(new Vector3(-1500, 200, -2000), hint);
    expect(hit.s).toBeCloseTo(3500, 6);
  });

  it('recovers with a full search when the hint is far off', () => {
    const path = lPath();
    expect(path.locate(new Vector3(-1900, 200, -2000), 0).s).toBeCloseTo(3900, 6);
  });

  it('puts the kill floor below the lowest geometry nearby, smoothed over a window', () => {
    const path = lPath();
    // Straight section floors are at -500; the corner section's are at 0.
    // Within 1000 units of the -500 floors, killY is -500 - 300.
    expect(path.sample(25).killY).toBeCloseTo(-800, 6);
    // Far from the low section it relaxes to 0 - 300.
    expect(path.sample(path.count - 1).killY).toBeCloseTo(-300, 6);
  });
});
