import { TICK_DT } from '../physics/constants';

/** Longest frame we will simulate; anything beyond (tab hitch, debugger pause) is dropped. */
export const MAX_FRAME_DT = 0.25;
export const MAX_STEPS_PER_FRAME = Math.ceil(MAX_FRAME_DT / TICK_DT);

export interface StepPlan {
  /** Number of fixed ticks to run this frame. */
  steps: number;
  /** Leftover time carried into the next frame, in seconds. */
  accumulator: number;
  /** Interpolation factor in [0, 1) between the previous and current tick. */
  alpha: number;
}

/**
 * Classic fixed-timestep accumulator ("Fix Your Timestep"). Pure, so it can be
 * tested without a browser.
 */
export function planSteps(accumulator: number, frameDt: number, stepDt: number, maxSteps: number): StepPlan {
  const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
  let acc = accumulator + dt;
  // The epsilon keeps float drift (e.g. 0.00999999) from swallowing a tick.
  let steps = Math.floor(acc / stepDt + 1e-9);
  if (steps > maxSteps) {
    // Spiral-of-death guard: run what we can and drop whole ticks we can't afford.
    acc -= (steps - maxSteps) * stepDt;
    steps = maxSteps;
  }
  acc = Math.max(0, acc - steps * stepDt);
  const alpha = Math.min(acc / stepDt, 1 - 1e-9);
  return { steps, accumulator: acc, alpha };
}

export interface LoopCallbacks {
  /** Called once per simulated frame, before its ticks, with how many ticks are about to run. */
  beginFrame?(steps: number): void;
  /** Advance the simulation by exactly `dt` seconds. */
  tick(dt: number): void;
  /** Draw a frame, blending the last two ticks by `alpha`. */
  render(alpha: number, frameDt: number): void;
}

export class FixedStepLoop {
  /** When false, ticks stop (paused) but frames keep rendering. */
  simulating = true;

  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly callbacks: LoopCallbacks,
    readonly stepDt = TICK_DT,
    readonly maxSteps = MAX_STEPS_PER_FRAME,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    const frameDt = Math.max(0, (now - this.last) / 1000);
    this.last = now;

    if (!this.simulating) {
      this.accumulator = 0;
      this.callbacks.render(1, frameDt);
      return;
    }

    const plan = planSteps(this.accumulator, frameDt, this.stepDt, this.maxSteps);
    this.callbacks.beginFrame?.(plan.steps);
    for (let i = 0; i < plan.steps; i++) this.callbacks.tick(this.stepDt);
    this.accumulator = plan.accumulator;
    this.callbacks.render(plan.alpha, frameDt);
  };
}
