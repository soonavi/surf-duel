# Build "Surf Duel" — browser multiplayer surf racing game

You are building a contest entry for the **Handshake AI Skills Studio x OpenAI Multiplayer Game Challenge**. Deadline: **Oct 30, 2026, 11:59 PM PT**. Entries are judged equally (25% each) on:
- **Execution** — works end to end, stable, demo-ready
- **Creativity** — fresh concept or clever implementation
- **Usefulness / Value** — delights its audience
- **Polish & Thoughtfulness** — feels like a real product: onboarding, edge cases, clear guidance

The submission needs a title, a cover image, a description, and a **live URL**. Judges will most likely open the link **alone, on a laptop, possibly with a trackpad**, and give it a few minutes. Every design decision should serve that judge.

Work in phases (below). **Stop at the end of each phase**, tell me exactly what to test and how, and wait for my go-ahead. Commit after each phase. Do not skip ahead.

---

## 1. The concept

A browser-based, first-person **surf racing** game inspired by the "surf" gamemode from Source-engine games (Counter-Strike), where players slide along angled ramps and build speed by air-strafing. The game uses **only original assets and names** (no Valve maps, textures, sounds, or trademarks).

Core loop:
1. Player joins a room with a 4-letter code (or plays solo).
2. Everyone races the same course: start zone → ramps → checkpoints → finish.
3. Other players show up as translucent "ghost" surfers (no player collision).
4. Results screen with times, splits, and a rematch button.

The OpenAI twist (this is required; the contest is co-branded with OpenAI): **AI Course Generator.** A player types a prompt like *"long sweeping ramps over lava, one huge drop, medium difficulty"*, the OpenAI API returns a structured course spec, and the game builds a playable 3D course from it deterministically. Every generated course gets a shareable code so friends can race it.

## 2. Tech stack

- **Vite + TypeScript** (strict) for the client
- **Three.js** for rendering, **three-mesh-bvh** for collision queries
- **Supabase**:
  - **Realtime Broadcast + Presence** for rooms
  - **Postgres** for courses and leaderboard
- **Vercel** for hosting, plus Vercel serverless functions (`/api/*`) for anything that needs a secret, e.g. the OpenAI call
- **OpenAI API** via the official `openai` npm package, using Structured Outputs (JSON schema). Read the model name from the env var `OPENAI_MODEL` (don't hardcode it).
- **zod** for validating every external payload (AI output, network messages, DB rows)
- **vitest** for physics unit tests
- **lil-gui** for a dev-only tuning panel, toggled with the backtick key (`)

Env vars:
- client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- server only: `OPENAI_API_KEY`, `OPENAI_MODEL`, `SUPABASE_SERVICE_ROLE_KEY`

Create `.env.example` with all of these. Never expose server keys to the client.

Suggested structure:
```
src/
  main.ts
  game/        # loop, fixed timestep, state machine (menu/loading/countdown/racing/results)
  physics/     # movement.ts (pure functions), collision.ts, constants.ts
  course/      # schema.ts (zod), builder.ts (spec -> meshes + colliders), validator.ts, courses/*.json
  net/         # room.ts (Supabase channel), interpolation.ts, protocol.ts (zod message types)
  render/      # scene, lighting, materials, ghost rendering, effects
  ui/          # HTML/CSS overlays: menus, HUD, results, settings, tutorial prompts
  audio/
api/
  generate-course.ts
  submit-run.ts
supabase/migrations/
```

## 3. Movement physics (the most important part — get this right first)

Implement Source/Quake-style movement as **pure, unit-tested functions**, in a fixed-timestep loop (**tick rate 100 Hz**, render interpolated between ticks).

**Air acceleration** (the core of surfing):
```
accelerate(vel, wishDir, wishSpeed, accel, dt):
  currentSpeed = dot(vel, wishDir)
  addSpeed = wishSpeed - currentSpeed
  if addSpeed <= 0: return vel
  accelSpeed = min(accel * dt * wishSpeed, addSpeed)
  return vel + wishDir * accelSpeed
```
- In the air, cap `wishSpeed` at about 30 units for the `addSpeed` check, but use the full `airAccelerate` (about 150, tunable). This is what makes holding A/D while turning the mouse gain speed.

**Ground movement:**
- standard friction + accelerate
- jump when grounded (allow holding jump to auto-hop)

**Surfing:**
- Any contact surface whose normal has `y < 0.7` (steeper than ~45°) is **surfable**: the player is NOT grounded, gets no friction, and velocity is clipped against the plane:
  ```
  clipVelocity(vel, normal, overbounce = 1.0):
    backoff = dot(vel, normal) * overbounce
    return vel - normal * backoff
  ```
- Gravity keeps pulling the player down the ramp. Strafing into the ramp keeps them on it.
- Surfaces with `normal.y >= 0.7` are floors.

**Collision:**
- Player is a capsule (in game units: about 32 wide, 72 tall).
- Use three-mesh-bvh `shapecast` against course geometry.
- Resolve penetration, gather contact normals, and clip velocity against each one, iterating up to 4 times per tick so corners don't trap the player.
- Prevent tunnelling at high speed by sub-stepping when `speed * dt` exceeds half the capsule radius.

**Starting constants** (Source-like units; scale rendering so 1 unit ≈ 2 cm). Put all of these in `constants.ts` and expose them in the dev tuning panel:
- gravity 800
- maxSpeed (ground) 260
- accelerate 10
- airAccelerate 150
- airWishSpeedCap 30
- friction 4
- jumpImpulse 290
- maxVelocity 3500

**Controls:**
- WASD, mouse look (Pointer Lock API), Space jump, R reset to last checkpoint, Shift+R restart run, Esc pause menu
- Raw mouse input where supported (`requestPointerLock({ unadjustedMovement: true })` with a fallback)
- Sensitivity slider and invert-Y option

**Tests:** Write vitest tests proving:
- (a) strafing in the air while turning increases horizontal speed
- (b) holding W alone in the air does NOT gain speed
- (c) the player slides along a 60° ramp without stopping or sticking
- (d) friction applies only when grounded

## 4. Courses

Course spec (zod schema, also used as the OpenAI JSON schema):
```ts
Course = {
  name: string, theme: "neon" | "desert" | "ice" | "lava" | "void",
  difficulty: "easy" | "medium" | "hard",
  segments: Array<
    | { type: "ramp", length: number, angle: number /*45-70*/, side: "left"|"right"|"both", curve: number /*-45..45 deg*/ }
    | { type: "drop", height: number }
    | { type: "gap", length: number }
    | { type: "booster", strength: number }
    | { type: "checkpoint" }
  >
}
```

- **`builder.ts`** turns a spec into geometry *deterministically*:
  - Walk a "track cursor" forward, placing segments.
  - Ramps are triangular prisms (surfable sides).
  - Insert a checkpoint platform every few segments automatically.
  - Add a start zone, finish zone, and kill/reset planes below the course.
- **`validator.ts`** clamps every value to safe ranges and enforces playability rules:
  - max gap length relative to expected speed
  - no two drops in a row
  - total length within limits
  - Always repair bad output; never crash on it.
- **Hand-made courses:** Ship 3 in `courses/*.json`. Tune them yourself in-engine.
  - **"Tutorial"**: teaches surfing step by step with on-screen prompts
  - **"Easy Cruise"**
  - **"Speed Demon"**
- **Visuals:** Each theme gets its own skybox color/gradient, fog, ramp material (simple shader with grid lines so speed is readable), and accent color.
  - Stylized and clean, not realistic; it must run at 60 fps on integrated graphics.
  - Use instanced/merged geometry.

## 5. Single-player race loop (playable before any networking)

- **State machine:** menu → loading → countdown (3-2-1) → racing → results.
- **HUD:**
  - big speedometer (units/sec)
  - run timer
  - checkpoint splits with +/- vs. personal best (green/red)
  - small minimap or progress bar
- **Ghosts:**
  - Record your run as compressed samples (position + yaw at 20 Hz) and replay your personal best as a ghost.
  - Ship a "dev ghost" for each hand-made course, recorded by me during testing, so a solo judge always has someone to race.
- **Results screen:** final time, splits, top speed, rank, and **Race again** / **Back to menu** buttons.

## 6. Multiplayer rooms

- **Create room** generates a 4-letter code and a share URL (`/?room=ABCD`). **Join room** takes a code.
- Supabase Realtime channel per room:
  - **Presence** for the player list (name + color)
  - **Broadcast** for state (position, velocity, yaw) at 20 Hz
  - Render remote players with ~100 ms interpolation buffer and simple extrapolation on packet loss.
- **Host** = first player in the room.
  - The host picks the course (hand-made, AI-generated, or by share code) and starts the race.
  - Everyone gets a synchronized countdown: broadcast a start timestamp; clients align using `Date.now()` offset estimated from a ping exchange.
- **Room lobby:** player list, ready toggles, course preview card, host controls.
- **Live race UI:** player names above ghosts, live position ranking in the HUD, and finish feed ("Alex finished — 1:02.48").
- **Results:** a shared results table, then return to lobby for a rematch.
- **Edge cases** (handle all of these, with clear UI messages):
  - host leaves → promote next player
  - player joins mid-race → spectates until next race
  - room full (max 8)
  - invalid code
  - tab hidden or disconnect
- **Solo-judge support:** On the lobby screen, show "**Open a second tab to test multiplayer**" (copies the room link) and a "**Race the dev ghost**" fallback.

## 7. AI Course Generator (OpenAI)

- **Endpoint:** `POST /api/generate-course` with `{ prompt: string }`.
  - Prompt length ≤ 200 chars.
  - Rate limit per IP (simple in-memory or Supabase-backed counter).
  - 15 s timeout.
- **The OpenAI call:**
  - Call the OpenAI API with Structured Outputs using the Course JSON schema.
  - The system prompt explains segment types, safe ranges, and that courses must be fun and beatable.
  - Then run zod + `validator.ts` on the response.
- **Storage:** Store the course in Supabase (`courses` table: id, short share code, prompt, spec JSON, created_at) and return the code.
- **UI:**
  - prompt box with 4–5 clickable example prompts
  - fun loading state ("Pouring the ramps…")
  - course preview flyover camera before the race
  - **Regenerate** button
  - **Share code** button
- **Failure handling:** If generation fails or times out, show a friendly message and offer a random procedurally generated course instead. **The game must never dead-end.**

## 8. Leaderboards

- **Table:** `runs (id, course_id, player_name, time_ms, checkpoint_splits int[], ghost bytea/text, created_at)`
- **Write path:** Submit runs through `/api/submit-run`, which does basic sanity checks:
  - time ≥ a minimum per course
  - splits monotonic
  - name filtered/limited to 16 chars
- **Read path:** read leaderboards client-side.
- **RLS:**
  - read-only for anon
  - inserts only via the service role in the API route
- **UI:** Top 10 per course on the results screen and in the course select. Clicking an entry lets you race that player's ghost.

## 9. Polish (25% of the score — treat it seriously)

- **First 60 seconds:**
  - Landing screen shows the title, one-line pitch, an animated background (camera surfing a course), and three big buttons: **Play Tutorial**, **Quick Race**, **Multiplayer**.
  - The first-time-player flag is held in memory/localStorage with try/catch, and points to the tutorial.
- **Tutorial:** Contextual prompts teach surfing in under 90 seconds: "Hold **D** and move your mouse **right** to stay on the ramp." Detect success before advancing.
- **Device handling:**
  - **Trackpad / low-skill friendliness:** an "**Assist mode**" toggle that slightly boosts air acceleration and auto-stabilizes on ramps, with a badge on leaderboard times.
  - **Mobile/touch:** a clear "best on desktop with a mouse" screen, plus a view-only spectate or course-preview mode.
- **Settings:** sensitivity, FOV, volume, assist mode, graphics quality (low/high), keybind display.
- **Audio:** wind/whoosh that rises with speed, checkpoint chime, countdown beeps, finish fanfare. Generate with Web Audio or use CC0 sounds and credit them.
- **Game feel:** FOV widens slightly with speed, speed lines at high velocity, subtle camera roll when strafing, particle burst at checkpoints.
- **Robustness:**
  - loading states everywhere
  - no console errors
  - handles window resize and tab switching (pause solo runs)
  - pointer-lock loss shows the pause menu
- **Accessibility basics:** readable HUD contrast, a colorblind-safe palette for split colors (use +/- symbols, not just green/red).

## 10. Deploy & submission assets

- Deploy to Vercel and add the Supabase migrations.
- Write a README with:
  - setup steps
  - controls
  - architecture diagram (Mermaid)
  - a clear note that course generation uses the OpenAI API
- Add a hidden `/?capture=cover` mode that renders a dramatic 1600×900 shot (player mid-surf on a lava course, title overlay) so I can screenshot it for the **cover image**.
- Draft a **project description** (~150 words) for the Handshake submission, covering: what it is, how to play, the multiplayer + OpenAI course-generator twist, and the tech stack.

## Phases (stop after each one for my playtest)

| Phase | Deliverable | Target date |
|---|---|---|
| 0 | Repo scaffold, Vite/TS/Three running, fixed-timestep loop, pointer lock, dev tuning panel | Oct 5 |
| 1 | **Movement physics + tests** on a single test ramp. I must say "this feels like surf" before moving on. | Oct 8 |
| 2 | Course schema, builder, validator, 3 hand-made courses, themes | Oct 11 |
| 3 | Single-player race loop: HUD, checkpoints, timer, results, personal-best ghost | Oct 13 |
| 4 | Multiplayer rooms (Supabase Realtime), lobby, synchronized races, edge cases | Oct 17 |
| 5 | AI Course Generator via OpenAI + share codes | Oct 20 |
| 6 | Leaderboards + ghost racing from leaderboard | Oct 22 |
| 7 | Polish pass (section 9), tutorial, audio, settings, assist mode | Oct 26 |
| 8 | Deploy, cover-image mode, README, submission description, final bug bash | Oct 28 (2 days of buffer) |

**Ground rules:**
- Keep the physics pure and tested.
- Prefer simple, working, and polished over ambitious and broken.
- If a phase is running long, tell me what you'd cut.
- Ask me before adding any dependency not listed above.
- Never commit secrets.
