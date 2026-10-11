import { describe, expect, it } from 'vitest';
import {
  CLIPS,
  DEFAULT_HELD_ITEM,
  HELD_ITEMS,
  HeldItemMotion,
  MAX_SWAY,
  REST,
  clipPose,
  heldItem,
  parseHeldItem,
  type ItemPose,
  type MotionInput,
} from './heldItem.js';

const still: MotionInput = { yawDelta: 0, pitchDelta: 0, speed: 0, side: 0, airborne: false, reducedMotion: false };
const FRAME = 1 / 60;

const ANGLES = new Set<keyof ItemPose>(['rx', 'ry', 'rz']);

/** How far a pose is from rest; a whole turn counts as no turn at all (a spin ends where it began). */
function offRest(p: ItemPose): number {
  return Math.max(
    ...(Object.keys(REST) as (keyof ItemPose)[]).map((k) => {
      const d = Math.abs(p[k] - REST[k]);
      return ANGLES.has(k) ? Math.min(d % (2 * Math.PI), 2 * Math.PI - (d % (2 * Math.PI))) : d;
    }),
  );
}

/** Run the motion for `seconds` at 60 fps with the same input, returning the last pose. */
function run(m: HeldItemMotion, seconds: number, input: MotionInput = still): ItemPose {
  let pose = m.update(0, input);
  for (let t = 0; t < seconds; t += FRAME) pose = m.update(FRAME, input);
  return pose;
}

describe('held items', () => {
  it('has knives and fun things, each with a unique id, and an empty hand', () => {
    const ids = HELD_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('none');
    expect(HELD_ITEMS.filter((i) => i.kind === 'knife').length).toBeGreaterThanOrEqual(3);
    expect(HELD_ITEMS.some((i) => i.id === 'teddy')).toBe(true); // user: "a stuffed animal"
    expect(heldItem(DEFAULT_HELD_ITEM).id).toBe(DEFAULT_HELD_ITEM);
  });

  it('reads a stored choice, and falls back to the default for anything it does not know', () => {
    expect(parseHeldItem('duck')).toBe('duck');
    expect(parseHeldItem('none')).toBe('none');
    expect(parseHeldItem('lightsaber')).toBe(DEFAULT_HELD_ITEM);
    expect(parseHeldItem(42)).toBe(DEFAULT_HELD_ITEM);
  });

  it('gives every item an inspect and a use clip that exist', () => {
    for (const item of HELD_ITEMS) {
      if (item.id === 'none') continue;
      expect(CLIPS[item.inspect]).toBeDefined();
      expect(CLIPS[item.use]).toBeDefined();
    }
  });
});

describe('clips', () => {
  it('start and end at rest, so nothing snaps', () => {
    for (const [name, clip] of Object.entries(CLIPS)) {
      expect(offRest(clipPose(clip, 0)), `${name} at 0`).toBeLessThan(1e-9);
      expect(offRest(clipPose(clip, clip.duration)), `${name} at the end`).toBeLessThan(1e-9);
      expect(clip.duration, name).toBeGreaterThan(0.15);
      expect(clip.duration, name).toBeLessThan(4);
    }
  });

  it('actually move in between', () => {
    for (const [name, clip] of Object.entries(CLIPS)) {
      expect(offRest(clipPose(clip, clip.duration / 2)), name).toBeGreaterThan(0.01);
    }
  });

  it('move smoothly: no frame jumps far', () => {
    for (const [name, clip] of Object.entries(CLIPS)) {
      let prev = clipPose(clip, 0);
      for (let t = FRAME; t <= clip.duration; t += FRAME) {
        const p = clipPose(clip, t);
        const jump = Math.max(...(Object.keys(REST) as (keyof ItemPose)[]).map((k) => Math.abs(p[k] - prev[k])));
        // A full spin over a few frames is fine (0.6 rad a frame); a teleport isn't.
        expect(jump, `${name} at ${t.toFixed(2)}`).toBeLessThan(0.7);
        prev = p;
      }
    }
  });
});

describe('HeldItemMotion', () => {
  it('rests still when nothing happens', () => {
    expect(offRest(run(new HeldItemMotion('karambit'), 1))).toBeLessThan(0.01);
  });

  it('plays the inspect clip, then comes back to rest', () => {
    const m = new HeldItemMotion('karambit');
    expect(m.trigger('inspect')).toBe(true);
    expect(m.playing).toBe('inspect');
    const clip = CLIPS[heldItem('karambit').inspect];
    expect(offRest(run(m, clip.duration / 2))).toBeGreaterThan(0.01);
    run(m, clip.duration);
    expect(m.playing).toBeNull();
    expect(offRest(run(m, 0.5))).toBeLessThan(0.01);
  });

  it('lets a swing cut an inspect short, but not the other way round', () => {
    const m = new HeldItemMotion('bayonet');
    m.trigger('inspect');
    run(m, 0.2);
    expect(m.trigger('use')).toBe(true);
    expect(m.playing).toBe('use');
    expect(m.trigger('inspect')).toBe(false);
    expect(m.playing).toBe('use');
  });

  it('eases out of a clip it cuts short instead of snapping', () => {
    const m = new HeldItemMotion('bayonet');
    m.trigger('inspect');
    const before = run(m, 0.6);
    m.trigger('use');
    const after = m.update(FRAME, still);
    const jump = Math.max(...(Object.keys(REST) as (keyof ItemPose)[]).map((k) => Math.abs(after[k] - before[k])));
    expect(jump).toBeLessThan(0.3);
  });

  it('does nothing with an empty hand', () => {
    const m = new HeldItemMotion('none');
    expect(m.trigger('inspect')).toBe(false);
    expect(m.trigger('use')).toBe(false);
  });

  it('sways behind the mouse, a little and no more, and settles when you stop turning', () => {
    const m = new HeldItemMotion('duck');
    const turning = run(m, 1, { ...still, yawDelta: 0.5 });
    expect(Math.abs(turning.x - REST.x)).toBeGreaterThan(0.001);
    expect(Math.abs(turning.x - REST.x)).toBeLessThanOrEqual(MAX_SWAY + 1e-9);
    expect(offRest(run(m, 2))).toBeLessThan(0.01);
  });

  it('turning left swings the item right (it lags behind the view)', () => {
    const left = run(new HeldItemMotion('duck'), 0.3, { ...still, yawDelta: 0.05 });
    expect(left.x).toBeGreaterThan(REST.x);
  });

  it('keeps perfectly still with reduced motion, whatever you do', () => {
    const m = new HeldItemMotion('teddy');
    const pose = run(m, 1, { yawDelta: 0.5, pitchDelta: 0.2, speed: 3000, side: 1, airborne: true, reducedMotion: true });
    expect(offRest(pose)).toBeLessThan(1e-9);
  });

  it('bobs gently at speed, more than standing still', () => {
    const m = new HeldItemMotion('baguette');
    let moving = 0;
    for (let i = 0; i < 120; i++) moving = Math.max(moving, offRest(m.update(FRAME, { ...still, speed: 2500 })));
    expect(moving).toBeGreaterThan(0.001);
    expect(moving).toBeLessThan(0.05);
  });

  it('spins the item in your hand: the glove stays put for a spin, and follows a swing', () => {
    const m = new HeldItemMotion('karambit');
    expect(m.handFollow).toBe(1);
    m.trigger('inspect');
    run(m, 0.6);
    expect(m.handFollow).toBeLessThan(0.05);
    run(m, 2);
    expect(m.handFollow).toBeGreaterThan(0.95);
    m.trigger('use');
    run(m, 0.1);
    expect(m.handFollow).toBeGreaterThan(0.95);
  });

  it('switching items drops whatever was playing', () => {
    const m = new HeldItemMotion('karambit');
    m.trigger('inspect');
    m.setItem('duck');
    expect(m.playing).toBeNull();
  });
});
