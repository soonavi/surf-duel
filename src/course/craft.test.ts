import { describe, expect, it } from 'vitest';
import { addSurfCraft } from './craft.js';

const ramp = (over: Record<string, unknown> = {}) => ({ type: 'ramp', length: 4000, angle: 54, side: 'right', curve: 0, ...over });

describe('addSurfCraft (surf-map craft on AI courses)', () => {
  it('flares a ramp before a big gap or drop, so you launch over it', () => {
    const out = addSurfCraft([ramp(), { type: 'gap', length: 1200 }, ramp(), { type: 'checkpoint' }, { type: 'drop', height: 1500 }, ramp(), ramp()]) as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ flare: expect.any(Number) });
    expect(out[2]).toMatchObject({ flare: expect.any(Number) });
    expect(out[5]).not.toHaveProperty('flare');
  });

  it('leaves small gaps and drops, and walled ramps (you line up straight for the window), alone', () => {
    const out = addSurfCraft([ramp(), { type: 'gap', length: 300 }, { type: 'wall' }, ramp(), { type: 'gap', length: 1500 }, ramp()]) as Record<string, unknown>[];
    expect(out[0]).not.toHaveProperty('flare');
    expect(out[3]).not.toHaveProperty('flare');
    expect(out[3]).not.toHaveProperty('swerve');
  });

  it('S-bends long, gently curving ramps, one way then the other', () => {
    const out = addSurfCraft([ramp({ length: 6000 }), ramp({ length: 6000, curve: 10 }), ramp({ length: 6000, curve: 40 }), ramp({ length: 2000 })]) as Record<string, number>[];
    expect(Math.sign(out[0]!.swerve!)).toBe(-Math.sign(out[1]!.swerve!));
    expect(out[2]).not.toHaveProperty('swerve');
    expect(out[3]).not.toHaveProperty('swerve');
  });

  it('never overrides a flare or swerve already there, and passes anything else through', () => {
    const out = addSurfCraft([ramp({ length: 6000, swerve: 5 }), { type: 'gap', length: 2000 }, 'junk', null, ramp({ flare: 3 })]) as unknown[];
    expect(out[0]).toMatchObject({ swerve: 5 });
    expect(out[2]).toBe('junk');
    expect(out[3]).toBeNull();
    expect(out[4]).toMatchObject({ flare: 3 });
  });
});
