import { z } from 'zod';

/** Player-facing settings, persisted to localStorage when available. */
export interface Settings {
  /** Source-style sensitivity: degrees per mouse count = sensitivity × 0.022. */
  sensitivity: number;
  invertY: boolean;
  /** Ask for unaccelerated mouse input when pointer lock supports it. */
  rawInput: boolean;
  /** Vertical field of view in degrees. */
  fov: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sensitivity: 2,
  invertY: false,
  rawInput: true,
  fov: 75,
});

export const SETTINGS_LIMITS = {
  sensitivity: { min: 0.1, max: 10, step: 0.05 },
  fov: { min: 60, max: 100, step: 1 },
} as const;

const STORAGE_KEY = 'surfduel.settings.v1';

const StoredSettings = z
  .object({
    sensitivity: z.number().min(SETTINGS_LIMITS.sensitivity.min).max(SETTINGS_LIMITS.sensitivity.max),
    invertY: z.boolean(),
    rawInput: z.boolean(),
    fov: z.number().min(SETTINGS_LIMITS.fov.min).max(SETTINGS_LIMITS.fov.max),
  })
  .partial();

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = StoredSettings.safeParse(JSON.parse(raw));
    return parsed.success ? { ...DEFAULT_SETTINGS, ...parsed.data } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, blocked cookies). Settings still apply for this session.
  }
}
