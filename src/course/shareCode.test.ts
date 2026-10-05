import { describe, expect, it } from 'vitest';
import { SHARE_CODE_LENGTH, generateShareCode, normalizeShareCode } from './shareCode.js';
import { createRng } from '../util/rng.js';

describe('share codes', () => {
  it('are six characters with no look-alikes (I, O, 0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const code = generateShareCode(rng);
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // same rule as the database check constraint
    }
  });

  it('normalise what people type or paste', () => {
    expect(normalizeShareCode(' k7m-2qx ')).toBe('K7M2QX');
    expect(normalizeShareCode('https://surf.example/?course=K7M2QX')).toBe('K7M2QX');
  });

  it('reject anything that cannot be a code', () => {
    expect(normalizeShareCode('K7M2Q')).toBeNull(); // too short
    expect(normalizeShareCode('K7M2QO')).toBeNull(); // O is never used
    expect(normalizeShareCode('ABCD')).toBeNull(); // a room code, not a course
  });
});
