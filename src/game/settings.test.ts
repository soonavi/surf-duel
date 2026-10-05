import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings.js';
import type { KeyValueStorage } from './records.js';

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('settings', () => {
  it('starts from the defaults: generated music, high graphics, assist off', () => {
    const s = loadSettings(new MemoryStorage());
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.music).toBe('generated');
    expect(s.graphics).toBe('high');
    expect(s.assist).toBe(false);
  });

  it('saves and loads every setting', () => {
    const storage = new MemoryStorage();
    const changed = { ...DEFAULT_SETTINGS, musicVolume: 0.25, sfxVolume: 0, music: 'file' as const, graphics: 'low' as const, assist: true, fov: 90 };
    saveSettings(changed, storage);
    expect(loadSettings(storage)).toEqual(changed);
  });

  it('keeps settings saved by an older version, filling in the new ones', () => {
    const storage = new MemoryStorage();
    storage.setItem('surfduel.settings.v1', JSON.stringify({ sensitivity: 3, fov: 80 }));
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, sensitivity: 3, fov: 80 });
  });

  it('ignores values out of range or of the wrong kind', () => {
    const storage = new MemoryStorage();
    storage.setItem('surfduel.settings.v1', JSON.stringify({ musicVolume: 7, music: 'loud', graphics: 'ultra' }));
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('works without storage, or when storage throws', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });
});
