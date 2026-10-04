import { describe, expect, it } from 'vitest';
import {
  TutorialCoach,
  coachCourseFrom,
  parseCoachText,
  type CoachCourse,
  type CoachInput,
  type CoachKeys,
  type CoachPrompt,
  type CoachRamp,
} from './tutorialCoach';
import { buildCourse } from '../course/builder';
import { findCourse } from '../course/courses';
import { simulateRun } from '../course/simulate';
import type { CourseEvent } from '../course/runtime';

// Mirrors the Tutorial course: start pad, R, gate, L, gate, R (bends left), booster, L (bends right), finish.
const RIDGE = { right: 200, left: -200, both: 0 } as const;
const ramp = (piece: number, side: CoachRamp['side'], curve: CoachRamp['curve'] = null): CoachRamp => ({ piece, side, ridge: RIDGE[side], curve });
const COURSE: CoachCourse = {
  ramps: [ramp(1, 'right'), ramp(3, 'left'), ramp(5, 'right', 'left'), ramp(7, 'left', 'right')],
  finishPiece: 8,
};

const NO_KEYS: CoachKeys = { w: false, a: false, s: false, d: false, space: false };
const keys = (...held: (keyof CoachKeys)[]): CoachKeys => ({ ...NO_KEYS, ...Object.fromEntries(held.map((k) => [k, true])) });

const base: CoachInput = { phase: 'racing', piece: 0, surfing: false, onGround: true, lateral: 0, keys: NO_KEYS, events: [] };
const onRamp = (piece: number, k: CoachKeys, lateral = 0): CoachInput => ({ ...base, piece, surfing: true, onGround: false, lateral, keys: k });
const flying = (toward: number, k: CoachKeys): CoachInput => ({ ...base, piece: toward, surfing: false, onGround: false, keys: k });

/** Feed the same input for `ticks` ticks; returns the prompt after the last one. */
function run(coach: TutorialCoach, input: CoachInput, ticks: number): CoachPrompt | null {
  let p: CoachPrompt | null = null;
  for (let i = 0; i < ticks; i++) p = coach.update(i === 0 ? input : { ...input, events: [] });
  return p;
}

/** A coach that has already ridden the first ramp properly (surf + aim lessons done). */
function pastFirstRamp(): TutorialCoach {
  const coach = new TutorialCoach(COURSE);
  run(coach, onRamp(1, keys('d')), 700);
  return coach;
}

describe('TutorialCoach: start', () => {
  it('teaches looking around during the countdown', () => {
    const p = run(new TutorialCoach(COURSE), { ...base, phase: 'countdown' }, 20);
    expect(p?.id).toBe('look');
  });

  it('tells you to walk off the start pad with W', () => {
    const p = run(new TutorialCoach(COURSE), base, 20);
    expect(p?.id).toBe('walk');
    expect(p?.hold).toEqual(['w']);
  });

  it('says to swap W for the ramp key while dropping onto the first ramp', () => {
    const p = run(new TutorialCoach(COURSE), flying(1, keys('w')), 20);
    expect(p?.id).toBe('drop');
    expect(p?.hold).toEqual(['d']);
    expect(p?.avoid).toContain('w');
  });
});

describe('TutorialCoach: on a ramp', () => {
  it('asks you to hold the key on the ramp side', () => {
    const p = run(new TutorialCoach(COURSE), onRamp(1, NO_KEYS), 20);
    expect(p?.id).toBe('hold');
    expect(p?.hold).toEqual(['d']);
    expect(p?.text).toContain('{D}');
  });

  it('warns when W is held, which cancels the push into the ramp', () => {
    const p = run(new TutorialCoach(COURSE), onRamp(1, keys('w', 'd')), 30);
    expect(p?.id).toBe('no-w');
    expect(p?.tone).toBe('warn');
    expect(p?.avoid).toEqual(['w']);
  });

  it('warns when the key away from the ramp is held', () => {
    const p = run(new TutorialCoach(COURSE), onRamp(1, keys('a')), 30);
    expect(p?.id).toBe('wrong-key');
    expect(p?.hold).toEqual(['d']);
    expect(p?.avoid).toEqual(['a']);
  });

  it('ignores a key tapped for a moment (no flicker)', () => {
    const coach = new TutorialCoach(COURSE);
    run(coach, onRamp(1, NO_KEYS), 30);
    expect(run(coach, onRamp(1, keys('w')), 5)?.id).toBe('hold');
  });

  it('praises a held key, then teaches aiming with the mouse', () => {
    const coach = new TutorialCoach(COURSE);
    expect(run(coach, onRamp(1, keys('d')), 90)?.id).toBe('surfing');
    expect(run(coach, onRamp(1, keys('d')), 90)?.tone).toBe('good');
    expect(run(coach, onRamp(1, keys('d')), 200)?.id).toBe('aim');
  });

  it('introduces the other side on the first left ramp, with the colour key', () => {
    const coach = pastFirstRamp();
    const p = run(coach, onRamp(3, NO_KEYS), 20);
    expect(p?.id).toBe('side');
    expect(p?.hold).toEqual(['a']);
    expect(p?.text).toContain('{ramp-left}');
  });

  it('explains curved ramps the first time, with the bend direction', () => {
    const coach = pastFirstRamp();
    run(coach, onRamp(3, keys('a')), 300);
    const p = run(coach, onRamp(5, keys('d')), 20);
    expect(p?.id).toBe('curve');
    expect(p?.text).toMatch(/left/);
  });

  it('flags the last ramp before the finish', () => {
    const coach = pastFirstRamp();
    run(coach, onRamp(3, keys('a')), 300);
    run(coach, onRamp(5, keys('d')), 300);
    expect(run(coach, onRamp(7, keys('a')), 20)?.id).toBe('last');
  });

  it('gets out of the way once a ramp holds nothing new', () => {
    const coach = new TutorialCoach({ ramps: [ramp(1, 'right'), ramp(2, 'right'), ramp(3, 'right')], finishPiece: 4 });
    run(coach, onRamp(1, keys('d')), 700);
    expect(run(coach, onRamp(2, keys('d')), 30)).toBeNull();
  });

  it('asks for the other key after overshooting onto the far face', () => {
    const coach = new TutorialCoach(COURSE);
    expect(run(coach, onRamp(1, NO_KEYS, 260), 20)?.hold).toEqual(['a']); // past the ridge (200 to the right)
  });

  it('works out which face of a two-sided ramp you are on', () => {
    const coach = new TutorialCoach({ ramps: [ramp(1, 'both')], finishPiece: 2 });
    expect(run(coach, onRamp(1, NO_KEYS, 120), 20)?.hold).toEqual(['a']); // right of the ridge: ramp is on your left
    expect(run(coach, onRamp(1, NO_KEYS, -120), 20)?.hold).toEqual(['d']);
  });
});

describe('TutorialCoach: between ramps', () => {
  it('tells you to switch keys before an opposite-side ramp', () => {
    const coach = pastFirstRamp();
    const p = run(coach, flying(3, keys('d')), 20);
    expect(p?.id).toBe('switch');
    expect(p?.hold).toEqual(['a']);
    expect(p?.avoid).toEqual(['d']);
    expect(p?.tone).toBe('info');
  });

  it('confirms once the new key is held', () => {
    const coach = pastFirstRamp();
    run(coach, flying(3, keys('d')), 20);
    expect(run(coach, flying(3, keys('a')), 20)?.tone).toBe('good');
  });

  it('teaches air-strafing on a later flight', () => {
    const coach = pastFirstRamp();
    run(coach, flying(3, keys('a')), 40);
    run(coach, onRamp(3, keys('a')), 300);
    const p = run(coach, flying(5, keys('d')), 20);
    expect(p?.id).toBe('airstrafe');
    expect(p?.hold).toEqual(['d']);
  });

  it('points at the finish pad after the last ramp', () => {
    const coach = pastFirstRamp();
    expect(run(coach, flying(8, NO_KEYS), 20)?.id).toBe('finish-ahead');
  });
});

describe('TutorialCoach: events', () => {
  it('celebrates a checkpoint with a note that explains R, then clears it', () => {
    const coach = pastFirstRamp();
    run(coach, { ...flying(3, keys('a')), events: [{ type: 'checkpoint', index: 1 }] }, 10);
    expect(coach.note?.id).toBe('checkpoint');
    expect(coach.note?.text).toContain('{R}');
    run(coach, flying(3, keys('a')), 320);
    expect(coach.note).toBeNull();
  });

  it('keeps the lesson on screen alongside a note', () => {
    const coach = pastFirstRamp();
    const lesson = run(coach, { ...flying(3, keys('d')), events: [{ type: 'checkpoint', index: 1 }] }, 20);
    expect(lesson?.id).toBe('switch');
    expect(coach.note?.id).toBe('checkpoint');
  });

  it('explains what went wrong after falling off, and drops the stale warning', () => {
    const coach = new TutorialCoach(COURSE);
    expect(run(coach, onRamp(1, keys('w')), 50)?.id).toBe('no-w');
    const lesson = run(coach, { ...base, piece: 0, events: [{ type: 'kill' }] }, 5);
    expect(coach.note?.id).toBe('fell');
    expect(coach.note?.tone).toBe('warn');
    expect(coach.note?.text).toContain('{D}');
    expect(coach.note?.text).toMatch(/^Back to the start/);
    expect(lesson?.id).not.toBe('no-w');
  });

  it('says you are back at the checkpoint once you have passed one', () => {
    const coach = pastFirstRamp();
    run(coach, { ...flying(3, keys('a')), events: [{ type: 'checkpoint', index: 1 }] }, 5);
    run(coach, { ...onRamp(3, keys('w')), events: [{ type: 'kill' }] }, 5);
    expect(coach.note?.text).toMatch(/^Back to the last checkpoint/);
  });

  it('congratulates you at the finish', () => {
    const coach = pastFirstRamp();
    run(coach, { ...base, piece: 8, events: [{ type: 'finish' }] }, 10);
    expect(coach.note?.id).toBe('finished');
  });
});

describe('coachCourseFrom', () => {
  it('reads ramp sides and bends from the built Tutorial', () => {
    const built = buildCourse(findCourse('tutorial')!.spec);
    const coach = coachCourseFrom(built.pieces);
    expect(coach.ramps.map((r) => r.side)).toEqual(['right', 'left', 'right', 'left']);
    expect(coach.ramps.map((r) => r.curve)).toEqual([null, null, 'left', 'right']);
    expect(built.pieces[coach.finishPiece]).toMatchObject({ kind: 'pad', role: 'finish' });
  });
});

describe('TutorialCoach with the bot on the real Tutorial', () => {
  const built = buildCourse(findCourse('tutorial')!.spec);
  const coach = new TutorialCoach(coachCourseFrom(built.pieces));
  /** Every lesson and note that appeared, in order. */
  const shown: CoachPrompt[] = [];
  let pending: CourseEvent[] = [];
  let hint = 0;
  let lastLesson: string | null = null;
  let lastNote: CoachPrompt | null = null;
  const feed = (input: CoachInput): void => {
    const lesson = coach.update(input);
    const key = lesson ? `${lesson.id}|${lesson.tone}` : null;
    if (lesson && key !== lastLesson) shown.push(lesson);
    lastLesson = key;
    if (coach.note && coach.note !== lastNote) shown.push(coach.note);
    lastNote = coach.note;
  };
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
  const ids = shown.map((p) => p.id);

  it('finishes cleanly', () => {
    expect(result.finished).toBe(true);
    expect(result.deaths).toBe(0);
  });

  it('never scolds a rider who is doing it right', () => {
    expect(shown.filter((p) => p.tone === 'warn').map((p) => p.id)).toEqual([]);
  });

  it('walks through every lesson in order', () => {
    const order = ['walk', 'drop', 'surfing', 'aim', 'checkpoint', 'switch', 'side', 'checkpoint', 'airstrafe', 'curve', 'boost', 'last', 'finished'];
    let at = 0;
    for (const id of ids) if (id === order[at]) at++;
    expect(order.slice(at)).toEqual([]); // everything left over was never shown, in order
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
