import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS,
  PLAYER_COLORS,
  batchInterval,
  generateRoomCode,
  hostOf,
  normalizeRoomCode,
  orderMembers,
  overCapacity,
  pickColor,
  rankRacers,
  sanitizeName,
} from './roomLogic';
import { createRng } from '../util/rng';

describe('room codes', () => {
  it('generates 4 unambiguous capital letters', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) expect(generateRoomCode(rng)).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });

  it('normalises what people type', () => {
    expect(normalizeRoomCode(' abcd ')).toBe('ABCD');
    expect(normalizeRoomCode('ab-cd')).toBe('ABCD');
  });

  it('rejects anything that is not a valid code', () => {
    for (const bad of ['', 'ABC', 'ABCDE', 'AB1D', 'ABOD', 'ABID', '😀😀']) expect(normalizeRoomCode(bad)).toBeNull();
  });
});

describe('sanitizeName', () => {
  it('trims, collapses spaces and caps at 16 characters', () => {
    expect(sanitizeName('   Big    Wave  Rider  Extraordinaire ')).toBe('Big Wave Rider E');
  });

  it('strips control and invisible characters', () => {
    expect(sanitizeName('A\u0000l​ex\n')).toBe('Alex');
  });

  it('falls back to a default when nothing usable is left', () => {
    expect(sanitizeName('   ', 'Surfer 12')).toBe('Surfer 12');
    expect(sanitizeName(42 as unknown as string, 'Surfer 12')).toBe('Surfer 12');
  });

  it('masks a few obvious slurs', () => {
    expect(sanitizeName('xX_fuck_Xx')).not.toMatch(/fuck/i);
  });
});

describe('membership', () => {
  const m = (id: string, joinedAt: number) => ({ id, joinedAt });

  it('orders by join time, then id, and the first is host', () => {
    const members = [m('c', 30), m('b', 10), m('a', 10)];
    expect(orderMembers(members).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(hostOf(members)).toBe('a');
    expect(hostOf([])).toBeNull();
  });

  it('flags only the players beyond the cap as over capacity', () => {
    const members = Array.from({ length: MAX_PLAYERS + 2 }, (_, i) => m(`p${i}`, i));
    expect(overCapacity(members, 'p0')).toBe(false);
    expect(overCapacity(members, `p${MAX_PLAYERS - 1}`)).toBe(false);
    expect(overCapacity(members, `p${MAX_PLAYERS}`)).toBe(true);
  });

  it('picks the first colour nobody has', () => {
    expect(pickColor([])).toBe(PLAYER_COLORS[0]);
    expect(pickColor([PLAYER_COLORS[0]!, PLAYER_COLORS[2]!])).toBe(PLAYER_COLORS[1]);
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
  });
});

describe('batchInterval', () => {
  it('sends every 20 Hz sample when the room is small', () => {
    expect(batchInterval(1, 400)).toBeCloseTo(0.05);
    expect(batchInterval(2, 80)).toBeCloseTo(0.05);
  });

  it('batches more as the room grows, keeping messages under budget', () => {
    for (let n = 2; n <= MAX_PLAYERS; n++) {
      const perSecond = (n * n) / batchInterval(n, 80); // each send reaches everyone
      expect(perSecond).toBeLessThanOrEqual(80 + 1e-9);
    }
    expect(batchInterval(8, 80)).toBeLessThanOrEqual(1);
  });
});

describe('rankRacers', () => {
  it('puts finishers first by time, then racers by progress, then everyone else', () => {
    const ranked = rankRacers([
      { id: 'slow', finishedMs: null, progress: 0.4, left: false },
      { id: 'gone', finishedMs: null, progress: 0.9, left: true },
      { id: 'second', finishedMs: 31_000, progress: 1, left: false },
      { id: 'first', finishedMs: 30_000, progress: 1, left: false },
      { id: 'fast', finishedMs: null, progress: 0.8, left: false },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['first', 'second', 'fast', 'slow', 'gone']);
  });
});
