import { describe, expect, it } from 'vitest';
import { RaceSession, type RaceEvent } from './race';

const run = (session: RaceSession, ticks: number): RaceEvent[] => {
  const events: RaceEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...session.tick());
  return events;
};

describe('RaceSession', () => {
  it('counts down 3-2-1 then goes, one second per number', () => {
    const s = new RaceSession({ countdownSeconds: 3, checkpoints: 2 });
    expect(s.phase).toBe('countdown');
    expect(s.countdownNumber).toBe(3);
    const events = run(s, 300);
    expect(events.filter((e) => e.type === 'count').map((e) => (e.type === 'count' ? e.n : 0))).toEqual([2, 1]);
    expect(s.phase).toBe('countdown');
    expect(s.countdownNumber).toBe(1);
    expect(run(s, 1)).toEqual([{ type: 'go' }]);
    expect(s.phase).toBe('racing');
  });

  it('times the race from the go tick in 10 ms ticks', () => {
    const s = new RaceSession({ countdownSeconds: 1, checkpoints: 0 });
    run(s, 100); // countdown
    run(s, 1); // go tick (first racing tick)
    expect(s.elapsedMs).toBe(10);
    run(s, 249);
    expect(s.elapsedMs).toBe(2500);
  });

  it('records splits and compares them with a personal best', () => {
    const s = new RaceSession({ countdownSeconds: 0, checkpoints: 2, best: { timeMs: 30_000, splits: [10_000, 20_000] } });
    run(s, 1000); // 10.00 s
    expect(s.checkpoint(1)).toEqual({ index: 1, timeMs: 10_000, deltaMs: 0 });
    run(s, 900);
    expect(s.checkpoint(2)).toEqual({ index: 2, timeMs: 19_000, deltaMs: -1000 });
  });

  it('gives no delta without a personal best', () => {
    const s = new RaceSession({ countdownSeconds: 0, checkpoints: 1 });
    run(s, 50);
    expect(s.checkpoint(1).deltaMs).toBeNull();
  });

  it('finishes once, with time, splits, delta and top speed', () => {
    const s = new RaceSession({ countdownSeconds: 0, checkpoints: 2, best: { timeMs: 30_000, splits: [10_000, 20_000] } });
    run(s, 1000);
    s.checkpoint(1);
    s.noteSpeed(1500);
    s.noteSpeed(900);
    run(s, 1100);
    // checkpoint 2 missed: its split stays null
    const result = s.finish();
    expect(result).toEqual({ timeMs: 21_000, splits: [10_000, null], deltaMs: -9000, topSpeed: 1500 });
    expect(s.phase).toBe('finished');
    expect(run(s, 100)).toEqual([]);
    expect(s.elapsedMs).toBe(21_000); // clock stops
  });

  it('ignores checkpoints during the countdown and repeated checkpoints', () => {
    const s = new RaceSession({ countdownSeconds: 1, checkpoints: 1 });
    run(s, 10);
    expect(s.checkpoint(1).timeMs).toBe(0);
    run(s, 200);
    const first = s.checkpoint(1);
    run(s, 50);
    expect(s.checkpoint(1)).toEqual(first);
  });
});
