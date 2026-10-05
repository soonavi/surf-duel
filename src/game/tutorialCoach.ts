/**
 * The Tutorial's on-screen coach, paced for someone who has never surfed.
 *
 * Three slots, each changing at its own speed:
 *  - the lesson: about one per ramp. It only changes at a calm moment (you've
 *    settled on a new ramp with the right key) and never before you've had
 *    time to read it (`readingTicks`). Each lesson also previews the next ramp,
 *    so you read what's coming before you need it.
 *  - the hint: one live line about your keys right now ("Holding D",
 *    "Let go of W"). Tapping a key doesn't touch the lesson.
 *  - the note: a few seconds about something that just happened (checkpoint,
 *    booster, falling off).
 *
 * Pure and tick-driven (100 Hz), so it's deterministic and unit-tested.
 *
 * The advice matches the movement model (src/physics): on a ramp, the strafe
 * key toward the ramp pushes you into it at up to the air wish-speed cap, and
 * the face turns that push into "up the slope". Holding W as well makes the
 * wish direction diagonal, so its projection on your velocity is already past
 * the cap and the push vanishes: you slide off.
 */
import type { Piece } from '../course/layout.js';
import type { CourseEvent } from '../course/runtime.js';
import type { RampSide } from '../course/schema.js';

export type CoachKey = 'w' | 'a' | 's' | 'd' | 'space';
export type CoachKeys = Record<CoachKey, boolean>;
export type CoachTone = 'info' | 'good' | 'warn';

export interface CoachPrompt {
  id: string;
  tone: CoachTone;
  title: string;
  /** May contain `{W}`-style key caps and `{ramp-right}` / `{ramp-left}` colour swatches. */
  text: string;
  /** Keys the rider should be holding (highlighted on the key display). */
  hold: CoachKey[];
  /** Keys the rider should let go of (shown orange while held). */
  avoid: CoachKey[];
}

export interface CoachRamp {
  piece: number;
  side: RampSide;
  /** Lateral offset of the ridge from the riding line; positive is to the right (`RampPiece.centerOffset`). */
  ridge: number;
  /** Which way the ramp bends, if it does. */
  curve: 'left' | 'right' | null;
  /** A booster sits between this ramp and the next. */
  boosterAfter: boolean;
}

export interface CoachCourse {
  /** Ramp pieces in course order. */
  ramps: CoachRamp[];
  finishPiece: number;
}

export type CoachEvent = CourseEvent | { type: 'respawn' };

export interface CoachInput {
  phase: 'countdown' | 'racing' | 'finished';
  /** Layout piece the rider is on, or flying toward (`PathSample.piece`). */
  piece: number;
  /** Offset from the riding line; positive is to the rider's right. */
  lateral: number;
  surfing: boolean;
  onGround: boolean;
  keys: CoachKeys;
  events: readonly CoachEvent[];
}

const MIN_LESSON_TICKS = 350;
const MAX_LESSON_TICKS = 650;

/** How long a lesson stays up at least: about 4.5 words a second plus a moment to look, 3.5–6.5 s. */
export function readingTicks(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_LESSON_TICKS, Math.min(MAX_LESSON_TICKS, 150 + words * 22));
}

/** Settled on a ramp: this long on it without a wrong key... */
const SETTLE_CLEAN_TICKS = 80;
/** ...having held the right key for at least this long. */
const SETTLE_HOLD_TICKS = 30;
/** A new hint must be wanted this long before it shows (tapped keys don't flicker it). */
const HINT_STABLE_TICKS = 20;
/** Letting go of the key for a moment is fine (riding high, you don't need the push). */
const RELEASE_GRACE_TICKS = 40;

const NOTE_TICKS = { firstCheckpoint: 500, secondCheckpoint: 400, checkpoint: 250, boost: 300, fell: 400, respawn: 300 } as const;

type Side = 'left' | 'right';

const keyOf = (side: Side): CoachKey => (side === 'right' ? 'd' : 'a');
const capOf = (side: Side): string => (side === 'right' ? '{D}' : '{A}');
const otherSide = (side: Side): Side => (side === 'right' ? 'left' : 'right');

function prompt(id: string, tone: CoachTone, title: string, text: string, hold: CoachKey[] = [], avoid: CoachKey[] = []): CoachPrompt {
  return { id, tone, title, text, hold, avoid };
}

function promptKey(p: CoachPrompt | null): string {
  return p ? `${p.id}|${p.tone}|${p.hold.join()}|${p.avoid.join()}` : '';
}

/** Which side the ramp is on for a rider at `lateral`: whichever face they're actually on (like the bot). */
function sideOnRamp(ramp: CoachRamp, lateral: number): Side {
  return lateral - ramp.ridge < 0 ? 'right' : 'left';
}

/** Which side a ramp will be on: as designed, unless it's two-sided. */
function sideAhead(ramp: CoachRamp, lateral: number): Side {
  return ramp.side === 'both' ? sideOnRamp(ramp, lateral) : ramp.side;
}

export class TutorialCoach {
  /** The lesson script for this course: basics, walk, one per ramp but the last, finish. */
  private readonly lessons: Map<string, CoachPrompt>;
  private readonly order: string[];

  private lesson: CoachPrompt | null = null;
  private lessonTicks = 0;
  /** After a respawn the lesson may change at once: it's about a new spot. */
  private forceNext = false;
  private lastStep = 1;

  private hintShown: CoachPrompt | null = null;
  private hintPending = '';
  private hintPendingTicks = 0;

  private flash: { prompt: CoachPrompt; ticksLeft: number } | null = null;

  /** Ramp being ridden, and how well. */
  private rampPiece = -1;
  private cleanTicks = 0;
  private holdTicks = 0;
  private releaseTicks = 0;
  /** Highest ramp (1-based) the rider has settled on. */
  private settled = 0;
  private retrying = false;
  private finished = false;
  private checkpointsSeen = 0;
  private boostsSeen = 0;

  constructor(private readonly course: CoachCourse) {
    this.lessons = buildLessons(course);
    this.order = [...this.lessons.keys()].filter((id) => id !== 'retry');
  }

  /** The lesson on screen. */
  get current(): CoachPrompt | null {
    return this.lesson;
  }

  /** The live line about your keys right now. */
  get hint(): CoachPrompt | null {
    return this.hintShown;
  }

  /** A short message about something that just happened, if any. */
  get note(): CoachPrompt | null {
    return this.flash?.prompt ?? null;
  }

  /** "Step 3 of 6". A retry keeps the step you were on. */
  get step(): { index: number; total: number } {
    const i = this.lesson ? this.order.indexOf(this.lesson.id) : -1;
    if (i >= 0) this.lastStep = i + 1;
    return { index: this.lastStep, total: this.order.length };
  }

  /** Call once per simulation tick. */
  update(input: CoachInput): void {
    if (this.flash && --this.flash.ticksLeft <= 0) this.flash = null;
    for (const e of input.events) this.onEvent(e, input);
    this.track(input);
    this.lessonTicks++;
    const want = this.wantLesson(input);
    if (want && want !== this.lesson) {
      const readEnough = this.lesson === null || this.lessonTicks >= readingTicks(this.lesson.text);
      if (readEnough || this.forceNext || want.id === 'finish') this.showLesson(want);
    }
    this.settleHint(this.wantHint(input));
  }

  private showLesson(p: CoachPrompt): void {
    this.lesson = p;
    this.lessonTicks = 0;
    this.forceNext = false;
  }

  // --- events ------------------------------------------------------------------------

  private onEvent(e: CoachEvent, input: CoachInput): void {
    switch (e.type) {
      case 'checkpoint': {
        this.checkpointsSeen++;
        if (this.checkpointsSeen === 1) {
          this.showNote(
            prompt('checkpoint', 'good', 'Checkpoint!', 'Fall off from here on and you restart at this gate. {R} brings you back to it any time.'),
            NOTE_TICKS.firstCheckpoint,
          );
        } else if (this.checkpointsSeen === 2) {
          this.showNote(prompt('checkpoint', 'good', `Checkpoint ${e.index}`, '{Shift} + {R} restarts the whole course.'), NOTE_TICKS.secondCheckpoint);
        } else {
          this.showNote(prompt('checkpoint', 'good', `Checkpoint ${e.index}`, 'Saved.'), NOTE_TICKS.checkpoint);
        }
        break;
      }
      case 'booster':
        if (this.boostsSeen++ === 0) {
          this.showNote(prompt('boost', 'good', 'Booster!', "It adds speed in the direction you're moving."), NOTE_TICKS.boost);
        }
        break;
      case 'kill':
        this.showNote(prompt('fell', 'warn', 'Fell off', this.checkpointsSeen > 0 ? 'Back to the last checkpoint.' : 'Back to the start.'), NOTE_TICKS.fell);
        this.afterRespawn(input);
        break;
      case 'respawn':
        this.showNote(prompt('respawn', 'info', 'Back to the checkpoint', '{Shift} + {R} restarts the whole course.'), NOTE_TICKS.respawn);
        this.afterRespawn(input);
        break;
      case 'finish':
        this.finished = true;
        break;
      case 'start':
        break;
    }
  }

  private showNote(p: CoachPrompt, ticks: number): void {
    this.flash = { prompt: p, ticksLeft: ticks };
  }

  /** You're somewhere new: re-teach what's in front of you, straight away. */
  private afterRespawn(input: CoachInput): void {
    this.rampPiece = -1;
    this.retrying = true;
    this.forceNext = true;
    this.hintShown = null;
    this.hintPending = '';
    this.hintPendingTicks = 0;
    const ramp = input.piece === 0 ? null : this.rampAtOrAfter(input.piece);
    if (ramp) {
      const side = sideOnRamp(ramp, input.lateral);
      this.lessons.set(
        'retry',
        prompt('retry', 'info', 'Try again', `This ramp is on your ${side}: hold ${capOf(side)} the whole way, keep off {W}, and look along the ramp.`, [keyOf(side)], ['w']),
      );
    }
  }

  // --- progress on ramps -------------------------------------------------------------

  private track(input: CoachInput): void {
    if (input.phase !== 'racing') return;
    const onRamp = input.surfing || (this.rampPiece >= 0 && input.piece === this.rampPiece);
    const ramp = onRamp ? this.rampAtOrAfter(input.piece) : null;
    if (!ramp) {
      this.releaseTicks = 0;
      return;
    }
    if (ramp.piece !== this.rampPiece) {
      this.rampPiece = ramp.piece;
      this.cleanTicks = 0;
      this.holdTicks = 0;
      this.releaseTicks = 0;
    }
    const side = sideOnRamp(ramp, input.lateral);
    const wrong = input.keys.w || input.keys[keyOf(otherSide(side))];
    if (wrong) {
      this.cleanTicks = 0;
      return;
    }
    this.cleanTicks++;
    if (input.keys[keyOf(side)]) {
      this.holdTicks++;
      this.releaseTicks = 0;
    } else {
      this.releaseTicks++;
    }
    if (this.cleanTicks >= SETTLE_CLEAN_TICKS && this.holdTicks >= SETTLE_HOLD_TICKS) {
      const index = this.course.ramps.indexOf(ramp) + 1;
      this.settled = Math.max(this.settled, index);
      this.retrying = false;
    }
  }

  // --- which lesson -------------------------------------------------------------------

  private wantLesson(input: CoachInput): CoachPrompt | null {
    const get = (id: string): CoachPrompt | null => this.lessons.get(id) ?? null;
    if (this.finished) return get('finish');
    if (input.phase === 'countdown') return get('basics');
    const onPad = input.piece === 0;
    if (this.retrying) return onPad ? get('walk') : (get('retry') ?? this.lesson);
    if (this.settled > 0) {
      // The last ramp has no lesson of its own (it goes by too fast to read one): the one before previews it.
      const k = Math.min(this.settled, Math.max(1, this.course.ramps.length - 1));
      return get(`ramp-${k}`) ?? this.lesson;
    }
    if (onPad) return this.lesson?.id === 'basics' || this.lesson === null ? get('walk') : this.lesson;
    return this.lesson ?? get('basics');
  }

  // --- the live hint ------------------------------------------------------------------

  private wantHint(input: CoachInput): CoachPrompt | null {
    if (input.phase !== 'racing' || this.finished) return null;
    const onRamp = input.surfing || (this.rampPiece >= 0 && input.piece === this.rampPiece);
    const ramp = this.rampAtOrAfter(input.piece);

    if (onRamp && ramp) {
      const side = sideOnRamp(ramp, input.lateral);
      const k = keyOf(side);
      const other = keyOf(otherSide(side));
      const cap = capOf(side);
      if (input.keys.w) return prompt('no-w', 'warn', 'Let go of W', `Let go of {W}: it cancels the push from ${cap}.`, [k], ['w']);
      if (input.keys[other]) return prompt('wrong-key', 'warn', 'Wrong key', `Wrong key: this ramp needs ${cap}.`, [k], [other]);
      if (input.keys[k]) return prompt('holding', 'good', 'Holding', `Holding ${cap}. Nice!`, [k], ['w']);
      if (this.releaseTicks > RELEASE_GRACE_TICKS || this.holdTicks === 0) return prompt('hold', 'info', 'Hold', `Hold ${cap} to stay on the ramp.`, [k], ['w']);
      return this.hintShown; // let go for a moment: say nothing new
    }

    // Standing on the start pad (including its front lip, where the path already says "ramp 1").
    const firstRamp = this.course.ramps[0];
    if (input.onGround && input.piece !== this.course.finishPiece && (!firstRamp || input.piece <= firstRamp.piece)) {
      if (input.keys.a || input.keys.d) {
        // On the ground A/D strafe: pressed now, they walk you off the side of the pad and past the ramp.
        const cap = input.keys.d ? '{D}' : '{A}';
        return prompt('not-yet', 'warn', 'Not yet', `Walk off with {W} first: on the pad, ${cap} just walks you sideways.`, ['w'], ['d', 'a']);
      }
      if (this.lesson?.id !== 'walk') return null; // still reading the basics
      return input.keys.w
        ? prompt('walking', 'good', 'Walking', 'Walking. Keep going off the edge.', ['w'])
        : prompt('press-w', 'info', 'Walk', 'Hold {W} to walk forward.', ['w']);
    }
    if (input.piece === 0) return null; // a jump on the pad

    if (!input.onGround && ramp && input.piece !== this.course.finishPiece) {
      const side = sideAhead(ramp, input.lateral);
      const k = keyOf(side);
      const other = keyOf(otherSide(side));
      const cap = capOf(side);
      const ready = input.keys[k] && !input.keys[other] && !input.keys.w;
      return ready
        ? prompt('ready', 'good', 'Ready', `Ready: ${cap} held for the ${side} ramp.`, [k], [other, 'w'])
        : prompt('switch', 'info', 'Switch', `Switch to ${cap} for the ${side} ramp.`, [k], [other, 'w']);
    }
    return null;
  }

  private settleHint(next: CoachPrompt | null): void {
    const key = promptKey(next);
    if (key === promptKey(this.hintShown)) {
      this.hintPending = key;
      this.hintPendingTicks = 0;
      if (next) this.hintShown = next;
      return;
    }
    if (key !== this.hintPending) {
      this.hintPending = key;
      this.hintPendingTicks = 0;
    }
    if (++this.hintPendingTicks >= HINT_STABLE_TICKS) this.hintShown = next;
  }

  private rampAtOrAfter(piece: number): CoachRamp | null {
    return this.course.ramps.find((r) => r.piece >= piece) ?? null;
  }
}

/** The lesson script, written for the ramps this course actually has. */
function buildLessons(course: CoachCourse): Map<string, CoachPrompt> {
  const lessons = new Map<string, CoachPrompt>();
  const ramps = course.ramps;
  const first = ramps[0];
  const firstSide: Side = first ? sideAhead(first, 0) : 'right';

  lessons.set(
    'basics',
    prompt('basics', 'info', 'Welcome to surfing', 'Surf a ramp by holding the key toward it: {D} for a ramp on your right, {A} for one on your left. Never {W} on a ramp.'),
  );
  lessons.set(
    'walk',
    prompt(
      'walk',
      'info',
      'Walk off the pad',
      `Hold {W} to walk off the front of the pad. Once you're falling, let go of {W} and hold ${capOf(firstSide)}: the first ramp is on your ${firstSide}.`,
      ['w'],
    ),
  );

  // One lesson per ramp but the last: what's new on this ramp, then what's next.
  const seenSides = new Set<Side>([firstSide]);
  let curveTaught = false;
  for (let i = 0; i < ramps.length - 1; i++) {
    const ramp = ramps[i]!;
    const next = ramps[i + 1]!;
    const side = sideAhead(ramp, 0);
    const cap = capOf(side);
    let title: string;
    let intro: string;
    if (i === 0) {
      title = "You're surfing!";
      intro = `Keep ${cap} held and look along the ramp with your mouse.`;
    } else if (ramp.side === 'both') {
      title = 'Two-sided ramp';
      intro = 'Ride whichever side you land on: hold the key toward the ridge.';
    } else if (!seenSides.has(side)) {
      title = 'Ramp colours';
      intro = '{ramp-left} means hold {A}, {ramp-right} means hold {D}.';
    } else if (ramp.curve && !curveTaught) {
      title = 'Curved ramp';
      intro = `Keep ${cap} held and turn the mouse ${ramp.curve} with the bend.`;
      curveTaught = true;
    } else {
      title = 'Nice riding';
      intro = `Keep ${cap} held.`;
    }
    if (ramp.side !== 'both') seenSides.add(side);

    const nextSide = sideAhead(next, 0);
    const nextCap = capOf(nextSide);
    const isLast = i + 1 === ramps.length - 1;
    const target = isLast ? 'the last ramp' : 'the next ramp';
    const bend = !isLast && next.curve ? ` and bends ${next.curve}` : '';
    let core: string;
    if (next.side === 'both') core = `${target} is two-sided: hold the key toward its ridge.`;
    else if (nextSide !== side) core = `${target} is on your ${nextSide}${bend}: switch to ${nextCap}${isLast ? '' : ' when you fly off'}.`;
    else core = `${target} is on your ${nextSide} too${bend}: keep holding ${nextCap}.`;
    const outro = ramp.boosterAfter ? `After the booster, ${core}` : core.charAt(0).toUpperCase() + core.slice(1);

    lessons.set(`ramp-${i + 1}`, prompt(`ramp-${i + 1}`, 'good', title, `${intro} ${outro}`, [keyOf(side)], ['w']));
  }

  lessons.set('finish', prompt('finish', 'good', 'Finished!', "That's surfing! Try Easy Cruise next, or create a room and race a friend."));
  return lessons;
}

/** Ramp sides, bends and boosters from a built course's pieces. */
export function coachCourseFrom(pieces: readonly Piece[]): CoachCourse {
  const ramps: CoachRamp[] = [];
  let finishPiece = pieces.length - 1;
  pieces.forEach((p, i) => {
    if (p.kind === 'ramp') {
      const first = p.points[0];
      const last = p.points[p.points.length - 1];
      const turn = first && last ? last.heading - first.heading : 0;
      // Positive yaw turns left (see course/layout.ts forwardOf).
      const curve = Math.abs(turn) < 0.05 ? null : turn > 0 ? 'left' : 'right';
      ramps.push({ piece: i, side: p.side, ridge: p.centerOffset, curve, boosterAfter: false });
    } else if (p.kind === 'booster') {
      const prev = ramps[ramps.length - 1];
      if (prev) prev.boosterAfter = true;
    } else if (p.kind === 'pad' && p.role === 'finish') {
      finishPiece = i;
    }
  });
  return { ramps, finishPiece };
}

export type CoachTextPart = { kind: 'text'; value: string } | { kind: 'key'; value: string } | { kind: 'swatch'; value: Side };

/** Split prompt text into plain text, key caps (`{D}`) and ramp colour swatches (`{ramp-left}`). */
export function parseCoachText(text: string): CoachTextPart[] {
  const parts: CoachTextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{([^}]+)\}/g)) {
    if (m.index > at) parts.push({ kind: 'text', value: text.slice(at, m.index) });
    const token = m[1]!;
    if (token === 'ramp-right' || token === 'ramp-left') parts.push({ kind: 'swatch', value: token === 'ramp-right' ? 'right' : 'left' });
    else parts.push({ kind: 'key', value: token });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', value: text.slice(at) });
  return parts;
}
