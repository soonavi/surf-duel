import { describe, expect, it } from 'vitest';
import { bassLevel, busGains, followPulse, mixLevels, settleBars, spectrumBars, speedIntensity } from './levels.js';

describe('mixLevels', () => {
  it('builds up layer by layer as intensity rises', () => {
    const calm = mixLevels(0);
    const mid = mixLevels(0.5);
    const full = mixLevels(1);
    expect(calm.pad).toBeGreaterThan(0); // something is always playing
    expect(calm.hat).toBe(0);
    expect(calm.arp).toBe(0);
    for (const layer of ['pad', 'bass', 'kick', 'arp', 'hat', 'snare'] as const) {
      expect(mid[layer], layer).toBeGreaterThanOrEqual(calm[layer]);
      expect(full[layer], layer).toBeGreaterThanOrEqual(mid[layer]);
      expect(full[layer], layer).toBeLessThanOrEqual(1);
    }
    expect(full.hat).toBeGreaterThan(0);
    expect(full.arp).toBeGreaterThan(0);
  });

  it('opens the filter as it gets more intense', () => {
    expect(mixLevels(0).cutoffHz).toBeLessThan(mixLevels(0.5).cutoffHz);
    expect(mixLevels(0.5).cutoffHz).toBeLessThan(mixLevels(1).cutoffHz);
    expect(mixLevels(1).cutoffHz).toBeLessThanOrEqual(20_000);
  });

  it('clamps out-of-range input', () => {
    expect(mixLevels(-3)).toEqual(mixLevels(0));
    expect(mixLevels(7)).toEqual(mixLevels(1));
  });
});

describe('speedIntensity', () => {
  it('rises with speed from calm to flat out', () => {
    expect(speedIntensity(0)).toBeLessThan(0.3);
    expect(speedIntensity(1500)).toBeGreaterThan(speedIntensity(500));
    expect(speedIntensity(3500)).toBe(1);
    expect(speedIntensity(10_000)).toBe(1);
  });
});

describe('busGains', () => {
  it('is silent at 0 and loudest at 1, rising evenly between', () => {
    expect(busGains(0, 0)).toEqual({ music: 0, file: 0, sfx: 0 });
    let last = busGains(0, 0);
    for (let v = 0.1; v <= 1; v += 0.1) {
      const now = busGains(v, v);
      expect(now.music).toBeGreaterThan(last.music);
      expect(now.file).toBeGreaterThan(last.file);
      expect(now.sfx).toBeGreaterThan(last.sfx);
      last = now;
    }
  });

  it('keeps the music well under the effects at the default volumes', () => {
    // Measured in Chrome: a music bus gain of 0.2 made the generated soundtrack as loud
    // as the countdown beep (RMS ~0.08 vs ~0.09 at an effects bus gain of 0.45). Music
    // is background: at least 10 dB quieter than that.
    const g = busGains(0.6, 0.8);
    expect(g.music).toBeLessThanOrEqual(0.2 * 10 ** (-10 / 20));
    // A mastered music file is about as loud as the generated mix flat out: trim it to match.
    expect(g.file).toBeLessThanOrEqual(g.music * 1.5);
  });

  it('plays the effects a notch under the level the beep was measured at', () => {
    // User, Oct 6 2026: the effects at 0.448 were "a little too loud". About 3 dB less.
    const db = 20 * Math.log10(busGains(0.6, 0.8).sfx / 0.448);
    expect(db).toBeLessThanOrEqual(-2.5);
    expect(db).toBeGreaterThanOrEqual(-4);
  });
});

/** Analyser bins at 48 kHz with fftSize 2048. */
const BIN_HZ = 48_000 / 2048;
const binOf = (hz: number): number => Math.round(hz / BIN_HZ);

describe('spectrumBars', () => {
  it('turns analyser bytes into bars between 0 and 1', () => {
    const data = new Uint8Array(1024).fill(255);
    const bars = spectrumBars(data, 16, BIN_HZ);
    expect(bars).toHaveLength(16);
    for (const b of bars) expect(b).toBeCloseTo(1);
    expect(spectrumBars(new Uint8Array(1024), 16, BIN_HZ).every((b) => b === 0)).toBe(true);
  });

  it('gives every bar its own slice of the spectrum: no runs of identical bars', () => {
    // A smooth spectrum, falling with frequency: the bars must fall smoothly too.
    const data = Array.from({ length: 1024 }, (_, i) => 255 - i * 0.2);
    const bars = spectrumBars(data, 48, BIN_HZ);
    for (let i = 1; i < bars.length; i++) expect(bars[i], `bar ${i}`).toBeLessThan(bars[i - 1]!);
  });

  it('spaces the bars like hearing does: the low end gets more of them', () => {
    const data = new Uint8Array(1024);
    data.fill(255, 0, binOf(200)); // only the bass is loud
    const bars = spectrumBars(data, 16, BIN_HZ);
    expect(bars.filter((b) => b > 0.5).length).toBeGreaterThan(2);
  });

  it("covers the music's range, not the inaudible top end", () => {
    const at = (hz: number): number[] => {
      const data = new Uint8Array(1024);
      data[binOf(hz)] = 255;
      return spectrumBars(data, 32, BIN_HZ);
    };
    const lit = (bars: number[]): number => bars.findIndex((b) => b > 0.5);
    expect(lit(at(60))).toBeGreaterThanOrEqual(0);
    expect(lit(at(60))).toBeLessThan(8);
    expect(lit(at(8000))).toBeGreaterThan(24);
    expect(at(20_000).every((b) => b === 0)).toBe(true);
  });
});

describe('settleBars', () => {
  const FRAME = 1 / 60;

  it('rises to a hit within a few frames', () => {
    let shown = [0];
    for (let i = 0; i < 3; i++) shown = settleBars(shown, [1], FRAME);
    expect(shown[0]).toBeGreaterThan(0.9);
  });

  it('falls back gently instead of flickering', () => {
    let shown = [1];
    const fallen: number[] = [];
    for (let i = 0; i < 30; i++) fallen.push((shown = settleBars(shown, [0], FRAME))[0]!);
    expect(fallen[0]).toBeGreaterThan(0.85); // one quiet frame doesn't blank a bar
    expect(fallen[29]).toBeLessThan(0.25); // gone within half a second
  });

  it('starts fresh when the bar count changes', () => {
    expect(settleBars([0.5, 0.5], [1, 1, 1], FRAME)).toHaveLength(3);
  });
});

describe('bassLevel', () => {
  it('reads the low end only', () => {
    const lows = new Uint8Array(1024);
    lows.fill(255, 0, binOf(160));
    const highs = new Uint8Array(1024);
    highs.fill(255, binOf(400));
    expect(bassLevel(lows, BIN_HZ)).toBeGreaterThan(0.8);
    expect(bassLevel(highs, BIN_HZ)).toBe(0);
  });
});

describe('followPulse', () => {
  it('jumps up with a beat and falls back gently', () => {
    const up = followPulse(0, 1, 1 / 60);
    expect(up).toBeGreaterThan(0.5);
    let p = 1;
    const fallen: number[] = [];
    for (let i = 0; i < 30; i++) fallen.push((p = followPulse(p, 0, 1 / 60)));
    expect(fallen[0]).toBeGreaterThan(0.85); // not a flicker
    expect(fallen[29]).toBeLessThan(0.3); // gone within half a second
  });
});
