# Surf Duel

Browser multiplayer surf racing, inspired by the "surf" gamemode from Source-engine games. Slide along angled ramps, build speed by air-strafing, and race friends — or an AI-generated course.

> Work in progress. The full README (controls, architecture diagram, OpenAI course generator notes) lands in Phase 8. See [docs/SPEC.md](docs/SPEC.md) for the plan.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in keys when Supabase/OpenAI phases arrive
npm run dev                  # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (tuning panel enabled) |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Typecheck + production build to `dist/` |

## Dev tuning panel

Press <kbd>`</kbd> (backtick) to toggle it. It's on in `npm run dev`, and in any build with `?dev` in the URL. Physics tweaks persist in localStorage until you press **Reset to defaults**; **Copy physics JSON** copies the current values.

## Controls

| Key | Action |
|---|---|
| Mouse | Look (pointer lock, raw input where supported) |
| W A S D | Move / air-strafe |
| Space | Jump (hold to auto-hop) |
| R | Back to last checkpoint |
| Shift + R | Restart the course |
| Esc | Pause (release mouse) |
| B | Autopilot: watch the bot surf the course (dev builds) |
| N | Noclip (dev builds; Space/C up/down, Shift fast) |

## Racing

Pick a course and press **Play**: a 3-2-1 countdown (you can look around but not move), then the clock runs from GO in exact 10 ms simulation ticks. The HUD shows the run time, checkpoints reached, a progress bar with markers for each ghost, split pop-ups (`+0.42` / `−0.31` against your personal best, in colour-blind-safe blue/orange) and your speed. After the finish you get the results: time, splits, top speed, rank among your local runs, and the rival ghost's time. **R**/Enter races again, **M** goes back to the menu, **Shift+R** restarts mid-run.

Ghosts are recorded at 20 Hz and stored compactly (constant-velocity prediction + zigzag varints, ~5 KB a minute). You race your personal best (gold, **PB**) and a rival (mint):

- **DEV** — a human-recorded dev ghost from `src/course/ghosts/<course-id>.json`, or
- **BOT** — if there isn't one (or it was recorded on an older layout of the course), the cautious bot rides the course live and becomes the rival, so a solo player always has someone to race.

Records and ghosts are keyed by a fingerprint of the course spec, the layout version and the default physics (`courseKey.ts`), so a change to the course invalidates them instead of replaying ghosts through moved walls. Runs with autopilot, noclip or modified physics aren't saved.

**Recording a dev ghost:** in `npm run dev`, finish a clean run and click **Save as dev ghost** on the results screen. The dev server writes the file into `src/course/ghosts/`; commit it.

## Courses

A course is a small JSON spec (`src/course/schema.ts`): a name, a theme (`neon`, `desert`, `ice`, `lava`, `void`), a difficulty, and a list of segments — `ramp` (length, angle 46–60°, side, curve), `drop`, `gap`, `booster`, `checkpoint`. (The original spec allowed 70° ramps; playtesting found anything past 60° barely holdable.)

Checkpoints are fly-through arches over the flight into the next ramp. Respawning at one (R, or falling off) puts you on that ramp's face already moving at the speed a cautious rider would have there, so every checkpoint is a fair restart.

- `validator.ts` repairs anything (bad numbers, unknown types, two drops in a row, gaps too long for the speed riders will have, courses too long/short or looping back on themselves) and never throws.
- `layout.ts` walks a track cursor along the *riding line* and sizes every transition from a speed model with a cautious and a fast rider: the cautious one must clear the next ramp's ridge, the fast one must still land on it (ramps are lengthened and kept straight through the landing zone). A checkpoint gate is added after every three ramps without one.
- `builder.ts` turns the layout into merged geometry (a handful of draw calls), trigger volumes and a track path (progress, kill floor).
- `playability.test.ts` runs a bot through every shipped course and 40 random ones in the real physics — riding cautiously and aggressively, and restarting from every checkpoint; every run must finish without dying.

Shipped courses live in `src/course/courses/*.json`. Ramp colour tells you which key to hold: each theme uses one colour for ramps on your right (hold D) and another for ramps on your left (hold A).

## Movement model

Source/Quake-style, in `src/physics/` — pure, deterministic, and unit-tested:

- `movement.ts` — accelerate / air-accelerate (wish-speed cap), friction, velocity clipping, multi-plane crease logic.
- `collision.ts` — capsule (32 × 72) vs. a three-mesh-bvh BVH, resolved deepest-contact-first so triangle seams don't bleed speed.
- `player.ts` — one 100 Hz tick: half-gravity before/after, jump-before-friction (lossless bunny-hops), ground vs. air movement, sub-stepped collide-and-slide (≤ 8 units per substep, so no tunnelling at 3500 u/s), ground categorisation. Surfaces with `normal.y < 0.7` are surfable.
