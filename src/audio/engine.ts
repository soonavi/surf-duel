/**
 * All game audio, on the Web Audio API (no samples, no dependencies):
 *  - the procedural soundtrack (music.ts), scheduled a little ahead of time
 *    on the audio clock and built up layer by layer with intensity (speed);
 *  - or the player's own music file, which never leaves their machine;
 *  - sound effects: countdown, checkpoint chime, finish fanfare, boost and
 *    respawn (no wind: the user found its rising hiss too much, Oct 2026);
 *  - an analyser tap on the music, for the equalizer and the beat pulse.
 *
 * Browsers only start audio after a user gesture, so nothing happens until
 * unlock() is called from one. Every call is safe before that (and in
 * browsers without Web Audio): it just does nothing.
 */
import type { ThemeName } from '../course/schema.js';
import { THEME_MOODS, composeSong, stepSeconds, type Mood, type Note, type Song } from './music.js';
import { bassLevel, busGains, followPulse, mixLevels, settleBars, spectrumBars } from './levels.js';

export type MusicSource = 'generated' | 'file' | 'off';

type Layer = 'pad' | 'bass' | 'kick' | 'arp' | 'hat' | 'snare';
const LAYERS: readonly Layer[] = ['pad', 'bass', 'kick', 'arp', 'hat', 'snare'];

/** Schedule this far ahead of the audio clock (s), checking this often (ms). */
const LOOKAHEAD = 0.15;
const SCHEDULE_MS = 25;
/** The analyser: fine enough for distinct equalizer bars down to the bass. */
const FFT_SIZE = 2048;
/** The biggest music file we'll decode: a long MP3 song, a short WAV. */
export const MAX_MUSIC_FILE_MB = 30;
const MAX_FILE_BYTES = MAX_MUSIC_FILE_MB * 1024 * 1024;

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface StepEvents {
  bass: Note[];
  arp: Note[];
  pad: Note[];
  kick: boolean;
  snare: boolean;
  hat: boolean;
}

function indexSong(song: Song): StepEvents[] {
  const steps: StepEvents[] = Array.from({ length: song.steps }, () => ({ bass: [], arp: [], pad: [], kick: false, snare: false, hat: false }));
  for (const n of song.bass) steps[n.step]!.bass.push(n);
  for (const n of song.arp) steps[n.step]!.arp.push(n);
  for (const n of song.pad) steps[n.step]!.pad.push(n);
  for (const s of song.kick) steps[s]!.kick = true;
  for (const s of song.snare) steps[s]!.snare = true;
  for (const s of song.hat) steps[s]!.hat = true;
  return steps;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private sfxBus!: GainNode;
  private musicVolumeNode!: GainNode;
  private musicTap!: GainNode;
  private filter!: BiquadFilterNode;
  private analyser!: AnalyserNode;
  private layers = {} as Record<Layer, GainNode>;
  private echo!: GainNode;
  private noise!: AudioBuffer;
  private freq = new Uint8Array(FFT_SIZE / 2);
  /** Width of one analyser bin (Hz). */
  private binHz = 48_000 / FFT_SIZE;
  /** The equalizer bars on screen, per bar count, and the last frame's length. */
  private readonly shownBars = new Map<number, number[]>();
  private frameDt = 1 / 60;

  private source: MusicSource = 'generated';
  private mood: Mood = THEME_MOODS.neon;
  private song: Song | null = null;
  private songId = '';
  private events: StepEvents[] = [];
  private step = 0;
  private stepTime = 0;
  private timer = 0;
  private readonly padVoices = new Set<{ stop(when: number): void }>();

  private intensity = 0.3;
  private targetIntensity = 0.3;
  private musicVolume = 0.6;
  private sfxVolume = 0.8;
  private pulseValue = 0;

  /** The player's own song, decoded, and the voice playing it (null while stopped). */
  private fileBuffer: AudioBuffer | null = null;
  private fileVoice: AudioBufferSourceNode | null = null;
  /** Where in the song it stopped (s), and the audio-clock time it would have started at 0. */
  private fileOffset = 0;
  private fileStartedAt = 0;
  fileName: string | null = null;

  /** True once audio is running. */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** The beat pulse (0–1) for visuals: follows the music's bass. */
  get pulse(): number {
    return this.pulseValue;
  }

  /** Call from a user gesture (click, key press): browsers only allow audio after one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build(this.ctx);
      document.addEventListener('visibilitychange', () => {
        // Background tabs throttle timers, which would garble the schedule: pause instead.
        if (document.hidden) void this.ctx?.suspend();
        else void this.ctx?.resume().then(() => this.restartClock());
      });
      this.applySource();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume().then(() => this.restartClock());
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.connect(ctx.destination);

    this.musicVolumeNode = ctx.createGain();
    this.musicVolumeNode.connect(master);
    // The tap sits before the volume (and its trim, which busGains sets per source),
    // so the visuals see the same levels whatever the volume.
    this.musicTap = ctx.createGain();
    this.musicTap.connect(this.musicVolumeNode);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.6;
    // Fitted to the music's levels at the tap (loud bins near the top, quiet ones low).
    this.analyser.minDecibels = -65;
    this.analyser.maxDecibels = -20;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.binHz = ctx.sampleRate / FFT_SIZE;
    this.musicTap.connect(this.analyser);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.filter.connect(this.musicTap);
    const bus = ctx.createGain();
    bus.connect(this.filter);
    for (const layer of LAYERS) {
      const g = ctx.createGain();
      g.connect(bus);
      this.layers[layer] = g;
    }
    // A dotted-eighth echo on the arpeggio: the synthwave sound.
    const delay = ctx.createDelay(1);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.3;
    this.layers.arp.connect(this.echo);
    this.echo.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(bus);
    this.echoDelay = delay;

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(master);

    const length = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.applyVolumes();
    this.applyMix(true);
  }

  private echoDelay: DelayNode | null = null;

  // --- settings -------------------------------------------------------------------

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = Math.min(1, Math.max(0, music));
    this.sfxVolume = Math.min(1, Math.max(0, sfx));
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const gains = busGains(this.musicVolume, this.sfxVolume);
    this.musicVolumeNode.gain.setTargetAtTime(this.source === 'file' ? gains.file : gains.music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(gains.sfx, t, 0.05);
  }

  setSource(source: MusicSource): void {
    // The App calls this on every settings change (each step of a slider drag):
    // restarting the clock then would cram the song's steps together.
    if (source === this.source) return;
    this.source = source;
    this.applySource();
  }

  private applySource(): void {
    if (!this.ctx) return;
    const generated = this.source === 'generated';
    window.clearInterval(this.timer);
    this.timer = 0;
    if (generated) {
      this.restartClock();
      this.timer = window.setInterval(() => this.schedule(), SCHEDULE_MS);
    } else {
      this.releasePads(this.ctx.currentTime);
    }
    if (this.source === 'file') this.startFile();
    else this.stopFile();
    this.applyVolumes(); // a music file is trimmed differently from the generated mix
  }

  /**
   * Play the player's own music file (looped). It's read locally from the file
   * they picked and never uploaded anywhere. It's decoded and played inside the
   * graph, never through an audio element: extensions such as equalizers hook
   * HTMLMediaElement.play and play the element again in their own AudioContext,
   * at full volume and out of reach of the music volume (Firefox allows it).
   * Resolves false if the file can't be played.
   */
  async loadFile(file: File): Promise<boolean> {
    this.unlock();
    const ctx = this.ctx;
    // Decoded audio takes ~23 MB a minute: refuse files that would decode to gigabytes.
    if (!ctx || file.size > MAX_FILE_BYTES) return false;
    let song: AudioBuffer;
    try {
      song = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      return false; // Unplayable: keep the song that was playing, if any.
    }
    this.stopFile();
    this.fileBuffer = song;
    this.fileOffset = 0;
    this.fileName = file.name;
    if (this.source === 'file') this.startFile();
    return true;
  }

  private startFile(): void {
    const ctx = this.ctx;
    if (!ctx || !this.fileBuffer || this.fileVoice) return;
    const voice = ctx.createBufferSource();
    voice.buffer = this.fileBuffer;
    voice.loop = true;
    voice.connect(this.musicTap);
    voice.start(ctx.currentTime, this.fileOffset);
    this.fileStartedAt = ctx.currentTime - this.fileOffset;
    this.fileVoice = voice;
  }

  /** Stop the song, remembering where, so it carries on from there. */
  private stopFile(): void {
    if (!this.ctx || !this.fileVoice || !this.fileBuffer) return;
    this.fileOffset = (this.ctx.currentTime - this.fileStartedAt) % this.fileBuffer.duration;
    this.fileVoice.stop();
    this.fileVoice.disconnect();
    this.fileVoice = null;
  }

  get hasFile(): boolean {
    return this.fileName !== null;
  }

  // --- the soundtrack ---------------------------------------------------------------

  /** The tune for a course: its theme's mood, varied by `seed`. Same course, same tune. */
  playSong(theme: ThemeName, seed: number): void {
    const id = `${theme}|${seed}`;
    if (id === this.songId) return;
    this.songId = id;
    this.mood = THEME_MOODS[theme];
    this.song = composeSong(this.mood, seed);
    this.events = indexSong(this.song);
    if (this.echoDelay && this.ctx) this.echoDelay.delayTime.setValueAtTime(stepSeconds(this.song.bpm) * 3, this.ctx.currentTime);
    if (this.ctx) this.releasePads(this.ctx.currentTime);
    this.step = 0;
    this.restartClock();
  }

  /** 0 (calm: menus, the start pad) to 1 (flat out). Eased, so it never jumps. */
  setIntensity(x: number): void {
    this.targetIntensity = x;
  }

  private restartClock(): void {
    if (this.ctx) this.stepTime = this.ctx.currentTime + 0.05;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song || ctx.state !== 'running' || this.source !== 'generated') return;
    const dur = stepSeconds(song.bpm);
    // After a long stall (tab switch), don't try to catch up on missed steps.
    if (this.stepTime < ctx.currentTime - 0.2) this.stepTime = ctx.currentTime + 0.05;
    while (this.stepTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.events[this.step]!, this.stepTime, dur);
      this.step = (this.step + 1) % song.steps;
      this.stepTime += dur;
    }
  }

  private playStep(e: StepEvents, t: number, dur: number): void {
    for (const n of e.pad) this.padVoice(n, t, dur);
    for (const n of e.bass) this.voice(this.layers.bass, 'sawtooth', midiHz(n.midi), t, n.steps * dur * 0.9, 0.32 * n.velocity, 0.005, 900);
    for (const n of e.arp) this.voice(this.layers.arp, 'square', midiHz(n.midi), t, n.steps * dur * 0.7, 0.09 * n.velocity, 0.003, 3200);
    if (e.kick) this.kick(this.layers.kick, t, 0.9);
    if (e.snare) this.snare(this.layers.snare, t, 0.5);
    if (e.hat) this.hat(this.layers.hat, t, 0.22);
  }

  // --- synth voices -------------------------------------------------------------------

  private voice(dest: AudioNode, type: OscillatorType, hz: number, t: number, length: number, level: number, attack: number, cutoff: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setTargetAtTime(level * 0.6, t + attack, length * 0.3);
    g.gain.setTargetAtTime(0, t + length, 0.03);
    osc.connect(lp).connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + length + 0.2);
  }

  private padVoice(n: Note, t: number, dur: number): void {
    const ctx = this.ctx!;
    const length = n.steps * dur;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const level = 0.06 * n.velocity;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.6);
    g.gain.setTargetAtTime(0, t + length - 0.1, 0.25);
    lp.connect(g).connect(this.layers.pad);
    const oscs = [-7, 7].map((cents) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiHz(n.midi);
      osc.detune.value = cents;
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + length + 1.2);
      return osc;
    });
    const voice = {
      stop: (when: number) => {
        g.gain.cancelScheduledValues(when);
        g.gain.setTargetAtTime(0, when, 0.1);
        for (const o of oscs) o.stop(when + 0.5);
      },
    };
    this.padVoices.add(voice);
    oscs[0]!.onended = () => this.padVoices.delete(voice);
  }

  private releasePads(when: number): void {
    for (const v of this.padVoices) {
      try {
        v.stop(when);
      } catch {
        // Already stopped.
      }
    }
    this.padVoices.clear();
  }

  private kick(dest: AudioNode, t: number, level: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private noiseHit(dest: AudioNode, t: number, level: number, type: BiquadFilterType, hz: number, length: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.05);
  }

  private snare(dest: AudioNode, t: number, level: number): void {
    this.noiseHit(dest, t, level, 'bandpass', 1800, 0.18);
    this.voice(dest, 'triangle', 190, t, 0.06, level * 0.5, 0.001, 2000);
  }

  private hat(dest: AudioNode, t: number, level: number): void {
    this.noiseHit(dest, t, level, 'highpass', 7500, 0.05);
  }

  // --- sound effects -------------------------------------------------------------------

  /** A note in the current song's key: scale degree `degree`, `octave` octaves above the bass. */
  private keyHz(degree: number, octave: number): number {
    const m = this.mood;
    return midiHz(m.root + 12 * octave + m.scale[((degree % 7) + 7) % 7]! + 12 * Math.floor(degree / 7));
  }

  private get sfxReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Countdown: a beep per number, a higher chord on GO. */
  countdown(n: number): void {
    if (!this.sfxReady) return;
    const t = this.ctx!.currentTime;
    if (n > 0) this.voice(this.sfxBus, 'sine', 660, t, 0.12, 0.35, 0.005, 6000);
    else for (const d of [0, 2, 4]) this.voice(this.sfxBus, 'square', this.keyHz(d, 3), t, 0.35, 0.12, 0.005, 5000);
  }

  /** A bright two-note chime in the song's key. */
  checkpoint(): void {
    if (!this.sfxReady) return;
    const t = this.ctx!.currentTime;
    this.voice(this.sfxBus, 'sine', this.keyHz(4, 3), t, 0.25, 0.3, 0.003, 8000);
    this.voice(this.sfxBus, 'sine', this.keyHz(7, 3), t + 0.09, 0.45, 0.3, 0.003, 8000);
  }

  /** Up the chord, louder for a personal best. */
  finish(best: boolean): void {
    if (!this.sfxReady) return;
    const t = this.ctx!.currentTime;
    const degrees = best ? [0, 2, 4, 7, 9, 11, 14] : [0, 2, 4, 7];
    degrees.forEach((d, i) => {
      this.voice(this.sfxBus, 'square', this.keyHz(d, 2), t + i * 0.09, 0.3, 0.1, 0.004, 4000);
      this.voice(this.sfxBus, 'sine', this.keyHz(d, 3), t + i * 0.09, 0.4, 0.15, 0.004, 8000);
    });
  }

  /** A rising whoosh. */
  boost(): void {
    if (!this.sfxReady) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.55);
  }

  /** A quick fall in pitch. */
  respawn(): void {
    if (!this.sfxReady) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  // --- per frame ----------------------------------------------------------------------

  /** Ease the mix toward the target intensity and follow the beat. Call once per rendered frame. */
  frame(dt: number): void {
    if (!this.ctx) return;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 1.5);
    this.applyMix(false);
    this.analyser.getByteFrequencyData(this.freq);
    this.frameDt = dt;
    // A steady glow (~0.65) that swells toward 0.9 with the kick and bass: fitted to the analyser's levels.
    this.pulseValue = followPulse(this.pulseValue, Math.min(1, 0.6 + 0.55 * bassLevel(this.freq, this.binHz)), dt);
  }

  private applyMix(immediate: boolean): void {
    if (!this.ctx) return;
    const levels = mixLevels(this.intensity);
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.001 : 0.1;
    for (const layer of LAYERS) this.layers[layer].gain.setTargetAtTime(levels[layer], t, tc);
    this.filter.frequency.setTargetAtTime(levels.cutoffHz, t, tc);
  }

  /** `count` equalizer bars (0–1) from the music right now, eased. Call once per frame per equalizer. */
  bars(count: number): number[] {
    if (!this.ctx) return new Array<number>(count).fill(0);
    const shown = settleBars(this.shownBars.get(count) ?? [], spectrumBars(this.freq, count, this.binHz), this.frameDt);
    this.shownBars.set(count, shown);
    return shown;
  }
}
