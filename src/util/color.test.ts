import { describe, expect, it } from 'vitest';
import { contrast, lighten, luminance, mix, normalizeHex, separate } from './color.js';

describe('normalizeHex', () => {
  it('accepts #rrggbb and #rgb in any case, and refuses anything else', () => {
    expect(normalizeHex('#FF69B4')).toBe('#ff69b4');
    expect(normalizeHex('#f6b')).toBe('#ff66bb');
    expect(normalizeHex(' #ff69b4 ')).toBe('#ff69b4');
    for (const bad of ['pink', 'ff69b4', '#ff69b', '#ff69b4ff', 'url(x)', '', 12, null]) expect(normalizeHex(bad)).toBeNull();
  });
});

describe('luminance and contrast (WCAG)', () => {
  it('runs from black to white', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#ff69b4', '#ff69b4')).toBe(1);
    expect(contrast('#ffffff', '#767676')).toBeCloseTo(4.54, 1);
  });
});

describe('mix', () => {
  it('blends two colours', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });
});

describe('lighten', () => {
  it('raises a dark colour to at least the luminance asked for, keeping its hue', () => {
    const navy = lighten('#000040', 0.2);
    expect(luminance(navy)).toBeGreaterThanOrEqual(0.2);
    expect(lighten('#ffd27a', 0.2)).toBe('#ffd27a');
  });
});

describe('separate', () => {
  it('leaves colours that already differ alone', () => {
    expect(separate('#ff4fa3', '#ffd1e6', 1.5)).toBe('#ffd1e6');
  });

  it('pushes a look-alike lighter or darker until the two read apart', () => {
    for (const [a, b] of [['#ff69b4', '#ff6eb8'], ['#202020', '#252525'], ['#f0f0f0', '#ffffff'], ['#e03030', '#30a030']]) {
      const out = separate(a!, b!, 1.5);
      expect(contrast(a!, out)).toBeGreaterThanOrEqual(1.5);
    }
  });
});
