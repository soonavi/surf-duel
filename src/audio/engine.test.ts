import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine.js';
import { busGains } from './levels.js';
import { THEME_MOODS, composeSong, stepSeconds } from './music.js';

/**
 * Just enough of Web Audio to run the engine in Node: nodes connect, params
 * accept automation, and every scheduled sound's start time is recorded on
 * the context. Time only moves when the test moves it.
 */
class FakeParam {
  value = 1;
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  readonly outputs: unknown[] = [];
  gain?: FakeParam;
  constructor(protected readonly ctx: FakeContext) {}
  connect<T>(dest: T): T {
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}

class FakeSource extends FakeNode {
  type = 'sine';
  buffer: unknown = null;
  loop = false;
  offset = 0;
  stopped = false;
  onended: (() => void) | null = null;
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  start(when = 0, offset = 0): void {
    this.ctx.starts.push(when);
    this.offset = offset;
  }
  stop(): void {
    this.stopped = true;
  }
}

/** What decodeAudioData makes of a music file: three minutes of song. */
const SONG = { duration: 180 };

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 0;
  state = 'running';
  readonly sampleRate = 48_000;
  readonly destination = {};
  readonly starts: number[] = [];
  readonly bufferSources: FakeSource[] = [];
  decoded = 0;

  constructor() {
    FakeContext.last = this;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
  createGain() {
    return Object.assign(new FakeNode(this), { gain: new FakeParam() });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(this), { type: 'lowpass', Q: new FakeParam(), frequency: new FakeParam() });
  }
  createDelay() {
    return Object.assign(new FakeNode(this), { delayTime: new FakeParam() });
  }
  createAnalyser() {
    return Object.assign(new FakeNode(this), {
      fftSize: 2048,
      smoothingTimeConstant: 0.8,
      minDecibels: -100,
      maxDecibels: -30,
      get frequencyBinCount() {
        return this.fftSize / 2;
      },
      getByteFrequencyData(): void {},
    });
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createOscillator() {
    return new FakeSource(this);
  }
  createBufferSource() {
    const source = new FakeSource(this);
    this.bufferSources.push(source);
    return source;
  }
  /** An empty file stands in for one the browser can't decode. */
  decodeAudioData(data: ArrayBuffer): Promise<typeof SONG> {
    this.decoded++;
    return data.byteLength > 0 ? Promise.resolve(SONG) : Promise.reject(new Error('EncodingError'));
  }
}

function musicFile(name: string, bytes = 8, size = 5_000_000): File {
  return { name, size, arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)) } as unknown as File;
}

/** The song now playing: the last buffer source given the decoded song and not stopped. */
function playingSong(ctx: FakeContext): FakeSource | undefined {
  return ctx.bufferSources.filter((s) => s.buffer === SONG && !s.stopped).at(-1);
}

/** The overall gain along every path from `node` to the speakers. */
function gainsToSpeakers(node: unknown, ctx: FakeContext, gain = 1): number[] {
  if (node === ctx.destination) return [gain];
  if (!(node instanceof FakeNode)) return [];
  const here = gain * (node.gain?.value ?? 1);
  return node.outputs.flatMap((next) => gainsToSpeakers(next, ctx, here));
}

let intervals: Map<number, () => void>;

beforeEach(() => {
  intervals = new Map();
  let next = 1;
  vi.stubGlobal('window', {
    AudioContext: FakeContext,
    setInterval: (fn: () => void) => {
      intervals.set(next, fn);
      return next++;
    },
    clearInterval: (id: number) => intervals.delete(id),
  });
  vi.stubGlobal('document', { hidden: false, addEventListener: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Move the audio clock on by `seconds`, running the scheduler as the browser would. */
function advance(ctx: FakeContext, seconds: number): void {
  ctx.currentTime += seconds;
  for (const fn of [...intervals.values()]) fn();
}

describe('AudioEngine', () => {
  it('keeps the music in time while settings change (dragging the volume slider)', () => {
    const engine = new AudioEngine();
    engine.setVolumes(0.6, 0.8);
    engine.setSource('generated');
    engine.unlock();
    engine.playSong('neon', 1);
    const ctx = FakeContext.last!;

    for (let i = 0; i < 120; i++) {
      advance(ctx, 0.025);
      // What App.applySettings does on every slider 'input' event.
      engine.setVolumes(0.6 - i / 300, 0.8);
      engine.setSource('generated');
    }

    // Every sound starts on a step of the song's grid, in order, at the song's tempo:
    // never early, never crammed together.
    const step = stepSeconds(composeSong(THEME_MOODS.neon, 1).bpm);
    const times = [...new Set(ctx.starts)];
    expect(times.length).toBeGreaterThan(10);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!, `gap ${i}`).toBeGreaterThan(step * 0.99);
  });
});

describe('AudioEngine: your own music file', () => {
  // Browser extensions (e.g. "Audio Equalizer") hook HTMLMediaElement.play and route every
  // audio element into their own AudioContext, straight to the speakers at full volume;
  // Firefox lets them. So the song never touches a media element: there's no Audio in
  // this test environment, and using one fails.
  it('plays the song inside its own graph, once, at the music volume', async () => {
    const engine = new AudioEngine();
    engine.setVolumes(0.6, 0.8);
    engine.unlock();
    const ctx = FakeContext.last!;
    expect(await engine.loadFile(musicFile('song.mp3'))).toBe(true);
    engine.setSource('file');

    const song = playingSong(ctx)!;
    expect(song.loop).toBe(true);
    expect(gainsToSpeakers(song, ctx)).toEqual([expect.closeTo(busGains(0.6, 0.8).file, 9)]);
    engine.setVolumes(0.2, 0.8);
    expect(gainsToSpeakers(song, ctx)).toEqual([expect.closeTo(busGains(0.2, 0.8).file, 9)]);
  });

  it('carries on where it was when the music is turned off and back on', async () => {
    const engine = new AudioEngine();
    engine.unlock();
    const ctx = FakeContext.last!;
    await engine.loadFile(musicFile('song.mp3'));
    engine.setSource('file');
    ctx.currentTime += 30;
    engine.setSource('off');
    expect(playingSong(ctx)).toBeUndefined();
    ctx.currentTime += 10;
    engine.setSource('file');
    expect(playingSong(ctx)!.offset).toBeCloseTo(30, 6);
  });

  it("keeps the song that was playing when a new file can't be played", async () => {
    const engine = new AudioEngine();
    engine.unlock();
    const ctx = FakeContext.last!;
    await engine.loadFile(musicFile('good.mp3'));
    engine.setSource('file');
    const before = playingSong(ctx);

    expect(await engine.loadFile(musicFile('broken.mp3', 0))).toBe(false);
    expect(engine.fileName).toBe('good.mp3');
    expect(playingSong(ctx)).toBe(before);
  });

  it('refuses a file too big to decode safely, without decoding it', async () => {
    const engine = new AudioEngine();
    engine.unlock();
    const ctx = FakeContext.last!;
    expect(await engine.loadFile(musicFile('three-hour-mix.mp3', 8, 200_000_000))).toBe(false);
    expect(ctx.decoded).toBe(0);
    expect(engine.hasFile).toBe(false);
  });
});
