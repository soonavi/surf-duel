import { describe, expect, it } from 'vitest';
import { courseTheme } from './palette.js';
import { THEME_DEFS } from './themes.js';
import { THEMES, type CourseColors } from '../course/schema.js';
import { contrast, luminance } from '../util/color.js';

/** Colour requests players might make, light and dark. */
const PALETTES: Record<string, CourseColors> = {
  'all pink': { sky: '#ffc0e0', ramp: '#ff4fa3', ramp2: '#ffd1e6' },
  'black and gold': { sky: '#0a0a0a', ramp: '#d4af37', ramp2: '#6b5414' },
  'forest green': { sky: '#cfe8c8', ramp: '#2e7d32', ramp2: '#9ccc65' },
  'midnight blue': { sky: '#0b1030', ramp: '#1e3a8a', ramp2: '#60a5fa' },
  'all white': { sky: '#ffffff', ramp: '#f2f2f2', ramp2: '#bdbdbd' },
  'all black': { sky: '#000000', ramp: '#111111', ramp2: '#3a3a3a' },
};

describe('courseTheme', () => {
  it("is the theme's own look for a course without colours", () => {
    for (const theme of THEMES) expect(courseTheme({ theme })).toBe(THEME_DEFS[theme]);
  });

  it('paints the sky and ramps the asked-for colours, keeping the theme mood', () => {
    const t = courseTheme({ theme: 'neon', colors: PALETTES['all pink'] });
    expect(t.sky.horizon).toBe('#ffc0e0');
    expect(t.rampRight.base).toBe('#ff4fa3');
    expect(t.rampLeft.base).toBe('#ffd1e6');
    expect(t.swatch).toEqual(['#ff4fa3', '#ffd1e6']);
    expect(t.fog).toEqual(THEME_DEFS.neon.fog);
    expect(t.label).toBe(THEME_DEFS.neon.label);
  });

  for (const [name, colors] of Object.entries(PALETTES)) {
    describe(name, () => {
      const t = courseTheme({ theme: 'void', colors });

      it('keeps grid lines visible on every surface (they show your speed)', () => {
        for (const s of [t.rampRight, t.rampLeft, t.pad, t.finish]) expect(contrast(s.base, s.line)).toBeGreaterThanOrEqual(1.8);
        if (t.ground) expect(contrast(t.ground.base, t.ground.line)).toBeGreaterThanOrEqual(1.3);
      });

      it('shows the A/D key colours readably on the dark UI panels', () => {
        for (const s of [t.rampRight, t.rampLeft]) expect(luminance(s.ui)).toBeGreaterThanOrEqual(0.18);
      });

      it('keeps the gates visible against the sky', () => {
        const sky = String(t.sky.horizon);
        expect(contrast(t.accent, sky)).toBeGreaterThanOrEqual(3);
        expect(contrast(t.booster, sky)).toBeGreaterThanOrEqual(2);
      });
    });
  }
});
