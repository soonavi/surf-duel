import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine.js';
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
  constructor(protected readonly ctx: FakeContext) {}
  connect<T>(dest: T): T {
    return dest;
  }
  disconnect(): void {}
}

class FakeSource extends FakeNode {
  type = 'sine';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  start(when = 0): void {
    this.ctx.starts.push(when);
  }
  stop(): void {}
}

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 0;
  state = 'running';
  readonly sampleRate = 48_000;
  readonly destination = {};
  readonly starts: number[] = [];

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
    return new FakeSource(this);
  }
  createMediaElementSource() {
    return new FakeNode(this);
  }
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
