import { describe, expect, it } from 'vitest';
import { persistentId } from './profile';
import type { KeyValueStorage } from './records';

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('persistentId (the leaderboard id)', () => {
  it('makes a random v4 UUID once and keeps it', () => {
    const storage = new MemoryStorage();
    const first = persistentId(storage, 'k');
    expect(first).toMatch(UUID);
    expect(persistentId(storage, 'k')).toBe(first);
  });

  it('replaces anything stored that is not a UUID', () => {
    const storage = new MemoryStorage();
    storage.setItem('k', 'not-an-id');
    expect(persistentId(storage, 'k')).toMatch(UUID);
  });

  it('still works without storage, or when storage throws', () => {
    expect(persistentId(null, 'k')).toMatch(UUID);
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(persistentId(broken, 'k')).toMatch(UUID);
  });
});
