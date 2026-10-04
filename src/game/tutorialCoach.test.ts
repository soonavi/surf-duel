import { describe, expect, it } from 'vitest';
import {
  TutorialCoach,
  coachCourseFrom,
  parseCoachText,
  readingTicks,
  type CoachCourse,
  type CoachInput,
  type CoachKeys,
  type CoachPrompt,
  type CoachRamp,
} from './tutorialCoach';
import { buildCourse } from '../course/builder';
import { findCourse } from '../course/courses';
import { simulateRun } from '../course/simulate';
import { CourseRuntime, placeAtSpawn, type CourseEvent } from '../course/runtime';
import { BvhWorld } from '../physics/collision';
import { DEFAULT_PHYSICS, TICK_DT } from '../physics/constants';
import { createPlayer, stepPlayer } from '../physics/player';

// Mirrors the Tutorial: start pad, R, gate, L, gate, R (bends left), booster, L (bends right), finish.
const RIDGE = { right: 200, left: -200, both: 0 } as const;
const ramp = (piece: number, side: CoachRamp['side'], curve: CoachRamp['curve'] = null, boosterAfter = false): CoachRamp => ({
  piece,
  side,
  ridge: RIDGE[side],
  curve,
  boosterAfter,
});
const COURSE: CoachCourse = {
  ramps: [ramp(1, 'right'), ramp(3, 'left'), ramp(5, 'right', 'left', true), ramp(7, 'left', 'right')],
  finishPiece: 8,
};

const NO_KEYS: CoachKeys = { w: false, a: false, s: false, d: false, space: false };
const keys = (...held: (keyof CoachKeys)[]): CoachKeys => ({ ...NO_KEYS, ...Object.fromEntries(held.map((k) => [k, true])) });

const onPad: CoachInput = { phase: 'racing', piece: 0, surfing: false, onGround: true, lateral: 0, keys: NO_KEYS, events: [] };
const countdown: CoachInput = { ...onPad, phase: 'countdown' };
const onRamp = (piece: number, k: CoachKeys, lateral = 0): CoachInput => ({ ...onPad, piece, surfing: true, onGround: false, lateral, keys: k });
const flying = (toward: number, k: CoachKeys): CoachInput => ({ ...onPad, piece: toward, surfing: false, onGround: false, keys: k });

/** Feed the same input for `ticks` ticks (events only on the first). */
function run(coach: TutorialCoach, input: CoachInput, ticks: number): TutorialCoach {
  for (let i = 0; i < ticks; i++) coach.update(i === 0 ? input : { ...input, events: [] });
  return coach;
}

const LONG = 2000; // longer than any lesson's reading time

describe('reading time', () => {
  it('grows with the length of the text, within sensible bounds', () => {
    expect(readingTicks('Hold D.')).toBeGreaterThanOrEqual(350); // even short lessons stay up 3.5 s
    expect(readingTicks('word '.repeat(20))).toBeGreaterThan(readingTicks('word '.repeat(8)));
    expect(readingTicks('word '.repeat(200))).toBeLessThanOrEqual(650);
  });
});

describe('TutorialCoach: lessons', () => {
  it('starts with the basics during the countdown', () => {
    const coach = run(new TutorialCoach(COURSE), countdown, 10);
    expect(coach.current?.id).toBe('basics');
    expect(coach.current?.text).toContain('{D}');
    expect(coach.current?.text).toContain('{A}');
    expect(coach.step).toEqual({ index: 1, total: 6 }); // basics, walk, ramps 1-3, finish
  });

  it('keeps each lesson up for its reading time before moving on', () => {
    const coach = run(new TutorialCoach(COURSE), countdown, 300);
    const basicsTicks = readingTicks(coach.current!.text);
    run(coach, onPad, basicsTicks - 300 - 5);
    expect(coach.current?.id).toBe('basics');
    run(coach, onPad, 10);
    expect(coach.current?.id).toBe('walk');
    expect(coach.current?.hold).toEqual(['w']);
  });

  it('tells you about the first ramp before you walk off', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    expect(coach.current?.id).toBe('walk');
    expect(coach.current?.text).toMatch(/right/);
    expect(coach.current?.text).toContain('{D}');
  });

  it('skips the walk lesson if you have already walked off', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, 50);
    run(coach, onRamp(1, keys('d')), LONG);
    expect(coach.current?.id).toBe('ramp-1');
  });

  it('moves to the ramp lesson once you are settled on the ramp, previewing the next one', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('d')), 60);
    expect(coach.current?.id).toBe('walk'); // not settled yet
    run(coach, onRamp(1, keys('d')), 200);
    expect(coach.current?.id).toBe('ramp-1');
    expect(coach.current?.title).toMatch(/surfing/i);
    expect(coach.current?.text).toMatch(/left/); // the next ramp
    expect(coach.current?.text).toContain('{A}');
  });

  it('does not settle while you hold the wrong keys', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('w', 'd')), LONG);
    expect(coach.current?.id).toBe('walk');
  });

  it('never moves on faster than you can read, even if you are quick', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('d')), 150);
    expect(coach.current?.id).toBe('ramp-1');
    const shownFor = readingTicks(coach.current!.text);
    run(coach, flying(3, keys('a')), 30);
    run(coach, onRamp(3, keys('a')), 150); // settled on ramp 2 already
    expect(coach.current?.id).toBe('ramp-1');
    run(coach, onRamp(3, keys('a')), shownFor);
    expect(coach.current?.id).toBe('ramp-2');
  });

  it('teaches the colours on the first ramp of the other side, and warns of the bend ahead', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('d')), LONG);
    run(coach, onRamp(3, keys('a')), LONG);
    expect(coach.current?.id).toBe('ramp-2');
    expect(coach.current?.text).toContain('{ramp-left}');
    expect(coach.current?.text).toMatch(/bends left/);
  });

  it('explains the curve, then previews the booster and the last ramp in the same lesson', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    for (const [piece, k] of [[1, 'd'], [3, 'a']] as const) run(coach, onRamp(piece, keys(k)), LONG);
    run(coach, onRamp(5, keys('d')), LONG);
    expect(coach.current?.id).toBe('ramp-3');
    expect(coach.current?.text).toMatch(/turn the mouse left/);
    expect(coach.current?.text).toMatch(/booster/i);
    expect(coach.current?.text).toMatch(/last ramp/i);
    // The last ramp goes by in a couple of seconds: no new lesson to read there.
    run(coach, onRamp(7, keys('a')), LONG);
    expect(coach.current?.id).toBe('ramp-3');
  });

  it('wraps up at the finish straight away', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('d')), 150);
    run(coach, { ...onPad, piece: 8, events: [{ type: 'finish' }] }, 1);
    expect(coach.current?.id).toBe('finish');
  });
});

describe('TutorialCoach: live hint', () => {
  it('confirms the right key on a ramp', () => {
    const coach = run(new TutorialCoach(COURSE), onRamp(1, keys('d')), 40);
    expect(coach.hint).toMatchObject({ id: 'holding', tone: 'good', hold: ['d'] });
  });

  it('warns about W, which cancels the push into the ramp', () => {
    const coach = run(new TutorialCoach(COURSE), onRamp(1, keys('w', 'd')), 40);
    expect(coach.hint).toMatchObject({ id: 'no-w', tone: 'warn', avoid: ['w'] });
  });

  it('warns about the key that pushes you off', () => {
    const coach = run(new TutorialCoach(COURSE), onRamp(1, keys('a')), 40);
    expect(coach.hint).toMatchObject({ id: 'wrong-key', tone: 'warn', hold: ['d'], avoid: ['a'] });
  });

  it('works out which face you are on after overshooting a ridge', () => {
    const coach = run(new TutorialCoach(COURSE), onRamp(1, NO_KEYS, 260), 80);
    expect(coach.hint?.hold).toEqual(['a']);
  });

  it('ignores quick taps', () => {
    const coach = run(new TutorialCoach(COURSE), onRamp(1, keys('d')), 100);
    run(coach, onRamp(1, keys('w', 'd')), 8);
    expect(coach.hint?.id).toBe('holding');
  });

  it('does not change the lesson when keys change', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    const before = coach.current;
    for (let i = 0; i < 20; i++) run(coach, onRamp(1, keys(i % 2 ? 'w' : 'a')), 15);
    expect(coach.current).toBe(before);
  });

  it('says which key the next ramp needs while you fly to it', () => {
    const coach = run(new TutorialCoach(COURSE), onRamp(1, keys('d')), 200);
    run(coach, flying(3, keys('d')), 30);
    expect(coach.hint).toMatchObject({ id: 'switch', hold: ['a'], avoid: ['d', 'w'] });
    run(coach, flying(3, keys('a')), 30);
    expect(coach.hint).toMatchObject({ id: 'ready', tone: 'good' });
  });

  it('says to walk with W on the pad, once the walk lesson is up', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    expect(coach.hint).toMatchObject({ id: 'press-w', hold: ['w'] });
  });

  it('stops you pressing the ramp key too early: on the pad it walks you sideways', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, { ...onPad, keys: keys('w', 'd') }, 40);
    expect(coach.hint).toMatchObject({ id: 'not-yet', tone: 'warn', hold: ['w'], avoid: ['d', 'a'] });
    // Still standing on the front lip of the pad (the path already says ramp 1) counts as the pad.
    run(coach, { ...onPad, piece: 1, keys: keys('d') }, 40);
    expect(coach.hint?.id).toBe('not-yet');
  });

  it('says to switch only once you are falling off the pad', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    expect(coach.current?.text).toMatch(/falling/);
    run(coach, flying(1, keys('w')), 30);
    expect(coach.hint).toMatchObject({ id: 'switch', hold: ['d'] });
  });
});

describe('TutorialCoach: events', () => {
  it('notes a checkpoint without touching the lesson', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('d')), 200);
    const lesson = coach.current;
    run(coach, { ...flying(3, keys('a')), events: [{ type: 'checkpoint', index: 1 }] }, 10);
    expect(coach.note?.id).toBe('checkpoint');
    expect(coach.note?.text).toContain('{R}');
    expect(coach.current).toBe(lesson);
    run(coach, flying(3, keys('a')), 600);
    expect(coach.note).toBeNull();
  });

  it('after a fall onto a ramp, re-teaches that ramp right away', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('d')), 200);
    run(coach, { ...onRamp(3, NO_KEYS), events: [{ type: 'kill' }] }, 5);
    expect(coach.note?.id).toBe('fell');
    expect(coach.current?.id).toBe('retry');
    expect(coach.current?.text).toContain('{A}');
  });

  it('after a fall back to the start, shows the walk lesson again', () => {
    const coach = run(new TutorialCoach(COURSE), onPad, LONG);
    run(coach, onRamp(1, keys('w')), 100);
    run(coach, { ...onPad, events: [{ type: 'kill' }] }, 5);
    expect(coach.current?.id).toBe('walk');
    expect(coach.note?.text).toMatch(/start/);
  });
});

describe('coachCourseFrom', () => {
  it('reads ramp sides, bends and boosters from the built Tutorial', () => {
    const built = buildCourse(findCourse('tutorial')!.spec);
    const course = coachCourseFrom(built.pieces);
    expect(course.ramps.map((r) => r.side)).toEqual(['right', 'left', 'right', 'left']);
    expect(course.ramps.map((r) => r.curve)).toEqual([null, null, 'left', 'right']);
    expect(course.ramps.map((r) => r.boosterAfter)).toEqual([false, false, true, false]);
    expect(built.pieces[course.finishPiece]).toMatchObject({ kind: 'pad', role: 'finish' });
  });
});

describe('TutorialCoach with the bot on the real Tutorial', () => {
  const built = buildCourse(findCourse('tutorial')!.spec);
  const coach = new TutorialCoach(coachCourseFrom(built.pieces));
  /** Each lesson shown, with how many ticks it stayed up. */
  const shown: { id: string; ticks: number }[] = [];
  const hints = new Set<string>();
  let pending: CourseEvent[] = [];
  let hint = 0;
  let lastLesson: CoachPrompt | null = null;
  const feed = (input: CoachInput): void => {
    coach.update(input);
    if (coach.current !== lastLesson) {
      shown.push({ id: coach.current?.id ?? '-', ticks: 0 });
      lastLesson = coach.current;
    }
    shown[shown.length - 1]!.ticks++;
    if (coach.hint) hints.add(`${coach.hint.tone}:${coach.hint.id}`);
  };
  // The 3 s countdown before the race, as in the game.
  for (let i = 0; i < 300; i++) feed({ ...countdown });
  const result = simulateRun(built, { hop: false }, 120, 0, {
    onTick(player, _tick, cmd) {
      const hit = built.path.locate(player.pos, hint);
      hint = hit.index;
      const k: CoachKeys = { w: cmd.forward > 0, s: cmd.forward < 0, d: cmd.side > 0, a: cmd.side < 0, space: cmd.jump };
      feed({ phase: 'racing', piece: hit.sample.piece, lateral: hit.lateral, surfing: player.surfing, onGround: player.onGround, keys: k, events: pending });
      pending = [];
    },
    onEvent(e) {
      pending.push(e);
    },
  });
  feed({ phase: 'finished', piece: built.pieces.length - 1, lateral: 0, surfing: false, onGround: true, keys: NO_KEYS, events: pending });
  const ids = shown.map((s) => s.id);

  it('finishes cleanly', () => {
    expect(result).toMatchObject({ finished: true, deaths: 0 });
  });

  it('goes through the lessons in order, one per ramp', () => {
    expect(ids.filter((id) => id !== 'walk')).toEqual(['basics', 'ramp-1', 'ramp-2', 'ramp-3', 'finish']);
  });

  it('leaves every lesson up long enough to read (at least 3.5 s)', () => {
    const tooShort = shown.slice(0, -1).filter((s) => s.ticks < 350);
    expect(tooShort).toEqual([]);
  });

  it('never warns a rider who is doing it right', () => {
    expect([...hints].filter((h) => h.startsWith('warn'))).toEqual([]);
  });
});

/**
 * The real test of the advice: a beginner who presses exactly the keys the
 * coach shows (nothing else; they look along the track, as told) must get
 * through the Tutorial without falling off.
 */
describe('a student who does exactly what the coach says', () => {
  const built = buildCourse(findCourse('tutorial')!.spec);
  const coach = new TutorialCoach(coachCourseFrom(built.pieces));
  const world = new BvhWorld(built.collision);
  const runtime = new CourseRuntime(built);
  const player = createPlayer();
  placeAtSpawn(player, built.spawn);
  runtime.afterRespawn(player);

  const pressed = (): CoachKeys => {
    const guide = coach.hint ?? coach.current;
    const k = { ...NO_KEYS };
    for (const key of guide?.hold ?? []) k[key] = true;
    return k;
  };

  for (let i = 0; i < 300; i++) coach.update({ ...countdown });
  let events: CourseEvent[] = [];
  let deaths = 0;
  let finished = false;
  let hint = 0;
  for (let tick = 0; tick < 120 * 100 && !finished; tick++) {
    const k = pressed();
    const here = built.path.locate(player.pos, hint);
    hint = here.index;
    stepPlayer(player, { forward: k.w ? 1 : 0, side: (k.d ? 1 : 0) - (k.a ? 1 : 0), jump: false, yaw: here.sample.heading }, DEFAULT_PHYSICS, world, TICK_DT);
    coach.update({ phase: 'racing', piece: runtime.piece, lateral: runtime.lateral, surfing: player.surfing, onGround: player.onGround, keys: k, events });
    events = runtime.update(player);
    for (const e of events) {
      if (e.type === 'kill') {
        deaths++;
        placeAtSpawn(player, runtime.respawnPoint());
        runtime.afterRespawn(player);
      }
      if (e.type === 'finish') finished = true;
    }
  }

  it('finishes the Tutorial without falling off', () => {
    expect({ finished, deaths }).toEqual({ finished: true, deaths: 0 });
  });
});

describe('parseCoachText', () => {
  it('splits keys and ramp swatches out of the text', () => {
    expect(parseCoachText('Hold {D}, not {W}: {ramp-right} ramps.')).toEqual([
      { kind: 'text', value: 'Hold ' },
      { kind: 'key', value: 'D' },
      { kind: 'text', value: ', not ' },
      { kind: 'key', value: 'W' },
      { kind: 'text', value: ': ' },
      { kind: 'swatch', value: 'right' },
      { kind: 'text', value: ' ramps.' },
    ]);
  });
});
