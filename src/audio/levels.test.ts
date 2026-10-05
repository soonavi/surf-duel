import { describe, expect, it } from 'vitest';
import { bassLevel, followPulse, mixLevels, spectrumBars, speedIntensity } from './levels';

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

describe('spectrumBars', () => {
  it('turns analyser bytes into bars between 0 and 1', () => {
    const data = new Uint8Array(128).fill(255);
    const bars = spectrumBars(data, 16);
    expect(bars).toHaveLength(16);
    for (const b of bars) expect(b).toBeCloseTo(1);
    expect(spectrumBars(new Uint8Array(128), 16).every((b) => b === 0)).toBe(true);
  });

  it('spaces the bars like hearing does: the low end gets more of them', () => {
    const data = new Uint8Array(128);
    data.fill(255, 0, 8); // only the lowest 8 bins are loud
    const bars = spectrumBars(data, 16);
    expect(bars.filter((b) => b > 0.5).length).toBeGreaterThan(2);
  });
});

describe('bassLevel', () => {
  it('reads the low end only', () => {
    const lows = new Uint8Array(128);
    lows.fill(255, 0, 4);
    const highs = new Uint8Array(128);
    highs.fill(255, 64);
    expect(bassLevel(lows)).toBeGreaterThan(0.8);
    expect(bassLevel(highs)).toBe(0);
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
