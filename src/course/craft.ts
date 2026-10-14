/**
 * Surf-map craft for AI courses (Oct 14 2026, from research into real surf
 * maps): the model designs the course; this adds the details real maps use,
 * without asking it for more (its prompt is nearly at its token budget).
 *  - A ramp before a big gap or drop gets a flare: its end kicks up and you
 *    launch over it.
 *  - A long, gently curving ramp gets an S-bend, alternating which way.
 * The validator then fits both to the difficulty, and the server rides the
 * course before serving it, smoothing them out if they're too much.
 */

/** Flares and S-bends asked for here; the validator eases them to what the difficulty allows. */
const FLARE = 16;
const SWERVE = 18;
/** A launch for gaps and drops at least this big. */
const JUMP_GAP = 600;
const JUMP_DROP = 800;
/** S-bends for ramps at least this long that curve no more than this. */
const SWERVE_LENGTH = 4500;
const SWERVE_MAX_CURVE = 20;

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null;

/** The segments (as the AI's reply laid them out), with flares and S-bends added where they suit. */
export function addSurfCraft(segments: readonly unknown[]): unknown[] {
  const out = segments.map((s) => (isObject(s) ? { ...s } : s));
  let swerveSign = 1;
  out.forEach((seg, i) => {
    if (!isObject(seg) || seg.type !== 'ramp') return;
    const prev = out[i - 1];
    if (isObject(prev) && prev.type === 'wall') return;
    // What comes after it, up to the next ramp, spiral or wall.
    let jump = false;
    for (let k = i + 1; k < out.length; k++) {
      const next = out[k];
      if (!isObject(next) || next.type === 'ramp' || next.type === 'spiral' || next.type === 'wall') break;
      if ((next.type === 'gap' && Number(next.length) >= JUMP_GAP) || (next.type === 'drop' && Number(next.height) >= JUMP_DROP)) jump = true;
    }
    const followed = out.slice(i + 1).some((s) => isObject(s) && (s.type === 'ramp' || s.type === 'spiral'));
    if (jump && followed && seg.flare === undefined) seg.flare = FLARE;
    else if (seg.swerve === undefined && seg.flare === undefined && Number(seg.length) >= SWERVE_LENGTH && Math.abs(Number(seg.curve ?? 0)) <= SWERVE_MAX_CURVE) {
      seg.swerve = swerveSign * SWERVE;
      swerveSign = -swerveSign;
    }
  });
  return out;
}
