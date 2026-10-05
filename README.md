# Surf Duel

Browser multiplayer surf racing, inspired by the "surf" gamemode from Source-engine games. Slide along angled ramps, build speed by air-strafing, and race friends — or an AI-generated course.

> Work in progress. The full README (controls, architecture diagram, OpenAI course generator notes) lands in Phase 8. See [docs/SPEC.md](docs/SPEC.md) for the plan.

## Setup

```bash
npm install
cp .env.example .env.local   # Supabase + OpenAI settings (see below)
npm run dev                  # http://localhost:5173
```

Without Supabase settings the game still runs; the multiplayer buttons are simply hidden. Without OpenAI settings the AI generator says it isn't set up and offers a random course instead.

`npm run dev` also runs the serverless functions in `api/` (a small dev-server middleware calls the same handlers Vercel does), so the whole game works locally without the Vercel CLI. Server-only variables from `.env.local` are loaded into the dev server's Node process for those handlers; only `VITE_`-prefixed ones ever reach the browser.

The database schema lives in `supabase/migrations/`.

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

## Tutorial coach

The **Tutorial** course has an on-screen coach (`src/game/tutorialCoach.ts`), paced for someone who has never surfed. A card above the speedometer has three parts that change at different speeds:

- **The lesson** (with "Step 3 of 6"): about one per ramp. It only changes at a calm moment (you've settled on a new ramp with the right key) and never before you've had time to read it (3.5–6.5 s, by length). Each lesson previews the next ramp ("The next ramp is on your left: switch to A when you fly off"), so you read what's coming before you need it. Steps: the basics (hold the key toward the ramp, never W) → walk off the pad (let go of W and hold D once you're falling) → you're surfing (look along the ramp) → ramp colours tell you the key → curves, the booster and the last ramp → finished.
- **The live hint**, one short line about your keys right now: "✓ Holding D", "! Let go of W", "! Wrong key", "→ Switch to A", and on the pad "! Walk off with W first" (A/D on the ground walks you sideways off the pad). Tapping keys never changes the lesson.
- **Notes** for a few seconds after a checkpoint (what R and Shift+R do), the first booster, or a fall (and after a fall the lesson re-teaches the ramp you're back on, straight away).

Next to it, a live W A S D / Space display: keys to hold pulse blue, keys to let go of turn orange while held.

Tests check the pacing (every lesson stays up long enough to read, in a bot run through the real Tutorial) and the advice itself: a simulated beginner who presses exactly the keys the coach shows, and nothing else, finishes the Tutorial without falling off.

## Racing

Pick a course and press **Play**: a 3-2-1 countdown (you can look around but not move), then the clock runs from GO in exact 10 ms simulation ticks. The HUD shows the run time, checkpoints reached, a progress bar with markers for each ghost, split pop-ups (`+0.42` / `−0.31` against your personal best, in colour-blind-safe blue/orange) and your speed. After the finish you get the results: time, splits, top speed, rank among your local runs, and the rival ghost's time. **R**/Enter races again, **M** goes back to the menu, **Shift+R** restarts mid-run.

Ghosts are recorded at 20 Hz and stored compactly (constant-velocity prediction + zigzag varints, ~5 KB a minute). You race your personal best (gold, **PB**) and a rival (mint):

- **DEV** — a human-recorded dev ghost from `src/course/ghosts/<course-id>.json`, or
- **BOT** — if there isn't one (or it was recorded on an older layout of the course), the cautious bot rides the course live and becomes the rival, so a solo player always has someone to race.

Records and ghosts are keyed by a fingerprint of the course spec, the layout version and the default physics (`courseKey.ts`), so a change to the course invalidates them instead of replaying ghosts through moved walls. Runs with autopilot, noclip or modified physics aren't saved.

**Recording a dev ghost:** in `npm run dev`, finish a clean run and click **Save as dev ghost** on the results screen. The dev server writes the file into `src/course/ghosts/`; commit it.

## AI course generator

**Design a course with AI** on the start screen (or **✨ AI course / code…** in a room, for the host) takes a description up to 200 characters, with five example prompts to start from. The OpenAI API designs the course; the game builds it, shows a flyover preview, and gives it a 6-character share code (`/?course=K7M2QX`) so friends can race it. **Regenerate** asks again with the same prompt; the share-code box (or a pasted link) loads anyone's course.

How it works:

- `POST /api/generate-course` (`api/generate-course.ts` → `server/generateCourse.ts`) checks the prompt (≤ 200 chars), then claims a slot from the database before spending anything, then calls OpenAI with a hard 15 s timeout.
- **Malicious prompts.** Prompts are saved with shared courses and shown to other players, and they go to an AI, so they pass several layers:
  1. `preparePrompt` (`src/course/aiSchema.ts`, run in the browser for instant feedback and again on the server): invisible and disguised text is stripped (zero-width and direction-override characters, hidden "tag" characters, look-alike letters, stacked accents), characters a description never needs (angle brackets, braces, square brackets, backticks, backslashes) are dropped, and links, emails, @handles and blocked words (`src/util/text.ts`, which sees through leetspeak, spacing and repeated letters) are turned away before anything is spent.
  2. OpenAI's **moderation check** (`server/openaiModerator.ts`; free, so it doesn't touch the prepaid credit) screens the prompt before the course model sees it. Hate, harassment, sexual, self-harm, graphic-violence and illicit descriptions are refused; plain cartoon action ("shoot zombies") is allowed. If the check can't run, the server refuses (fails closed).
  3. The prompt reaches the model as a single JSON string, labelled as a description and never instructions, and Structured Outputs forces the reply into the course schema, so the worst an injected instruction can do is shape a course. Every number is then clamped by `validateCourse`.
  4. The reply's one free-text field, the course name, is cleaned, link/word-checked by the validator (for every course from anywhere, shared or in a room) and moderated too; anything flagged becomes "Untitled Course".
  5. All of it is rendered with `textContent`, never as HTML, and saved prompts are cleaned again before they're shown.
- **Spending caps.** The game runs on a small prepaid OpenAI credit, so it can never spend more than that. One Postgres function (`claim_generation`, in `supabase/migrations/`) checks every limit and counts the generation in a single locked step, so simultaneous requests can't slip past a cap: 6 per player per 10 minutes and 40 a day (IPs stored only as a keyed hash), **150 a day across all players**, and **1,800 in total**. Each reply is capped at 1,500 tokens, so with `gpt-5.4-nano` the worst case for all 1,800 is about $4.30. Failed attempts count too. If the database can't be reached, the server refuses to call OpenAI at all.
- The call (`server/openaiDesigner.ts`) uses the Responses API with **Structured Outputs**: a strict JSON schema (`src/course/aiSchema.ts`) built from the same `LIMITS` as the zod schema, plus a system prompt that explains segment types, safe ranges, difficulty styles and theme moods, and says the player's text (sent as a JSON string) is a description, never instructions. The model comes from `OPENAI_MODEL`; prompts aren't stored on OpenAI's side (`store: false`).
- Whatever comes back goes through `validateCourse`, the same repair pass every course gets, so it is always beatable. The playability tests include deliberately extreme AI-style specs (every drop at max, max gaps, every ramp bending the same way, 40 segments) and the bot must finish each one from the start and from every checkpoint.
- The course is saved in the `courses` table under a fresh code. Anyone can read courses (RLS: select for anon); only the service role in the API can write. If saving fails you still get to race it, just without a code.
- **Never a dead end:** a timeout, an AI failure, the rate limit, a bad code or no network all show a friendly message with **Race a random course instead**.
- In a room, AI and shared courses travel as their full spec (plus share code), random ones as their seed, and every client rebuilds the same geometry.

## Multiplayer

**Create room** gives you a 4-letter code and an invite link (`/?room=ABCD`); **Join** takes a code. Up to 8 players. The host (whoever has been in the room longest) picks the course and starts the race; everyone else readies up. Testing alone? The lobby's **Open a second tab** button opens the invite in a new tab — each tab is a separate player — and **Race the dev ghost** practises the room's course solo.

How it works (`src/net/`), on Supabase Realtime, one channel per room:

- **Presence** carries each player's name, colour, status and result. The host's presence also carries the room state (course, race id, start time), so late joiners get it instantly and it survives the host leaving — the next-longest member is promoted and re-publishes it. Join order is stamped so it never depends on whose clock is wrong.
- **Broadcast** carries movement sampled at 20 Hz (position, velocity, yaw), stamped with race time. Remote players are replayed ~100 ms+ in the past with velocity-aware (Hermite) interpolation, extrapolating briefly if packets are late, snapping across respawns.
- **Synchronised start:** the host announces GO in its own clock; everyone converts it with an NTP-style offset estimated from ping/pong. Measured: both players hit GO within the same millisecond.
- **Message budget:** Realtime counts every delivered copy, so a room costs ~players² messages per send. Samples are always taken at 20 Hz but batched to fit `DEFAULT_BUDGET` (300 msg/s): one sample per message for 2 players, larger batches as the room grows. The Supabase client is lazy-loaded, so solo players never download it.
- **Edge cases:** host leaves → next player promoted; joining mid-race → spectate (chase cam, ←/→ to switch); room full (8) and invalid / unknown codes get clear messages; losing the mouse or hiding the tab doesn't pause a shared race, and time the tab spent asleep is charged to your clock; connection loss shows a reconnecting banner.

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
