import { z } from 'zod';
import { browserStorage, type KeyValueStorage } from './records.js';

export type MusicChoice = 'generated' | 'file' | 'off';
export type GraphicsQuality = 'high' | 'low';

/** Player-facing settings, persisted to localStorage when available. */
export interface Settings {
  /** Source-style sensitivity: degrees per mouse count = sensitivity × 0.022. */
  sensitivity: number;
  invertY: boolean;
  /** Ask for unaccelerated mouse input when pointer lock supports it. */
  rawInput: boolean;
  /** Vertical field of view in degrees. */
  fov: number;
  /** 0–1. */
  musicVolume: number;
  /** 0–1. */
  sfxVolume: number;
  /** The generated soundtrack, the player's own music file, or none. */
  music: MusicChoice;
  /** 'low' renders fewer pixels and skips extra effects, for slower machines. */
  graphics: GraphicsQuality;
  /** Assist mode: steadier on ramps and in the air, for trackpads and new players. */
  assist: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sensitivity: 2,
  invertY: false,
  rawInput: true,
  fov: 75,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  music: 'generated',
  graphics: 'high',
  assist: false,
});

export const SETTINGS_LIMITS = {
  sensitivity: { min: 0.1, max: 10, step: 0.05 },
  fov: { min: 60, max: 100, step: 1 },
} as const;

const STORAGE_KEY = 'surfduel.settings.v1';

const volume = z.number().min(0).max(1);

const StoredSettings = z
  .object({
    sensitivity: z.number().min(SETTINGS_LIMITS.sensitivity.min).max(SETTINGS_LIMITS.sensitivity.max),
    invertY: z.boolean(),
    rawInput: z.boolean(),
    fov: z.number().min(SETTINGS_LIMITS.fov.min).max(SETTINGS_LIMITS.fov.max),
    musicVolume: volume,
    sfxVolume: volume,
    music: z.enum(['generated', 'file', 'off']),
    graphics: z.enum(['high', 'low']),
    assist: z.boolean(),
  })
  .partial();

export function loadSettings(storage: KeyValueStorage | null = browserStorage()): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = StoredSettings.safeParse(JSON.parse(raw));
    return parsed.success ? { ...DEFAULT_SETTINGS, ...parsed.data } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Whether a settings change should open the music file picker: only when the
 * player has just picked "My music" with no file loaded, never on other
 * changes (a volume slider sends a change for every step of a drag).
 */
export function wantsMusicFile(changed: keyof Settings, settings: Settings, hasFile: boolean): boolean {
  return changed === 'music' && settings.music === 'file' && !hasFile;
}

export function saveSettings(settings: Settings, storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, blocked cookies). Settings still apply for this session.
  }
}
