import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_FRAME, planSteps } from './loop';
import { TICK_DT, TICK_RATE } from '../physics/constants';

function simulate(frameRate: number, seconds: number): { ticks: number; alphas: number[] } {
  let acc = 0;
  let ticks = 0;
  const alphas: number[] = [];
  const frames = Math.round(frameRate * seconds);
  for (let i = 0; i < frames; i++) {
    const plan = planSteps(acc, 1 / frameRate, TICK_DT, MAX_STEPS_PER_FRAME);
    ticks += plan.steps;
    acc = plan.accumulator;
    alphas.push(plan.alpha);
  }
  return { ticks, alphas };
}

describe('planSteps (fixed timestep)', () => {
  it.each([30, 60, 75, 120, 144, 165, 240])('runs %i fps at a steady 100 ticks/sec', (fps) => {
    const { ticks } = simulate(fps, 10);
    expect(Math.abs(ticks - TICK_RATE * 10)).toBeLessThanOrEqual(1);
  });

  it('keeps the interpolation factor in [0, 1)', () => {
    const { alphas } = simulate(144, 2);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('carries leftover time into the next frame', () => {
    const plan = planSteps(0, 0.025, TICK_DT, MAX_STEPS_PER_FRAME);
    expect(plan.steps).toBe(2);
    expect(plan.accumulator).toBeCloseTo(0.005, 9);
    expect(plan.alpha).toBeCloseTo(0.5, 6);
  });

  it('caps a long hitch instead of spiralling', () => {
    const plan = planSteps(0, 3, TICK_DT, MAX_STEPS_PER_FRAME);
    expect(plan.steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    expect(plan.accumulator).toBeLessThan(TICK_DT);
  });

  it('ignores zero and negative frame times', () => {
    expect(planSteps(0, 0, TICK_DT, MAX_STEPS_PER_FRAME).steps).toBe(0);
    expect(planSteps(0, -1, TICK_DT, MAX_STEPS_PER_FRAME).steps).toBe(0);
  });
});
