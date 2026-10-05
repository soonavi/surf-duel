import { describe, expect, it } from 'vitest';
import { RecordStore, type RunRecord, type KeyValueStorage } from './records';
import { courseKey } from '../course/courseKey';
import { validateCourse } from '../course/validator';
import { SHIPPED_COURSES } from '../course/courses';

class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

const run = (timeMs: number, at = 1): RunRecord => ({ timeMs, splits: [timeMs / 2], topSpeed: 1200, ghost: 'AQ', at });

describe('courseKey', () => {
  const [a, b] = SHIPPED_COURSES.map((c) => validateCourse(c.spec).course);

  it('is stable for the same course and differs between courses', () => {
    expect(courseKey(a!)).toBe(courseKey(structuredClone(a!)));
    expect(courseKey(a!)).not.toBe(courseKey(b!));
  });

  it('is safe to use in storage keys and URLs', () => {
    expect(courseKey(a!)).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('RecordStore', () => {
  it('saves a first run as the best, ranked 1 of 1', () => {
    const store = new RecordStore(new MemoryStorage());
    expect(store.best('c')).toBeNull();
    const out = store.save('c', run(30_000));
    expect(out).toMatchObject({ isBest: true, rank: 1, runs: 1, previousBest: null });
    expect(store.best('c')?.timeMs).toBe(30_000);
  });

  it('keeps the best when a slower run comes in, and ranks the slower one', () => {
    const store = new RecordStore(new MemoryStorage());
    store.save('c', run(30_000));
    const out = store.save('c', run(32_000));
    expect(out).toMatchObject({ isBest: false, rank: 2, runs: 2 });
    expect(store.best('c')?.timeMs).toBe(30_000);
  });

  it('replaces the best with a faster run and reports the old one', () => {
    const store = new RecordStore(new MemoryStorage());
    store.save('c', run(30_000));
    store.save('c', run(33_000));
    const out = store.save('c', run(29_000));
    expect(out).toMatchObject({ isBest: true, rank: 1, runs: 3 });
    expect(out.previousBest?.timeMs).toBe(30_000);
  });

  it('keeps courses separate', () => {
    const store = new RecordStore(new MemoryStorage());
    store.save('a', run(30_000));
    expect(store.best('b')).toBeNull();
  });

  it('survives across store instances (persists)', () => {
    const storage = new MemoryStorage();
    new RecordStore(storage).save('c', run(30_000));
    expect(new RecordStore(storage).best('c')?.timeMs).toBe(30_000);
  });

  it('treats corrupted saved data as empty instead of crashing', () => {
    const storage = new MemoryStorage();
    const store = new RecordStore(storage);
    store.save('c', run(30_000));
    for (const k of storage.map.keys()) storage.map.set(k, '{not json');
    expect(store.best('c')).toBeNull();
    expect(store.save('c', run(31_000)).rank).toBe(1);
  });

  it('keeps working when storage throws (private mode, quota)', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = new RecordStore(broken);
    expect(store.save('c', run(30_000)).isBest).toBe(true);
    expect(store.best('c')?.timeMs).toBe(30_000);
  });

  it('caps the run history', () => {
    const store = new RecordStore(new MemoryStorage());
    for (let i = 0; i < 250; i++) store.save('c', run(40_000 + i));
    expect(store.save('c', run(50_000)).runs).toBeLessThanOrEqual(200);
  });
});

describe('RecordStore: your leaderboard row', () => {
  it('remembers your row id per course, across store instances', () => {
    const storage = new MemoryStorage();
    const store = new RecordStore(storage);
    expect(store.boardRunId('c3-abc')).toBeNull();
    store.setBoardRunId('c3-abc', 'run-1');
    expect(new RecordStore(storage).boardRunId('c3-abc')).toBe('run-1');
    expect(store.boardRunId('c3-other')).toBeNull();
  });
});
