/**
 * The Tutorial's on-screen coach: a lesson chosen from what the rider is doing
 * this tick (which ramp, which keys), plus short notes about what just
 * happened (checkpoint, fall, finish). Pure and tick-driven, so it's
 * deterministic and unit-tested; the HUD only draws what it returns.
 *
 * The advice matches the movement model (src/physics): on a ramp, the strafe
 * key toward the ramp pushes you into it at up to the air wish-speed cap, and
 * the face turns that push into "up the slope". Holding W as well makes the
 * wish direction diagonal, so its projection on your velocity is already past
 * the cap and the push vanishes: you slide off. Turning away from the ramp
 * does the same; turning into it adds a backward component that brakes you.
 */
import type { Piece } from '../course/layout';
import type { CourseEvent } from '../course/runtime';
import type { RampSide } from '../course/schema';

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
  /** Keys the rider should let go of (shown red while held). */
  avoid: CoachKey[];
}

export interface CoachRamp {
  piece: number;
  side: RampSide;
  /** Lateral offset of the ridge from the riding line; positive is to the right (`RampPiece.centerOffset`). */
  ridge: number;
  /** Which way the ramp bends, if it does. */
  curve: 'left' | 'right' | null;
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

/** A new lesson must be wanted for this many ticks before it replaces the current one (no flicker from tapped keys). */
const STABLE_TICKS = 12;
/** Ticks (in total) of holding the right key on a ramp before it counts as "doing it". */
const SURF_CONFIRM = 40;
/** After that, ticks of "you're surfing!" before the mouse-aim lesson. */
const SURFING_SHOW = 150;
/** Ticks of the aim lesson before it counts as learned. */
const AIM_LEARN = 250;
/** Ticks the "other side" lesson stays up once you're doing it. */
const SIDE_SHOW = 100;
/**
 * Letting go of the key for a moment is fine (riding high, you don't need the
 * push); only remind after this many ticks without it.
 */
const RELEASE_GRACE = 50;
/** A ramp turning less than this (radians) counts as straight. */
const STRAIGHT_TURN = 0.05;

const NOTE_TICKS = { checkpoint: 300, boost: 220, fell: 340, respawn: 180, finished: 1000 } as const;

type RampLesson = 'surf' | 'side' | 'curve' | 'aim' | 'last' | 'none';
type FlightLesson = 'drop' | 'switch' | 'airstrafe' | 'quiet';
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

/** Which side a ramp you're flying toward will be on: as designed, unless it's two-sided. */
function sideAhead(ramp: CoachRamp, lateral: number): Side {
  return ramp.side === 'both' ? sideOnRamp(ramp, lateral) : ramp.side;
}

/**
 * Two slots: `current` is the lesson for where you are (debounced so tapped
 * keys don't make it flicker), and `note` is a short-lived message about
 * something that just happened. Notes never replace the lesson: checkpoint
 * gates hang right where you need to switch keys for the next ramp.
 */
export class TutorialCoach {
  private steady: CoachPrompt | null = null;
  private pendingKey = '';
  private pendingTicks = 0;
  private flash: { prompt: CoachPrompt; ticksLeft: number } | null = null;

  /** The ramp being ridden (or last ridden) and the lesson chosen for it. */
  private ramp: CoachRamp | null = null;
  private rampLesson: RampLesson = 'none';
  private rampSide: Side = 'right';
  private holdTicks = 0;
  private releaseTicks = 0;
  /** Ticks on this ramp since holding the key counted as "doing it"; -1 until then. */
  private sinceConfirm = -1;
  /** Piece of the flight's target, and the lesson chosen for that flight. */
  private flightTarget = -1;
  private flightLesson: FlightLesson = 'quiet';

  private readonly learned = new Set<string>();
  private readonly sidesSeen = new Set<Side>();
  private checkpointsSeen = 0;
  private boostsSeen = 0;

  constructor(private readonly course: CoachCourse) {}

  /** The lesson for where the rider is now. */
  get current(): CoachPrompt | null {
    return this.steady;
  }

  /** A short message about something that just happened, if any. */
  get note(): CoachPrompt | null {
    return this.flash?.prompt ?? null;
  }

  /** Call once per simulation tick. Returns the current lesson. */
  update(input: CoachInput): CoachPrompt | null {
    if (this.flash && --this.flash.ticksLeft <= 0) this.flash = null;
    for (const e of input.events) this.onEvent(e);
    this.settle(this.want(input));
    return this.steady;
  }

  private settle(next: CoachPrompt | null): void {
    const key = promptKey(next);
    if (key === promptKey(this.steady)) {
      this.steady = next; // same lesson; refresh its wording
      this.pendingKey = key;
      this.pendingTicks = 0;
      return;
    }
    if (key !== this.pendingKey) {
      this.pendingKey = key;
      this.pendingTicks = 0;
    }
    if (++this.pendingTicks >= STABLE_TICKS) this.steady = next;
  }

  private onEvent(e: CoachEvent): void {
    switch (e.type) {
      case 'checkpoint': {
        this.checkpointsSeen++;
        const p =
          this.checkpointsSeen === 1
            ? prompt('checkpoint', 'good', 'Checkpoint!', 'Fall off from here on and you restart at this gate. {R} brings you back to it any time.')
            : this.checkpointsSeen === 2
              ? prompt('checkpoint', 'good', `Checkpoint ${e.index}`, '{Shift} + {R} restarts the whole course.')
              : prompt('checkpoint', 'good', `Checkpoint ${e.index}`, 'Progress saved.');
        this.showNote(p, NOTE_TICKS.checkpoint);
        break;
      }
      case 'booster':
        if (this.boostsSeen++ === 0) {
          this.showNote(prompt('boost', 'good', 'Booster', "Boosters add speed in the direction you're already moving."), NOTE_TICKS.boost);
        }
        break;
      case 'kill': {
        const ramp = this.ramp ?? this.rampAtOrAfter(this.flightTarget);
        const back = this.checkpointsSeen > 0 ? 'Back to the last checkpoint.' : 'Back to the start.';
        const text = ramp
          ? `${back} On a ramp, hold ${capOf(this.ramp ? this.rampSide : sideAhead(ramp, 0))} the whole way, keep off {W}, and look along the ramp.`
          : `${back} Walk straight off the front of the pad.`;
        this.showNote(prompt('fell', 'warn', 'Fell off', text), NOTE_TICKS.fell);
        this.forgetPosition();
        break;
      }
      case 'respawn':
        this.showNote(prompt('respawn', 'info', 'Back to the checkpoint', '{Shift} + {R} restarts the whole course.'), NOTE_TICKS.respawn);
        this.forgetPosition();
        break;
      case 'finish':
        this.showNote(
          prompt('finished', 'good', 'Finished!', "That's surfing. Try Easy Cruise next, or create a room and race a friend."),
          NOTE_TICKS.finished,
        );
        break;
      case 'start':
        break;
    }
  }

  private showNote(p: CoachPrompt, ticks: number): void {
    this.flash = { prompt: p, ticksLeft: ticks };
  }

  /** After a respawn the rider is somewhere new: choose fresh lessons for what comes next. */
  private forgetPosition(): void {
    this.ramp = null;
    this.flightTarget = -1;
    // Whatever was on screen was about the old spot.
    this.steady = null;
    this.pendingKey = '';
    this.pendingTicks = 0;
  }

  // --- the lesson for where you are ------------------------------------------------

  private want(input: CoachInput): CoachPrompt | null {
    if (input.phase === 'countdown') {
      return prompt('look', 'info', 'Get ready', 'Move the mouse to look around. At GO, hold {W} to walk off the pad. {Esc} pauses.');
    }
    if (input.phase === 'finished') return null;
    // Still on (or just bounced off) the ramp we were riding.
    const onRamp = input.surfing || (this.ramp !== null && input.piece === this.ramp.piece);
    if (onRamp) {
      const ramp = this.rampAtOrAfter(input.piece);
      if (ramp) return this.onRamp(ramp, input);
    }
    if (input.onGround) {
      // Only pads are walkable; before the first ramp that's the start pad.
      return this.ramp === null && input.piece !== this.course.finishPiece
        ? prompt('walk', 'info', 'Walk off the pad', 'Hold {W} to walk forward and drop onto the ramp below. {Space} jumps.', ['w'])
        : null;
    }
    if (input.piece === 0) return this.steady; // a jump on the start pad: keep saying the same thing
    return this.inFlight(input);
  }

  private onRamp(ramp: CoachRamp, input: CoachInput): CoachPrompt | null {
    if (ramp.piece !== this.ramp?.piece) this.enterRamp(ramp);
    const side = sideOnRamp(ramp, input.lateral);
    this.rampSide = side;
    const k = keyOf(side);
    const other = keyOf(otherSide(side));
    const cap = capOf(side);
    const where = `on your ${side}`;

    if (input.keys.w) {
      return prompt('no-w', 'warn', 'Let go of W', `{W} cancels the push from ${cap}, so you slide off. Surf with ${cap} only.`, [k], ['w']);
    }
    if (input.keys[other]) {
      return prompt('wrong-key', 'warn', 'Wrong key', `The ramp is ${where}, so hold ${cap}. ${capOf(otherSide(side))} pushes you away from it.`, [k], [other]);
    }

    const holding = input.keys[k];
    if (holding) {
      this.holdTicks++;
      this.releaseTicks = 0;
    } else {
      this.releaseTicks++;
    }
    if (this.sinceConfirm < 0 && this.holdTicks >= SURF_CONFIRM) {
      this.sinceConfirm = 0;
      this.learned.add('surf');
      this.sidesSeen.add(side);
    }
    const confirmed = this.sinceConfirm >= 0;
    if (confirmed) this.sinceConfirm++;

    const reminder = (): CoachPrompt => prompt('hold', 'info', `Ramp ${where}`, `Hold ${cap} to stay on it.`, [k], ['w']);
    const letGo = this.releaseTicks > RELEASE_GRACE;
    switch (this.rampLesson) {
      case 'surf':
        if (!confirmed) {
          return prompt(
            'hold',
            'info',
            'Surf the ramp',
            `The ramp is ${where}: hold ${cap} to push into it. That keeps you up while gravity speeds you along.`,
            [k],
            ['w'],
          );
        }
        if (letGo) return reminder();
        if (this.sinceConfirm < SURFING_SHOW) {
          return prompt('surfing', 'good', "You're surfing!", `Keep ${cap} held. The ramp holds you up, and going downhill builds speed.`, [k], ['w']);
        }
        if (this.sinceConfirm >= SURFING_SHOW + AIM_LEARN) this.learned.add('aim');
        return this.aimPrompt(k);
      case 'side':
        if (confirmed && this.sinceConfirm >= SIDE_SHOW) return letGo ? reminder() : null;
        return prompt(
          'side',
          confirmed ? 'good' : 'info',
          `Ramp on your ${side}`,
          `Now hold ${cap}. Ramp colour tells you the key: {ramp-right} hold {D}, {ramp-left} hold {A}.`,
          [k],
          ['w'],
        );
      case 'curve': {
        const bend = ramp.curve ?? 'with it';
        return prompt('curve', 'info', 'Curved ramp', `This ramp bends ${bend}. Keep ${cap} held and turn the mouse ${bend} to follow it.`, [k], ['w']);
      }
      case 'aim':
        if (letGo) return reminder();
        if (this.sinceConfirm >= AIM_LEARN) this.learned.add('aim');
        return this.aimPrompt(k);
      case 'last':
        return prompt('last', 'info', 'Last ramp', `Hold ${cap} and ride it to the end: the finish pad is next.`, [k], ['w']);
      case 'none':
        return letGo ? reminder() : null;
    }
  }

  private aimPrompt(k: CoachKey): CoachPrompt {
    return prompt(
      'aim',
      'info',
      'Steer with the mouse',
      "Look along the ramp, the way you're moving. Turn away from it and you slide off; turn into it and you slow down.",
      [k],
      ['w'],
    );
  }

  private enterRamp(ramp: CoachRamp): void {
    this.ramp = ramp;
    this.holdTicks = 0;
    this.releaseTicks = 0;
    this.sinceConfirm = -1;
    this.flightTarget = -1;
    const side = sideAhead(ramp, 0);
    const isLast = this.course.ramps[this.course.ramps.length - 1]?.piece === ramp.piece;
    if (!this.learned.has('surf')) this.rampLesson = 'surf';
    else if (ramp.side !== 'both' && !this.sidesSeen.has(side)) this.rampLesson = 'side';
    else if (ramp.curve && !this.learned.has('curve')) {
      this.rampLesson = 'curve';
      this.learned.add('curve');
    } else if (!this.learned.has('aim')) this.rampLesson = 'aim';
    else if (isLast) this.rampLesson = 'last';
    else this.rampLesson = 'none';
  }

  private inFlight(input: CoachInput): CoachPrompt | null {
    if (input.piece === this.course.finishPiece) {
      return this.ramp ? prompt('finish-ahead', 'info', 'Finish ahead', 'Land on the finish pad to stop the clock.') : null;
    }
    const target = this.rampAtOrAfter(input.piece);
    if (!target) return null;
    if (target.piece !== this.flightTarget) this.enterFlight(target);

    const side = sideAhead(target, input.lateral);
    const k = keyOf(side);
    const other = keyOf(otherSide(side));
    const cap = capOf(side);
    const ready = input.keys[k] && !input.keys[other] && !input.keys.w;

    switch (this.flightLesson) {
      case 'drop':
        return ready
          ? prompt('drop', 'good', 'Get ready to surf', `Good: keep ${cap} held as you land.`, [k], ['w', other])
          : prompt('drop', 'info', 'Get ready to surf', `Ramp below, on your ${side}: let go of {W} and hold ${cap} as you land.`, [k], ['w', other]);
      case 'switch':
        return ready
          ? prompt('switch', 'good', 'Ready', `${cap} is held for the ${side} ramp. Nice.`, [k], [other])
          : prompt('switch', 'info', 'Switch sides', `Next ramp is on your ${side}: let go of ${capOf(otherSide(side))} and hold ${cap} before you land.`, [k], [other]);
      case 'airstrafe':
        return prompt(
          'airstrafe',
          'info',
          'Air-strafe',
          `Hold ${cap} and sweep the mouse ${side} at the same time. Matching key and mouse steers you in the air and adds speed.`,
          [k],
          [other],
        );
      case 'quiet':
        if (ready) return null;
        return this.rampSide === side
          ? prompt('keep', 'info', 'Same side again', `Next ramp is on your ${side} too: keep holding ${cap}.`, [k], [other])
          : prompt('switch', 'info', 'Switch sides', `Next ramp is on your ${side}: hold ${cap} before you land.`, [k], [other]);
    }
  }

  private enterFlight(target: CoachRamp): void {
    this.flightTarget = target.piece;
    const side = sideAhead(target, 0);
    if (!this.ramp) this.flightLesson = 'drop';
    else if (target.side !== 'both' && side !== this.rampSide && !this.learned.has('switch')) {
      this.flightLesson = 'switch';
      this.learned.add('switch');
    } else if (this.learned.has('switch') && !this.learned.has('airstrafe')) {
      this.flightLesson = 'airstrafe';
      this.learned.add('airstrafe');
    } else this.flightLesson = 'quiet';
  }

  private rampAtOrAfter(piece: number): CoachRamp | null {
    return this.course.ramps.find((r) => r.piece >= piece) ?? null;
  }
}

/** Ramp sides and bends from a built course's pieces. */
export function coachCourseFrom(pieces: readonly Piece[]): CoachCourse {
  const ramps: CoachRamp[] = [];
  let finishPiece = pieces.length - 1;
  pieces.forEach((p, i) => {
    if (p.kind === 'ramp') {
      const first = p.points[0];
      const last = p.points[p.points.length - 1];
      const turn = first && last ? last.heading - first.heading : 0;
      // Positive yaw turns left (see course/layout.ts forwardOf).
      const curve = Math.abs(turn) < STRAIGHT_TURN ? null : turn > 0 ? 'left' : 'right';
      ramps.push({ piece: i, side: p.side, ridge: p.centerOffset, curve });
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
