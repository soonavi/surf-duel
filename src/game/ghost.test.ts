import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GHOST_RATE, GhostRecorder, decodeGhost, encodeGhost, sampleGhost, type GhostData } from './ghost.js';

function circleRun(seconds: number): GhostData {
  const rec = new GhostRecorder();
  const pos = new Vector3();
  for (let tick = 0; tick <= seconds * 100; tick++) {
    const t = tick / 100;
    pos.set(Math.cos(t) * 3000, -t * 400, Math.sin(t) * 3000);
    rec.tick(tick, pos, t * 2);
  }
  return rec.data();
}

describe('GhostRecorder', () => {
  it('samples at 20 Hz from the go tick', () => {
    const g = circleRun(2);
    expect(GHOST_RATE).toBe(20);
    expect(g.samples).toHaveLength(41); // 0..2 s inclusive
    expect(g.samples[20]!.x).toBeCloseTo(Math.cos(1) * 3000, 6);
  });
});

describe('encodeGhost / decodeGhost', () => {
  it('round-trips to within a unit and a fraction of a degree', () => {
    const g = circleRun(30);
    const back = decodeGhost(encodeGhost(g));
    expect(back).not.toBeNull();
    expect(back!.samples).toHaveLength(g.samples.length);
    g.samples.forEach((s, i) => {
      const b = back!.samples[i]!;
      expect(Math.abs(b.x - s.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(b.y - s.y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(b.z - s.z)).toBeLessThanOrEqual(0.5);
      const dyaw = Math.atan2(Math.sin(b.yaw - s.yaw), Math.cos(b.yaw - s.yaw));
      expect(Math.abs(dyaw)).toBeLessThan(0.002);
    });
  });

  it('is compact: a minute of fast surfing fits in under 8 KB', () => {
    expect(encodeGhost(circleRun(60)).length).toBeLessThan(8 * 1024);
  });

  it('is URL- and JSON-safe', () => {
    expect(encodeGhost(circleRun(5))).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each(['', 'not base64!!', 'AAAA', '_'.repeat(50), encodeGhost(circleRun(1)).slice(0, -5)])('rejects garbage (%s) with null instead of throwing', (s) => {
    expect(decodeGhost(s)).toBeNull();
  });
});

describe('sampleGhost', () => {
  const ghost: GhostData = {
    rate: GHOST_RATE,
    samples: [
      { x: 0, y: 0, z: 0, yaw: 3.1 },
      { x: 100, y: 0, z: 0, yaw: -3.1 },
      { x: 5000, y: 0, z: 0, yaw: 0 }, // teleport (respawn)
    ],
  };
  const pos = new Vector3();

  it('interpolates position, and yaw the short way round', () => {
    const yaw = sampleGhost(ghost, 0.025, pos);
    expect(pos.x).toBeCloseTo(50, 6);
    expect(Math.abs(Math.atan2(Math.sin(yaw - Math.PI), Math.cos(yaw - Math.PI)))).toBeLessThan(0.1);
  });

  it('snaps instead of sliding across a respawn teleport', () => {
    sampleGhost(ghost, 0.075, pos);
    expect([100, 5000]).toContain(pos.x);
  });

  it('holds the first and last samples outside the recording', () => {
    sampleGhost(ghost, -1, pos);
    expect(pos.x).toBe(0);
    sampleGhost(ghost, 99, pos);
    expect(pos.x).toBe(5000);
  });
});
