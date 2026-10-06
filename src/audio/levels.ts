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
 * Each bus's gain at full volume. Music is background: measured in Chrome, the
 * generated soundtrack at a bus gain of 0.2 was as loud as the countdown beep,
 * so it sits well under that. A mastered music file is about as loud as the
 * generated mix flat out. The effects were "a little too loud" at 0.7 (user,
 * Oct 2026): 0.5 is about 3 dB quieter.
 */
const MUSIC_TRIM = 0.17;
const FILE_TRIM = 0.25;
const SFX_TRIM = 0.5;

/** Bus gains for the volume sliders (0–1), squared so the sliders feel even to the ear. */
export function busGains(music: number, sfx: number): { music: number; file: number; sfx: number } {
  const m = clamp01(music) ** 2;
  return { music: m * MUSIC_TRIM, file: m * FILE_TRIM, sfx: clamp01(sfx) ** 2 * SFX_TRIM };
}

/** The equalizer's range: where the music is (the top octave is inaudible or empty). */
const BARS_FROM_HZ = 40;
const BARS_TO_HZ = 12_000;

/** The spectrum between bins, at a fractional bin index. */
function binValue(data: ArrayLike<number>, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i >= data.length) return 0;
  const next = i + 1 < data.length ? data[i + 1]! : 0;
  return data[i]! + (next - data[i]!) * (x - i);
}

/**
 * `bars` bars from analyser frequency bytes (0–255, each bin `binHz` wide),
 * spaced logarithmically from 40 Hz to 12 kHz (as hearing is). Each bar is
 * the loudest point of its own slice of the spectrum, read between bins
 * where a slice is narrower than one, so no two bars are copies. Each 0–1.
 */
export function spectrumBars(data: ArrayLike<number>, bars: number, binHz: number): number[] {
  const ratio = BARS_TO_HZ / BARS_FROM_HZ;
  const edge = (b: number): number => (BARS_FROM_HZ * Math.pow(ratio, b / bars)) / binHz;
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const lo = edge(b);
    const hi = edge(b + 1);
    let peak = Math.max(binValue(data, lo), binValue(data, hi));
    for (let i = Math.ceil(lo); i < hi && i < data.length; i++) peak = Math.max(peak, data[i]!);
    out.push(clamp01(peak / 255));
  }
  return out;
}

/**
 * Equalizer bars on screen, eased toward the analyser's: up to a hit within a
 * few frames, then down gently, so they move with the music instead of flickering.
 */
export function settleBars(shown: readonly number[], target: readonly number[], dt: number): number[] {
  if (shown.length !== target.length) return [...target];
  const rise = Math.min(1, dt * 35);
  const fall = Math.exp(-dt * 5);
  return target.map((t, i) => {
    const s = shown[i]!;
    return t > s ? s + (t - s) * rise : t + (s - t) * fall;
  });
}

/** Bass energy (0–1) up to `upToHz`: kick drums and bass lines. */
export function bassLevel(data: ArrayLike<number>, binHz: number, upToHz = 160): number {
  const bins = Math.max(1, Math.min(data.length, Math.round(upToHz / binHz)));
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += data[i]!;
  return sum / (bins * 255);
}

/** The beat pulse for visuals: jumps up with a hit, then falls back over about a third of a second. */
export function followPulse(previous: number, level: number, dt: number): number {
  if (level > previous) return previous + (level - previous) * Math.min(1, dt * 40);
  return previous * Math.exp(-dt * 5);
}
