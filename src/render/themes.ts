import type { ThemeName } from '../course/schema';
import type { SkyColors } from './materials';

export interface SurfaceColors {
  base: string;
  line: string;
}

export interface Theme {
  label: string;
  sky: SkyColors;
  fog: { near: number; far: number };
  /** Ramps on your right (hold D) and two-sided ramps. */
  rampRight: SurfaceColors;
  /** Ramps on your left (hold A). A different colour so the key to hold is readable at a glance. */
  rampLeft: SurfaceColors;
  pad: SurfaceColors;
  finish: SurfaceColors;
  /** Start, checkpoint and finish gates. */
  accent: string;
  booster: string;
  /** Far-below backdrop plane; null for an endless void. */
  ground: SurfaceColors | null;
  /** UI accent used for this theme's swatch on course cards. */
  swatch: [string, string];
}

export const THEME_DEFS: Readonly<Record<ThemeName, Theme>> = {
  neon: {
    label: 'Neon',
    sky: { zenith: '#07051a', horizon: '#3b1a6b', nadir: '#0a0418' },
    fog: { near: 6000, far: 45000 },
    rampRight: { base: '#2a1f5c', line: '#ff4fd8' },
    rampLeft: { base: '#16285a', line: '#3ee6ff' },
    pad: { base: '#1d1840', line: '#a78bfa' },
    finish: { base: '#3a2a10', line: '#ffd27a' },
    // Not cyan: that colour already means "ramp on your left, hold A".
    accent: '#f3f0ff',
    booster: '#ffd27a',
    ground: { base: '#0d0a24', line: '#5a3bb0' },
    swatch: ['#ff4fd8', '#3ee6ff'],
  },
  desert: {
    label: 'Desert',
    sky: { zenith: '#3a7bd5', horizon: '#f6c28b', nadir: '#c98b4f' },
    fog: { near: 5000, far: 40000 },
    rampRight: { base: '#d9a066', line: '#7a3d14' },
    rampLeft: { base: '#c27c45', line: '#fff1d6' },
    pad: { base: '#e8c28e', line: '#9a5b2a' },
    finish: { base: '#ffe2a8', line: '#d9480f' },
    accent: '#1fb5a8',
    booster: '#ff6b35',
    ground: { base: '#dcae78', line: '#b98149' },
    swatch: ['#f6c28b', '#d9480f'],
  },
  ice: {
    label: 'Ice',
    sky: { zenith: '#7fbfff', horizon: '#e8f6ff', nadir: '#b8d8ef' },
    fog: { near: 5000, far: 40000 },
    rampRight: { base: '#8fc1f2', line: '#1d5fae' },
    rampLeft: { base: '#b3a3f7', line: '#4b2fd6' },
    pad: { base: '#d7ecff', line: '#4f86c6' },
    finish: { base: '#ffffff', line: '#ff4f86' },
    accent: '#ff4f86',
    booster: '#4b2fd6',
    ground: { base: '#c9e3f7', line: '#8db6da' },
    swatch: ['#8fc1f2', '#4b2fd6'],
  },
  lava: {
    label: 'Lava',
    sky: { zenith: '#120404', horizon: '#5a1206', nadir: '#ff4500' },
    fog: { near: 6000, far: 42000 },
    rampRight: { base: '#2a0e0a', line: '#ff6a1a' },
    rampLeft: { base: '#1e0b0b', line: '#ffb21a' },
    pad: { base: '#2b1410', line: '#ff8a3d' },
    finish: { base: '#331a08', line: '#ffd23f' },
    accent: '#ffd23f',
    booster: '#ff3b1a',
    ground: { base: '#ff4a12', line: '#ffb000' },
    swatch: ['#ff6a1a', '#ffd23f'],
  },
  void: {
    label: 'Void',
    sky: { zenith: '#000000', horizon: '#0d0d18', nadir: '#000000' },
    fog: { near: 8000, far: 50000 },
    rampRight: { base: '#efeff6', line: '#15152a' },
    rampLeft: { base: '#d6d3ea', line: '#6c4cff' },
    pad: { base: '#e6e6ee', line: '#15152a' },
    finish: { base: '#ffffff', line: '#ff2e63' },
    accent: '#6c4cff',
    booster: '#ff2e63',
    ground: null,
    swatch: ['#efeff6', '#6c4cff'],
  },
};
