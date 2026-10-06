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
- Ramp angles are capped at 60° (user: hard-mode 64–70° ramps were "much too steep"); difficulty comes from speed, curves, drops and narrower faces instead.
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

## Server (Phase 5)
- `api/*.ts` are Vercel functions with the web signature (`export function POST(request: Request)`); logic lives in `server/` with injected deps so it's unit-tested. `npm run dev` runs them through the `devApi()` middleware in `vite.config.ts`.
- `tsconfig.node.json` typechecks `api/`, `server/` and `vite.config.ts` with Node types (`@types/node`, approved Oct 4 2026); `npm run typecheck` runs both configs.
- Server env: `OPENAI_API_KEY`, `OPENAI_MODEL`, `SUPABASE_SERVICE_ROLE_KEY`, plus `VITE_SUPABASE_URL` (public). Never import `server/` from `src/`.
- **Money (user, Oct 5 2026): "no chance of me being billed any more."** OpenAI runs on $5 of prepaid credit with auto-recharge off, model `gpt-5.4-nano`. `BUDGET` in `server/generateCourse.ts` (150/day, 1,800 lifetime, 1,500 output tokens per call) keeps the worst case under $5; the database enforces it atomically (`claim_generation`) and the server fails closed if it can't claim. Never add a path that calls OpenAI without a successful claim, never add retries, and re-check `BUDGET` (there's a test with the prices) before changing the model.
- **Malicious prompts (user, Oct 5 2026: "ensure that nothing malicious can be injected").** Layers, all tested: `preparePrompt` (clean, drop markup chars, refuse links/blocked words: before the claim), the free OpenAI moderation check (`server/openaiModerator.ts`, after the claim so it's rate-limited; plain `violence` is allowed, everything else flagged refuses; fails closed), the prompt sent as a JSON string, Structured Outputs, `validateCourse`, and the course name checked by the validator (`cleanName`) and moderated. Any new player-visible text (leaderboard names!) goes through `cleanName`/`sanitizeName`. Render user text with `textContent` only.
- Course share codes: 6 chars `[A-HJ-NP-Z2-9]` (`course/shareCode.ts`, enforced by a DB check). Room codes stay 4 letters.
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
- `render/flyover.ts` follows a smoothed line (height: running max then blur; horizontal: blur), never the raw riding line: the raw line drops near-vertically and zigzags (user, Oct 5 2026: transitions must be smooth). Keep `flyover.test.ts` green: it bounds glide angle, acceleration, turn rate and pitch rate on every course. The loop seam fades through dark (`flyoverFade`, the `.scene-fade` div).
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
