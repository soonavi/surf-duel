/**
 * One race attempt: 3-2-1 countdown, then a tick-counted clock (10 ms per
 * tick, so times are exact and identical across machines), checkpoint splits
 * and the finish. Pure state, driven once per simulation tick.
 */
import { TICK_RATE } from '../physics/constants.js';

export type RacePhase = 'countdown' | 'racing' | 'finished';
export type RaceEvent = { type: 'count'; n: number } | { type: 'go' };

export interface BestRun {
  timeMs: number;
  splits: (number | null)[];
}

export interface SplitInfo {
  index: number;
  timeMs: number;
  /** Versus the personal best's split; negative is faster. Null without a best. */
  deltaMs: number | null;
}

export interface RaceResult {
  timeMs: number;
  /** Split per checkpoint (1-based index → [index - 1]); null if never reached. */
  splits: (number | null)[];
  deltaMs: number | null;
  topSpeed: number;
}

const MS_PER_TICK = 1000 / TICK_RATE;

export class RaceSession {
  phase: RacePhase = 'countdown';

  private countdownLeft: number;
  private raceTicks = 0;
  /** Real time the race clock must include but the simulation didn't run (multiplayer). */
  private lostMs = 0;
  private readonly splits: (number | null)[];
  private topSpeed = 0;
  private result: RaceResult | null = null;
  private readonly best: BestRun | null;

  constructor(opts: { countdownSeconds: number; checkpoints: number; best?: BestRun | null }) {
    this.countdownLeft = Math.round(opts.countdownSeconds * TICK_RATE);
    this.splits = Array.from({ length: opts.checkpoints }, () => null);
    this.best = opts.best ?? null;
  }

  /** 3, 2, 1 during the countdown. */
  get countdownNumber(): number {
    return Math.max(1, Math.ceil(this.countdownLeft / TICK_RATE));
  }

  get elapsedMs(): number {
    return this.raceTicks * MS_PER_TICK + this.lostMs;
  }

  /**
   * Go now, regardless of the countdown — for a multiplayer GO driven by the
   * shared wall clock. `lateMs` is how far past the shared GO we already are.
   */
  startRacing(lateMs = 0): RaceEvent[] {
    if (this.phase !== 'countdown') return [];
    this.phase = 'racing';
    this.raceTicks = 1;
    this.lostMs = Math.max(0, lateMs);
    return [{ type: 'go' }];
  }

  /** Add real time that passed without simulation (e.g. a backgrounded tab) while racing. */
  addLostTime(ms: number): void {
    if (this.phase === 'racing' && ms > 0) this.lostMs += ms;
  }

  /** Call once per simulation tick, before moving the player. */
  tick(): RaceEvent[] {
    if (this.phase === 'countdown') {
      if (this.countdownLeft > 0) {
        const before = this.countdownNumber;
        this.countdownLeft--;
        const after = this.countdownNumber;
        return after !== before ? [{ type: 'count', n: after }] : [];
      }
      this.phase = 'racing';
      this.raceTicks = 1; // this tick is the first one raced
      return [{ type: 'go' }];
    }
    if (this.phase === 'racing') this.raceTicks++;
    return [];
  }

  /** Record reaching checkpoint `index` (1-based). Only the first pass counts. */
  checkpoint(index: number): SplitInfo {
    const i = index - 1;
    if (this.phase === 'racing' && i >= 0 && i < this.splits.length && this.splits[i] === null) {
      this.splits[i] = this.elapsedMs;
    }
    const timeMs = this.splits[i] ?? 0;
    const bestSplit = this.best?.splits[i];
    return { index, timeMs, deltaMs: bestSplit != null && this.splits[i] != null ? timeMs - bestSplit : null };
  }

  noteSpeed(v: number): void {
    if (this.phase === 'racing') this.topSpeed = Math.max(this.topSpeed, v);
  }

  /** Stop the clock. Safe to call more than once; later calls return the same result. */
  finish(): RaceResult {
    if (this.result) return this.result;
    this.phase = 'finished';
    const timeMs = this.elapsedMs;
    this.result = {
      timeMs,
      splits: this.splits.slice(),
      deltaMs: this.best ? timeMs - this.best.timeMs : null,
      topSpeed: this.topSpeed,
    };
    return this.result;
  }
}
