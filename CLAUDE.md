# Surf Duel — notes for Claude

Contest entry (Handshake AI Skills Studio x OpenAI Multiplayer Game Challenge, deadline Oct 30 2026 11:59 PM PT). Full spec and phase plan: [docs/SPEC.md](docs/SPEC.md).

**Resuming work? Read [docs/HANDOFF.md](docs/HANDOFF.md) first:** current state, open items, IDs, and tooling gotchas on this machine.

## Ground rules (from the user)
- Work phase by phase. Stop at the end of each phase, give exact test steps, wait for go-ahead. Commit after each phase.
- Keep physics pure and unit-tested (vitest). Physics functions take `PhysicsParams`; only the game layer reads the live `physics` object.
- Ask before adding any dependency not listed in the spec. Never commit secrets (`.env*` is gitignored except `.env.example`).
- Prefer simple, working, polished over ambitious and broken. If a phase runs long, say what to cut.

## Imports (deploy rule)
- Every relative import names its file: `./foo.js` (for foo.ts), `./courses/index.js`; JSON imports use `with { type: 'json' }`. Vercel compiles api/ functions file by file under Node ESM, and anything else crashes them at runtime. `npm run check:api` verifies it (Vite/Vitest/tsc don't care either way).

## Commits
- Write commit messages via the Bash tool (heredoc → `git commit -F -`). Windows PowerShell 5.1 prepends a UTF-8 BOM when piping text to git, and mangles messages containing double quotes when passed as arguments.

## Conventions
- Units: Source-like, 1 unit ≈ 2 cm, **Y up**. Yaw 0 looks down −Z; positive yaw turns left.
- Sim runs at 100 Hz fixed timestep (`src/game/loop.ts`); render interpolates. Mouse look is applied per frame.
- Keys tracked by `KeyboardEvent.code`.
- localStorage is always wrapped in try/catch; stored data is validated with zod.
- Player `pos` is the capsule's bottom (feet); camera = feet + `EYE_HEIGHT`.
- Collision resolves the deepest contact first (prevents seam "rampbug"); keep it that way when touching `collision.ts`.

## Course layout invariants (keep `playability.test.ts` green when touching `src/course/`)
- Every spec goes through `validateCourse` (repairs, never throws) before `planCourse`/`buildCourse`.
- A cautious rider (speed model `lo`) must arrive above the next ramp's **ridge** + clearance; alternating-side transitions add `SLIDE_TOLERANCE·(tanθprev + tanθnext)` because sliding down one face moves you toward the next ridge.
- Ramps after pads tuck under the pad (no gap to fall through). Ramps stay straight through the fast rider's landing zone, then curve.
- Checkpoints are fly-through gates (user decision, Oct 4 2026 — no landing pads). Respawns put you on the next ramp's face at the cautious speed `lo`; tests restart from every checkpoint.
- Ramp angles are capped at 60° (user: hard-mode 64–70° ramps were "much too steep"); difficulty comes from speed, curves, drops, narrower faces and sideways transfers instead.
- **Four difficulties: easy, medium, hard, expert** (user, Oct 6 2026: the old hard maps were easy, and they must need real skill).
  - **Easy and medium** are guaranteed for the *cautious* bot, which never air-strafes.
  - **Hard and expert** have sideways transfers: `transferReach` and `transferAirTime` in `tuning.ts`.
    - Each ramp shifts toward the side you fly off.
    - The shift is a fraction of what a perfect air-strafe covers in the flight: `AIR_STRAFE_REACH·t²`, capped by `v·t/2` for slow riders.
    - It's never less than what makes a straight flight miss the face. Drops deepen to give the air time.
  - `playability.test.ts` requires two things on every hard and expert course: the *skilled* bot (`BotStyle.airStrafe`) finishes from the start and every checkpoint, **and** the cautious bot dies.
  - `SurfBot` air-strafes by default on hard and expert, for ghosts, the cover shot and runCheck.
  - Checkpoint spacing comes from the difficulty: 3, 3, 4, 5 ramps.
- The finish pad is lengthened to the fastest rider's landing (fast riders used to fly clean over it).
- **Not everything goes downhill.** User, Oct 6 2026: Expert "isn't very hard because of how fast you can get, and because it is downhill".
  - Each ramp may carry its own `pitch`: degrees downhill along its length, 0 level, negative climbs. Without one it takes the difficulty's default; Expert's default is 6°.
  - **Level ramps and climbs are for hard and expert only.** On easy and medium the validator gives any ramp under `MIN_CRUISE_PITCH` its usual slope back: a cautious rider sheds ~12% of its speed landing and steering on a level ramp, the speed model doesn't count that, and on an AI medium course the bot fell short of a climb and hit its end (Oct 8 2026).
  - `limitBySpeed` in the validator gives a ramp its usual slope back when a cautious rider would only crawl along it (below `MIN_CRUISE_SPEED`).
  - It also eases climbs so the cautious rider still has `MIN_CLIMB_SPEED` at the top. Respawns ride at that cautious speed.
  - The layout stretches short ramps to catch fast riders (a 1,750 climb became 7,263). `placeRamp` eases a stretched climb the same way, over its real length; it once stopped the modelled rider dead and crashed the layout. Transfers also never assume a rider slower than walking pace.
  - `builder.test.ts` lays out 300 seeded AI-shaped courses (`aiShapedCourses.ts`: walls, spirals, steep climbs, big boosters, every difficulty) and they must all build with finite geometry.
- **Walls and spirals** (hand-made first; the AI got them on Oct 8 2026, user: "give the AI walls and spirals now").
  - **`wall`**: stands across the next ramp, past the fastest rider's landing plus `WALL_SETTLE`. Its window spans `windowSlack` either side of the riding line (520, 460, 260, 200 by difficulty). Off the line, you hit it. Easy and medium are wide because a rider who doesn't air-strafe settles ~400 off the line at 3,000+ u/s; air-strafers hold the line.
  - **`spiral`**: one full turn of ramps round a tower, radius `SPIRAL_RADIUS` (5600, kept wide for the flyover camera).
    - Its ramps are nearly level (`SPIRAL_PITCH_DEG`), and you hold toward the tower.
    - Its gaps shrink to what its slowest rider can cross.
    - It drops at least a ramp's height plus `SPIRAL_CLEARANCE` before passing under its own start.
    - A rider who doesn't air-strafe can't hold its turn much above ~2,500 u/s and slides off the outside: late in a long, fast course a spiral may need moving earlier (see `ensureBeatable`).
  - The tower and the walls are solid; they go in the collision mesh, under `visuals.obstacles`.
- **Every AI course is ridden before it's served** (`ensureBeatable`, `src/course/verify.ts`; server only, ~1 s, never in `validateCourse`). The layout's guarantees are proven for shipped and random courses, but the AI can combine anything in range: of 64 uniformly random AI-shaped courses, a sixth failed even without walls or spirals.
  - The bots for the difficulty ride it from the start and every checkpoint. It must finish without deaths, in under `LONGEST_RIDE_SECONDS` (120): a slow course is a dull one.
  - On failure it simplifies step by step: tame values to the random courses' ranges, rein in drops and boosters, then the first of: walls removed, spiral moved to the start, both, spiral removed, walls and spiral removed. If nothing works, the server answers `ai-failed` and the player is offered a random course.
  - `playability.test.ts` rides 8 AI-shaped courses per difficulty *as served*. Most must keep their walls and spiral, and at most 2 Hard or Expert ones may come out survivable without air-strafing.
- A spiral passes over itself, so a respawn finds its place with `TrackPath.relocate`, which uses true distance. The HUD's checkpoint marks do the same. Never search horizontally from the start: that can match the wrong level of a spiral.
- Ramp colour is semantic: `rampRight` = ramp on your right (hold D), `rampLeft` = hold A.
- The bot (`course/bot.ts`) faces the *local* track heading (looking ahead on curves makes its strafe brake) and surfs whichever face it's actually on.

## Race loop
- App states: menu → loading → countdown → racing → results; `paused` is orthogonal (countdown/racing only). Anything time-based in a race (results delay, GO flash) counts simulation ticks, never wall-clock, so pausing holds it.
- Race time = racing ticks × 10 ms (`RaceSession`), identical in the game and `simulateRun` — the bot ghost and an identical human run finish on the same tick.
- Bump `LAYOUT_VERSION` in `course/courseKey.ts` whenever the layout/builder changes the geometry a spec produces; that retires stale PBs and dev ghosts.
- `vite.config.ts` is excluded from `tsc` (it needs Node types; `@types/node` isn't approved yet — ask before adding it for the Phase 5 `/api` functions).

## Multiplayer
- Supabase project: **surf-duel** (`olpbsvuyawxgybutkswf`, us-east-1, org "listenwell", $10/month, user-approved Oct 4 2026). It replaced "soonavi's Project", which turned out to be a live app with real users: never put game tables or keys there. Migrations live in `supabase/migrations/`; apply new ones to surf-duel only.
- Realtime quotas count every delivered copy (Pro: 500 msg/s, 50 presence msg/s per project). Keep `batchInterval` budgeting; never send per-tick.
- Supabase delivers a joiner's own presence ~1 s before existing members: `Room.connect` waits (`joinSettleMs`) before deciding "not found", picking a colour or stamping `joinedAt`. `MemoryHub(existingMembersDelayMs)` reproduces this in tests.
- Shared races never pause: the loop keeps simulating with the mouse released; `FixedStepLoop.droppedTime` (hidden tab) is charged to the race clock.
- Test multiplayer alone in the browser pane with an iframe of `/?room=CODE` (a separate app instance) and drive both apps' `loop.frame(performance.now())`.
- Never link `node_modules` into a temporary git worktree: `git worktree remove --force` follows the junction and empties the real one (Oct 8 2026; `npm ci` restored it).

## Server (Phase 5)
- `api/*.ts` are Vercel functions with the web signature (`export function POST(request: Request)`); logic lives in `server/` with injected deps so it's unit-tested. `npm run dev` runs them through the `devApi()` middleware in `vite.config.ts`.
- `tsconfig.node.json` typechecks `api/`, `server/` and `vite.config.ts` with Node types (`@types/node`, approved Oct 4 2026); `npm run typecheck` runs both configs.
- Server env: `OPENAI_API_KEY`, `OPENAI_MODEL`, `SUPABASE_SERVICE_ROLE_KEY`, plus `VITE_SUPABASE_URL` (public). Never import `server/` from `src/`.
- **Money (user, Oct 5 2026): "no chance of me being billed any more."** OpenAI runs on $5 of prepaid credit with auto-recharge off, model `gpt-5.4-nano`. `BUDGET` in `server/generateCourse.ts` (150/day, 1,800 lifetime, 1,500 output tokens per call) keeps the worst case under $5; the database enforces it atomically (`claim_generation`) and the server fails closed if it can't claim. Never add a path that calls OpenAI without a successful claim, never add retries, and re-check `BUDGET` (there's a test with the prices) before changing the model.
- **Malicious prompts (user, Oct 5 2026: "ensure that nothing malicious can be injected").** Layers, all tested: `preparePrompt` (clean, drop markup chars, refuse links/blocked words: before the claim), the free OpenAI moderation check (`server/openaiModerator.ts`, after the claim so it's rate-limited; plain `violence` is allowed, everything else flagged refuses; fails closed), the prompt sent as a JSON string, Structured Outputs, `validateCourse`, and the course name checked by the validator (`cleanName`) and moderated. Any new player-visible text (leaderboard names!) goes through `cleanName`/`sanitizeName`. Render user text with `textContent` only.
- Course share codes: 6 chars `[A-HJ-NP-Z2-9]` (`course/shareCode.ts`, enforced by a DB check). Room codes stay 4 letters.
- **AI ramps carry a `pitch`.** Strict mode has no optional properties, so it's `["integer", "null"]`, and null means the usual slope. The prompt asks for mostly level ramps with boosters on Expert, and downhill only on Easy and Medium.
- **The AI replies in sections** (Oct 8 2026): each has a `ramp` or a `spiral` (the other null), a `wall` flag (a wall across that ramp), and `then`, up to `AI_MAX_PIECES` drops, gaps, boosters or checkpoints. Asked in words for 14–18 ramps, gpt-5.4-nano gave 7–11.
  - `courseJsonSchema(difficulty)` sets the sections' `minItems`/`maxItems` from `DIFFICULTY_STYLE.ramps`, and strict mode enforces them.
  - `courseFromAi` (called in `openaiDesigner`) lays the sections end to end into segments, the wall just before its ramp. The schema has no `difficulty`: the player picked it.
  - One section shape, with no `$ref`. With two shapes sharing the pieces through `$defs`, the model stopped using drops, gaps and boosters entirely.
  - The request line asks Hard and Expert for "a spiral and 2–4 walls" (the system prompt alone was skipped). Others get them when the description wants to go round or through something.
  - The model still sometimes leaves every section's pieces empty; such courses are ramp-to-ramp but fine.
  - Measured live: Easy and Medium 34–74 s, Hard and Expert 60–90 s; ~1,490 input tokens, 520–800 output tokens, 5–7 s per request including ~1 s of riding.
- **Course colours** (user, Oct 2026: an "all pink" AI course came out as the Neon theme).
  - A course may carry `colors: { sky, ramp, ramp2 }` ("#rrggbb"). The AI sets them when the player names colours or a colourful place.
  - `render/palette.ts` `courseTheme(course)` derives the whole look with readability rules: grid lines contrast with their surface, the A/D colours show on dark panels, and gates stand out against the sky. Always use `courseTheme`/`themeLabel`, never `THEME_DEFS[course.theme]`, for a course's colours.
  - The validator keeps `ramp` and `ramp2` at least `MIN_RAMP_CONTRAST` apart (by lightness, which colour-blind players can tell apart), and leaves the key out when there are no colours, so older courses keep their keys.
- **The input-token estimate is nearly full:** `generateCourse.test.ts` checks characters ÷ 3, now ~2,420 of `BUDGET.maxInputTokens` 2,500 (real calls use ~1,490). Schema descriptions only say what the prompt doesn't. Trim wording before adding anything to the prompt or schema; don't raise the budget without re-checking the $5 maths.
- **Likes and the Popular list** (Oct 8 2026, migration `20261008120000_course_likes.sql`).
  - `course_likes` (who liked what, service role only) and `courses.likes` (the count, publicly readable). Only `like_course()`, via `/api/like-course` (`server/likeCourse.ts`), writes them, in one locked step.
  - One like per `Profile.boardId` per course, undoable. Player ids are cheap to fake, so at most `perIpCourse` (3) players on one network can like the same course, plus a per-network rate limit.
  - The home screen's Popular list reads `courses` by likes, then newest. Clicking one loads it as the custom course right there.
  - `LikedCourses` (localStorage `surfduel.likes.v1`) only remembers the button state; the server holds the count. The 👍 shows on the preview and results screens of any course with a share code.
- **The player picks the difficulty** of an AI course (generator chips). The request carries `difficulty` (old clients default to medium). The model is told it in the user message, and the server overwrites the reply's difficulty with it before validating. A random fallback course uses the picked difficulty too, and travels to rooms as `{ kind: 'random', seed, difficulty }`.
- Test rows TESTQA and DWLU69 were deleted from `courses` on Oct 6 2026 (user-approved) before launch.

## Audio (Phase 7)
- `src/audio/music.ts` (composition) and `levels.ts` (mix, intensity, equalizer math) are pure and tested; `engine.ts` is the thin Web Audio layer. No sound files or audio dependencies: keep it that way unless the user says otherwise.
- Audio only starts on a user gesture (`AudioEngine.unlock`, wired to the first pointerdown/keydown). Every engine call is a no-op before that.
- Levels live in `busGains` (levels.ts). User, Oct 2026: the music was "MUCH too loud", so it's trimmed ~10 dB under the countdown beep's measured level (in Chrome, not by ear). Later the effects were "a little too loud", so `SFX_TRIM` dropped ~3 dB (0.7 → 0.5). The speed wind is gone (user, Oct 6 2026: "take out the wind sound"); don't bring it back, even though SPEC.md lists it. Don't test audio in the browser pane while the user listens, and close its tab afterwards: they hear it too. `applySettings` runs on every step of a slider drag, so engine setters must be cheap and idempotent: never restart the music clock unless the source actually changes (`engine.test.ts` checks the tempo holds).
- The player's own music file is decoded (`decodeAudioData`) and played as a looping AudioBufferSourceNode inside the graph; it's never uploaded or persisted between visits. **Never play it through an `<audio>` element.** Extensions such as the user's "Audio Equalizer" patch `HTMLAudioElement.prototype.play` and call `createMediaElementSource` in their own AudioContext. Firefox allows that second capture, so the song played a second time at full volume, untouched by the music slider (user, Oct 6 2026: "almost painfully loud"). Files over `MAX_MUSIC_FILE_MB` are refused (decoded audio is ~23 MB a minute).
- Every open game window has its own AudioEngine. Settings sync across windows through the `storage` event (`settingsFromOtherWindow`); a synced change is applied with `applySettings(false)` (never re-saved).
- `BEAT_PULSE` (render/materials.ts) is one shared uniform object for every course material; respect `prefers-reduced-motion` (pulse, equalizers, FOV/roll changes off).
- Assist mode (`game/assist.ts`) must never raise `maxVelocity`: the leaderboard's `runCheck` assumes the default cap for every run.

## Flyover camera
- `render/flyover.ts` follows a smoothed line (height: running max then blur; horizontal: blur), never the raw riding line: the raw line drops near-vertically and zigzags (user, Oct 5 2026: transitions must be smooth). Keep `flyover.test.ts` green: it bounds glide angle, acceleration, turn rate and pitch rate on every course. The glide bound is 0.6, or 1.7× the course's own average descent on steeper (hard) courses. Minute-long courses (100k+ units) get up to 45 s of flyover (`MAX_DURATION_S`); otherwise the camera races round their curves and spirals. The loop seam fades through dark (`flyoverFade`, the `.scene-fade` div).
- Theme `rampRight.ui` / `rampLeft.ui` are the ramp colours for UI (A/D keys, coach); `line` can be dark on light-surfaced themes.

## Leaderboards (Phase 6)
- `runs` holds one row per (course_key, player_id): the player's best, with its ghost. Anon can read only id, course_key, player_name, time_ms, checkpoint_splits, ghost, updated_at (column grants), never player_id/ip_hash. Writes only via `submit_run` (service role) from `/api/submit-run`.
- The server rebuilds the course from its own copy (shipped JSON, or `courses.spec` by share code) and computes the key; `checkRun` (`src/course/runCheck.ts`) must pass. If you change physics limits (maxVelocity) or ghost sampling, re-check `runCheck` (its tests ride real bot runs). Leaderboard runs must hit every checkpoint.
- `Profile.boardId` (localStorage `surfduel.player.v1`) is the leaderboard identity; `Profile.id` stays per page load for rooms.
- Deploy check (Phase 8): `api/submit-run.ts` imports the shipped course JSON through `src/course/courses`; make sure Vercel's function bundling handles JSON and extensionless imports (it already must for `api/generate-course.ts`).
- When testing, delete test rows from `runs` afterwards (the board is public).

## Notes for upcoming phases
- Tutorial coach (`game/tutorialCoach.ts`): user feedback Oct 4 2026 — prompts switched "too fast"; must be "much slower and digestible". So: one lesson per ramp, changed only once settled on a new ramp and after `readingTicks(text)`; live key feedback goes in the hint line, never the lesson; events are notes. Keep lessons short. Tests: every lesson ≥ 3.5 s in a bot run, and a student pressing only what the coach shows must finish with no falls. The Tutorial's last two ramps are 9000 long (booster 200) to give the last lesson reading time.
- `randomCourse(seed)` is the Phase 5 fallback when AI generation fails; `SurfBot` can drive the Phase 7 attract-mode camera.

## Phase status
- [x] Phase 0 — scaffold, fixed-timestep loop, pointer lock, dev tuning panel
- [x] Phase 1 — movement physics + tests on a test ramp (user: "this feels like surf")
- [x] Phase 2 — course schema, builder, validator, 3 courses, themes
- [x] Phase 3 — single-player race loop (dev ghosts: only speed-demon.json has arrived; tutorial / easy-cruise still use the bot)
- [x] Phase 4 — multiplayer rooms (user: "the 2 player works")
- [x] Phase 5 — AI course generator (verified live with gpt-5.4-nano: ~2–7 s, ~$0.0005 per course; user moved on to Phase 6 on Oct 5 2026)
- [x] Phase 6 — leaderboards (user moved on to Phase 7 on Oct 5 2026). Also done before it: home screen redesign, prompt-injection hardening.
- [~] Phase 7 — polish: music (user chose options 1 + 4: generated soundtrack and your own file), effects, equalizers, settings screen, game feel, assist mode, view-only mode for touch devices (built Oct 5–6 2026; awaiting user playtest)
- [x] Phase 8 — deploy + submission assets (verified live Oct 6 2026: AI generation, share links, leaderboard API with the user's keys): api/ made ESM-safe (check:api), /?capture=cover (P saves the PNG), README with Mermaid architecture, docs/SUBMISSION.md (145-word description). Deployed Oct 6 2026: https://surf-duel-dun.vercel.app (Vercel project surf-duel in soonavi's projects, from github.com/soonavi/surf-duel, public repo). The secret env vars (OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY) are added by the user in the Vercel dashboard, never by Claude.
