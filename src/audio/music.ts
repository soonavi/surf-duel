/**
 * Procedural soundtrack: an 8-bar synthwave loop composed from a theme's
 * mood and a seed (the course key), so every course has its own tune and
 * the same course always sounds the same. Pure data in, pure data out (notes
 * and drum hits by sixteenth-note step); engine.ts plays it with Web Audio.
 * No samples, no files, nothing to license.
 */
import type { ThemeName } from '../course/schema.js';
import { createRng } from '../util/rng.js';

export const STEPS_PER_BAR = 16;
export const SONG_BARS = 8;

export type DrumStyle = 'backbeat' | 'broken' | 'pulse' | 'drive' | 'half';

export interface Mood {
  bpm: number;
  /** MIDI note of the key's root in the bass octave. */
  root: number;
  /** Scale as semitones above the root (7 notes). */
  scale: readonly number[];
  /** Chord roots as scale degrees (0-based), one chord per two bars. */
  progressions: readonly (readonly number[])[];
  drums: DrumStyle;
  /** Arpeggio speed: notes per beat. */
  arpRate: 2 | 4;
}

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
} as const;

/** Each theme's sound: neon is classic synthwave, lava drives, ice floats, desert sways, void broods. */
export const THEME_MOODS: Readonly<Record<ThemeName, Mood>> = {
  neon: { bpm: 104, root: 45, scale: SCALES.minor, progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6]], drums: 'backbeat', arpRate: 4 },
  desert: { bpm: 92, root: 50, scale: SCALES.harmonicMinor, progressions: [[0, 5, 4, 0], [0, 3, 4, 4], [0, 6, 5, 4]], drums: 'broken', arpRate: 2 },
  ice: { bpm: 96, root: 52, scale: SCALES.lydian, progressions: [[0, 1, 4, 3], [0, 4, 5, 1], [0, 1, 0, 4]], drums: 'pulse', arpRate: 4 },
  lava: { bpm: 128, root: 43, scale: SCALES.phrygian, progressions: [[0, 1, 0, 6], [0, 5, 6, 1], [0, 3, 1, 0]], drums: 'drive', arpRate: 4 },
  void: { bpm: 86, root: 41, scale: SCALES.dorian, progressions: [[0, 3, 6, 4], [0, 6, 3, 4], [0, 2, 3, 6]], drums: 'half', arpRate: 2 },
};

export interface Note {
  step: number;
  midi: number;
  /** Length in steps. */
  steps: number;
  /** 0–1. */
  velocity: number;
}

export interface Song {
  bpm: number;
  /** Steps in the loop. */
  steps: number;
  bass: Note[];
  arp: Note[];
  pad: Note[];
  kick: number[];
  snare: number[];
  hat: number[];
}

/** One sixteenth note, in seconds. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/** MIDI note of scale degree `degree` (may run past 7: next octave up) above `base`. */
function degreeNote(mood: Mood, base: number, degree: number): number {
  const octave = Math.floor(degree / 7);
  return base + mood.scale[((degree % 7) + 7) % 7]! + 12 * octave;
}

/** Drum hits within one bar, by style. Bar 7 (the last) gets a fill. */
function drumBar(style: DrumStyle, fill: boolean): { kick: number[]; snare: number[]; hat: number[] } {
  const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
  const offbeats = [2, 6, 10, 14];
  const sixteenths = Array.from({ length: 16 }, (_, i) => i);
  let bar: { kick: number[]; snare: number[]; hat: number[] };
  switch (style) {
    case 'backbeat':
      bar = { kick: [0, 8, 10], snare: [4, 12], hat: eighths };
      break;
    case 'broken':
      bar = { kick: [0, 6, 10], snare: [4, 12], hat: [0, 3, 4, 6, 8, 11, 12, 14] };
      break;
    case 'pulse':
      bar = { kick: [0, 8], snare: [12], hat: offbeats };
      break;
    case 'drive':
      bar = { kick: [0, 4, 8, 12], snare: [4, 12], hat: sixteenths };
      break;
    case 'half':
      bar = { kick: [0, 10], snare: [8], hat: offbeats };
      break;
  }
  if (fill) bar = { ...bar, snare: [...new Set([...bar.snare, 13, 14, 15])].sort((a, b) => a - b) };
  return bar;
}

const BASS_RHYTHMS: readonly (readonly { at: number; len: number; fifth?: boolean }[])[] = [
  // Driving eighths.
  [0, 2, 4, 6, 8, 10, 12, 14].map((at) => ({ at, len: 2 })),
  // Syncopated, with a fifth.
  [{ at: 0, len: 3 }, { at: 3, len: 3 }, { at: 6, len: 2 }, { at: 8, len: 3 }, { at: 11, len: 3, fifth: true }, { at: 14, len: 2 }],
  // Sparse and long.
  [{ at: 0, len: 6 }, { at: 6, len: 2, fifth: true }, { at: 8, len: 6 }, { at: 14, len: 2 }],
];

/** Arpeggio shapes over a chord's tones (0 root, 1 third, 2 fifth, 3 octave). */
const ARP_SHAPES: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [0, 2, 1, 3, 2, 1],
  [3, 2, 1, 0],
  [0, 2, 3, 2],
];

export function composeSong(mood: Mood, seed: number): Song {
  const rng = createRng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
  const progression = pick(mood.progressions);
  const bassRhythm = pick(BASS_RHYTHMS);
  const arpShape = pick(ARP_SHAPES);
  const arpStep = 4 / mood.arpRate;

  const song: Song = { bpm: mood.bpm, steps: SONG_BARS * STEPS_PER_BAR, bass: [], arp: [], pad: [], kick: [], snare: [], hat: [] };
  const barsPerChord = SONG_BARS / progression.length;

  for (let c = 0; c < progression.length; c++) {
    const degree = progression[c]!;
    const chordStart = c * barsPerChord * STEPS_PER_BAR;
    const chordSteps = barsPerChord * STEPS_PER_BAR;
    const tones = [0, 2, 4, 7].map((k) => degreeNote(mood, mood.root + 24, degree + k)); // root, third, fifth, octave

    // Pad: the triad, held for the whole chord, an octave above the bass.
    for (const k of [0, 2, 4]) song.pad.push({ step: chordStart, midi: degreeNote(mood, mood.root + 12, degree + k), steps: chordSteps, velocity: 0.5 });

    for (let b = 0; b < barsPerChord; b++) {
      const barStart = chordStart + b * STEPS_PER_BAR;
      for (const hit of bassRhythm) {
        song.bass.push({
          step: barStart + hit.at,
          midi: degreeNote(mood, mood.root, degree + (hit.fifth ? 4 : 0)),
          steps: hit.len,
          velocity: hit.at % 4 === 0 ? 0.9 : 0.7,
        });
      }
      // Arpeggio: cycle the shape; the last bar of the loop climbs an octave for a lift into the repeat.
      const lift = barStart >= (SONG_BARS - 1) * STEPS_PER_BAR ? 12 : 0;
      for (let s = 0, i = 0; s < STEPS_PER_BAR; s += arpStep, i++) {
        const tone = tones[arpShape[i % arpShape.length]!]!;
        song.arp.push({ step: barStart + s, midi: tone + lift, steps: arpStep, velocity: s % 4 === 0 ? 0.85 : 0.6 });
      }
    }
  }

  for (let bar = 0; bar < SONG_BARS; bar++) {
    const hits = drumBar(mood.drums, bar === SONG_BARS - 1);
    const at = bar * STEPS_PER_BAR;
    song.kick.push(...hits.kick.map((s) => at + s));
    song.snare.push(...hits.snare.map((s) => at + s));
    song.hat.push(...hits.hat.map((s) => at + s));
  }
  return song;
}
