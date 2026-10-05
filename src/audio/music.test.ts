import { describe, expect, it } from 'vitest';
import { SONG_BARS, STEPS_PER_BAR, THEME_MOODS, composeSong, stepSeconds, type Song } from './music';
import { THEMES } from '../course/schema';

const melodic = (song: Song) => [...song.bass, ...song.arp, ...song.pad];

describe('THEME_MOODS', () => {
  it('gives every theme a mood with a sensible tempo and a 7-note scale', () => {
    for (const theme of THEMES) {
      const mood = THEME_MOODS[theme];
      expect(mood.bpm, theme).toBeGreaterThanOrEqual(80);
      expect(mood.bpm, theme).toBeLessThanOrEqual(140);
      expect(mood.scale).toHaveLength(7);
      expect(mood.progressions.length).toBeGreaterThan(0);
    }
  });

  it('gives the themes different feels (not one tune at five tempos)', () => {
    const feels = new Set(THEMES.map((t) => `${THEME_MOODS[t].bpm}|${THEME_MOODS[t].scale.join(',')}|${THEME_MOODS[t].drums}`));
    expect(feels.size).toBe(THEMES.length);
  });
});

describe('composeSong', () => {
  it('is the same tune for the same course (seed), and a different one for another', () => {
    const mood = THEME_MOODS.neon;
    expect(composeSong(mood, 42)).toEqual(composeSong(mood, 42));
    expect(composeSong(mood, 42)).not.toEqual(composeSong(mood, 43));
  });

  for (const theme of THEMES) {
    it(`stays in key and in time on ${theme}`, () => {
      const mood = THEME_MOODS[theme];
      for (const seed of [1, 7, 1234]) {
        const song = composeSong(mood, seed);
        expect(song.steps).toBe(SONG_BARS * STEPS_PER_BAR);
        expect(song.bpm).toBe(mood.bpm);
        const inKey = new Set(mood.scale.map((d) => (mood.root + d) % 12));
        for (const n of melodic(song)) {
          expect(inKey.has(((n.midi % 12) + 12) % 12), `midi ${n.midi}`).toBe(true);
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step + n.steps).toBeLessThanOrEqual(song.steps);
          expect(n.velocity).toBeGreaterThan(0);
          expect(n.velocity).toBeLessThanOrEqual(1);
        }
        for (const hit of [...song.kick, ...song.snare, ...song.hat]) {
          expect(hit).toBeGreaterThanOrEqual(0);
          expect(hit).toBeLessThan(song.steps);
        }
      }
    });
  }

  it('keeps the bass below the arpeggio, and has a beat', () => {
    const song = composeSong(THEME_MOODS.lava, 5);
    const maxBass = Math.max(...song.bass.map((n) => n.midi));
    const minArp = Math.min(...song.arp.map((n) => n.midi));
    expect(maxBass).toBeLessThan(minArp);
    expect(song.kick.length).toBeGreaterThanOrEqual(SONG_BARS * 2);
    expect(song.bass.length).toBeGreaterThan(0);
    expect(song.pad.length).toBeGreaterThan(0);
  });

  it('lands a kick on every downbeat, so the music has a pulse to sync visuals to', () => {
    for (const theme of THEMES) {
      const song = composeSong(THEME_MOODS[theme], 3);
      for (let bar = 0; bar < SONG_BARS; bar++) expect(song.kick, theme).toContain(bar * STEPS_PER_BAR);
    }
  });
});

describe('stepSeconds', () => {
  it('is a sixteenth note', () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125);
  });
});
