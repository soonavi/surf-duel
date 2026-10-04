# Surf Duel — notes for Claude

Contest entry (Handshake AI Skills Studio x OpenAI Multiplayer Game Challenge, deadline Oct 30 2026 11:59 PM PT). Full spec and phase plan: [docs/SPEC.md](docs/SPEC.md).

## Ground rules (from the user)
- Work phase by phase. Stop at the end of each phase, give exact test steps, wait for go-ahead. Commit after each phase.
- Keep physics pure and unit-tested (vitest). Physics functions take `PhysicsParams`; only the game layer reads the live `physics` object.
- Ask before adding any dependency not listed in the spec. Never commit secrets (`.env*` is gitignored except `.env.example`).
- Prefer simple, working, polished over ambitious and broken. If a phase runs long, say what to cut.

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
- Course share codes: 6 chars `[A-HJ-NP-Z2-9]` (`course/shareCode.ts`, enforced by a DB check). Room codes stay 4 letters.
- The `courses` table holds a test row `TESTQA` for checking share links without OpenAI; delete it before submission.

## Notes for upcoming phases
- Tutorial coach (`game/tutorialCoach.ts`, pulled forward from Phase 7 at the user's request): lessons keyed to layout pieces + held keys, notes for events. Notes never replace the lesson (checkpoint gates sit where you switch keys). Its side logic must match the bot's (whichever face you're on) — the bot-run test asserts no warnings and every lesson in order.
- `randomCourse(seed)` is the Phase 5 fallback when AI generation fails; `SurfBot` can drive the Phase 7 attract-mode camera.

## Phase status
- [x] Phase 0 — scaffold, fixed-timestep loop, pointer lock, dev tuning panel
- [x] Phase 1 — movement physics + tests on a test ramp (user: "this feels like surf")
- [x] Phase 2 — course schema, builder, validator, 3 courses, themes
- [x] Phase 3 — single-player race loop (dev ghosts: only speed-demon.json has arrived; tutorial / easy-cruise still use the bot)
- [x] Phase 4 — multiplayer rooms (user: "the 2 player works")
- [~] Phase 5 — AI course generator (built; live OpenAI call untested until the user adds OPENAI_API_KEY / OPENAI_MODEL / SUPABASE_SERVICE_ROLE_KEY to .env.local)
- [ ] Phase 6 — leaderboards
- [ ] Phase 7 — polish
- [ ] Phase 8 — deploy + submission assets
