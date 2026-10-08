/**
 * A course's look: its theme, repainted in the course's own colours when it
 * has them (an AI course asked to be "all pink"). Three colours come from
 * the course (sky, and the two ramp sides); everything else is shaded from
 * them so it stays readable: grid lines contrast with their surface, the
 * A/D key colours show on dark UI panels, and gates show against the sky.
 * The theme keeps the mood: music, fog distance, and its label.
 */
import type { Course, CourseColors } from '../course/schema.js';
import { contrast, lighten, luminance, mix, separate } from '../util/color.js';
import { THEME_DEFS, type RampColors, type SurfaceColors, type Theme } from './themes.js';

/** Least contrast between a surface and its grid lines. */
const LINE_CONTRAST = 2.2;
/** Gates and boosters are picked to stand out at least this much against the sky. */
const GATE_CONTRAST = 3.5;

export function courseTheme(course: Pick<Course, 'theme' | 'colors'>): Theme {
  const base = THEME_DEFS[course.theme];
  return course.colors ? paintTheme(base, course.colors) : base;
}

/** How a course's look is named on cards: its theme, or "Custom colours". */
export function themeLabel(course: Pick<Course, 'theme' | 'colors'>): string {
  return course.colors ? 'Custom colours' : THEME_DEFS[course.theme].label;
}

/** Grid lines for a surface: darker on light surfaces, lighter on dark ones, same hue. */
function lineFor(face: string): string {
  const target = luminance(face) > 0.3 ? '#000000' : '#ffffff';
  for (let t = 0.1; t <= 1.0001; t += 0.05) {
    const c = mix(face, target, t);
    if (contrast(face, c) >= LINE_CONTRAST) return c;
  }
  return target;
}

function surface(face: string): SurfaceColors {
  return { base: face, line: lineFor(face) };
}

function ramp(face: string): RampColors {
  return { ...surface(face), ui: lighten(face, 0.2) };
}

function paintTheme(base: Theme, c: CourseColors): Theme {
  const dark = luminance(c.sky) < 0.15;
  const rampRight = ramp(c.ramp);
  const rampLeft = ramp(c.ramp2);
  const pad = surface(mix(c.ramp, c.ramp2, 0.5));
  const finish = surface(mix(pad.base, '#ffffff', 0.4));

  // Gates: the first colour in keeping with the course that stands out against the sky, else white or near-black.
  const candidates = [base.accent, rampRight.line, c.ramp, c.ramp2];
  const accent =
    candidates.find((x) => contrast(x, c.sky) >= GATE_CONTRAST) ??
    (contrast('#ffffff', c.sky) >= contrast('#111018', c.sky) ? '#ffffff' : '#111018');
  const booster = contrast(base.booster, c.sky) >= 2 ? base.booster : accent;

  let ground: SurfaceColors | null = null;
  if (base.ground) {
    const floor = mix(c.sky, '#000000', dark ? 0.25 : 0.18);
    ground = { base: floor, line: separate(floor, mix(floor, c.ramp, 0.5), 1.4) };
  }

  return {
    label: base.label,
    sky: { horizon: c.sky, zenith: dark ? mix(c.sky, '#000000', 0.5) : mix(c.sky, c.ramp, 0.35), nadir: mix(c.sky, '#000000', dark ? 0.3 : 0.12) },
    fog: base.fog,
    rampRight,
    rampLeft,
    pad,
    finish,
    accent,
    booster,
    ground,
    swatch: [c.ramp, c.ramp2],
  };
}
