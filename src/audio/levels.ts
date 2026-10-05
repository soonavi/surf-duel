/**
 * The numbers behind the audio and the equalizer, kept pure so they're
 * tested: how the soundtrack builds with intensity, how speed maps to
 * intensity, and how analyser data becomes bars and a beat pulse.
 */

export interface MixLevels {
  pad: number;
  bass: number;
  kick: number;
  arp: number;
  hat: number;
  snare: number;
  /** The music bus's low-pass cutoff: muffled when calm, open at full tilt. */
  cutoffHz: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** 0 below `from`, 1 above `to`, smooth in between. */
const ramp = (x: number, from: number, to: number): number => {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/**
 * Layer volumes at an intensity from 0 (start pad, menus) to 1 (flat out):
 * pads always, then bass and kick, then the arpeggio, then hats and snare.
 */
export function mixLevels(intensity: number): MixLevels {
  const x = clamp01(intensity);
  return {
    pad: 0.55 + 0.25 * x,
    bass: 0.35 + 0.65 * ramp(x, 0.05, 0.35),
    kick: ramp(x, 0.15, 0.4),
    arp: ramp(x, 0.3, 0.6),
    hat: ramp(x, 0.5, 0.8),
    snare: ramp(x, 0.55, 0.85),
    cutoffHz: 500 * Math.pow(36, x), // 500 Hz → 18 kHz, even steps to the ear
  };
}

/** How intense the music should be at a given speed (u/s): calm on the pad, full at surf speed. */
export function speedIntensity(speed: number): number {
  return clamp01(0.2 + (0.8 * Math.max(0, speed)) / 2800);
}

/**
 * `bars` bars from analyser frequency bytes (0–255), spaced logarithmically
 * (as hearing is) so the low end isn't squashed into one bar. Each 0–1.
 */
export function spectrumBars(data: ArrayLike<number>, bars: number): number[] {
  const n = data.length;
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(Math.pow(n, b / bars)) - 1;
    const to = Math.max(from + 1, Math.floor(Math.pow(n, (b + 1) / bars)) - 1);
    let peak = 0;
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) peak = Math.max(peak, data[i]!);
    out.push(peak / 255);
  }
  return out;
}

/** Bass energy (0–1) from the lowest bins: kick drums and bass lines. */
export function bassLevel(data: ArrayLike<number>, bins = 4): number {
  let sum = 0;
  for (let i = 0; i < bins && i < data.length; i++) sum += data[i]!;
  return sum / (bins * 255);
}

/** The beat pulse for visuals: jumps up with a hit, then falls back over about a third of a second. */
export function followPulse(previous: number, level: number, dt: number): number {
  if (level > previous) return previous + (level - previous) * Math.min(1, dt * 40);
  return previous * Math.exp(-dt * 5);
}
