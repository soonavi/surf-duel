/**
 * Small sRGB colour helpers for course colours: parsing, blending, and WCAG
 * luminance/contrast, which keep custom colours readable (the two ramp
 * sides tell you which key to hold, so they must never look alike).
 * Colours are lower-case "#rrggbb" strings throughout.
 */

const HEX6 = /^#[0-9a-f]{6}$/;
const HEX3 = /^#[0-9a-f]{3}$/;

/** "#RRGGBB" or "#rgb" in any case as "#rrggbb", or null for anything else. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (HEX6.test(v)) return v;
  if (HEX3.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `a` blended `t` of the way to `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return hex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(color);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 (same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color`, blended toward white just enough to reach `minLuminance`. */
export function lighten(color: string, minLuminance: number): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(color, '#ffffff', t);
    if (luminance(c) >= minLuminance) return c;
  }
  return '#ffffff';
}

/**
 * `b`, made lighter or darker (whichever needs less change) until it has at
 * least `minContrast` against `a`. Hue alone isn't enough: red and green
 * look alike to many colour-blind players.
 */
export function separate(a: string, b: string, minContrast: number): string {
  if (contrast(a, b) >= minContrast) return b;
  const toward = (target: string): string | null => {
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const c = mix(b, target, t);
      if (contrast(a, c) >= minContrast) return c;
    }
    return null;
  };
  const lighter = toward('#ffffff');
  const darker = toward('#000000');
  if (lighter && darker) return contrast(b, lighter) <= contrast(b, darker) ? lighter : darker;
  return lighter ?? darker ?? (luminance(a) > 0.18 ? '#000000' : '#ffffff');
}
