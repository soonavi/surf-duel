import { describe, expect, it } from 'vitest';
import { formatDelta, formatTime } from './time.js';

describe('formatTime', () => {
  it('formats as m:ss.cc', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(34_520)).toBe('0:34.52');
    expect(formatTime(62_480)).toBe('1:02.48');
    expect(formatTime(600_000)).toBe('10:00.00');
  });

  it('truncates rather than rounds, so a shown time is never later than the real one', () => {
    expect(formatTime(12_349)).toBe('0:12.34');
  });

  it('clamps nonsense to zero', () => {
    expect(formatTime(-5)).toBe('0:00.00');
    expect(formatTime(NaN)).toBe('0:00.00');
  });
});

describe('formatDelta', () => {
  it('always carries an explicit sign, so it reads without colour', () => {
    expect(formatDelta(310)).toBe('+0.31');
    expect(formatDelta(-1200)).toBe('−1.20');
    expect(formatDelta(0)).toBe('±0.00');
  });

  it('shows minutes for big gaps', () => {
    expect(formatDelta(75_500)).toBe('+1:15.50');
  });
});
