import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildCourse } from '../course/builder.js';
import { SHIPPED_COURSES } from '../course/courses/index.js';
import { courseKey } from '../course/courseKey.js';
import { encodeGhost, sampleGhost } from './ghost.js';
import { parseDevGhostFile, recordBotGhost } from './devGhosts.js';

const tutorial = buildCourse(SHIPPED_COURSES[0]!.spec);

describe('recordBotGhost', () => {
  const run = recordBotGhost(tutorial);

  it('records a finished run with a time, splits and a 20 Hz ghost', () => {
    expect(run).not.toBeNull();
    expect(run!.timeMs).toBeGreaterThan(10_000);
    expect(run!.splits).toHaveLength(tutorial.checkpoints.length - 1);
    for (const s of run!.splits) expect(s).toBeGreaterThan(0);
    expect(run!.ghost.samples.length).toBe(Math.floor(run!.timeMs / 50) + 1);
  });

  it('starts at the spawn and ends on the finish pad', () => {
    const pos = new Vector3();
    sampleGhost(run!.ghost, 0, pos);
    expect(pos.distanceTo(tutorial.spawn.pos)).toBeLessThan(1);
    sampleGhost(run!.ghost, run!.timeMs / 1000, pos);
    // It finishes on entering the finish volume (the pad lengthens to catch fast riders): inside its footprint.
    const finish = tutorial.triggers.find((t) => t.kind === 'finish')!;
    expect(Math.hypot(pos.x - finish.center.x, pos.z - finish.center.z)).toBeLessThan(Math.hypot(finish.half.x, finish.half.z) + 100);
  });
});

describe('parseDevGhostFile', () => {
  const key = courseKey(tutorial.course);
  const good = {
    id: 'tutorial',
    courseKey: key,
    timeMs: 30_000,
    splits: [10_000, null],
    ghost: encodeGhost({ rate: 20, samples: [{ x: 0, y: 0, z: 0, yaw: 0 }] }),
    recordedAt: '2026-10-05T12:00:00.000Z',
  };

  it('accepts a file recorded for this exact course', () => {
    expect(parseDevGhostFile(good, key)?.timeMs).toBe(30_000);
  });

  it('ignores a file recorded for an older layout of the course', () => {
    expect(parseDevGhostFile({ ...good, courseKey: 'c1-old' }, key)).toBeNull();
  });

  it('ignores malformed files', () => {
    expect(parseDevGhostFile({ ...good, ghost: '!!' }, key)).toBeNull();
    expect(parseDevGhostFile({ ...good, timeMs: -1 }, key)).toBeNull();
    expect(parseDevGhostFile('nope', key)).toBeNull();
  });
});
