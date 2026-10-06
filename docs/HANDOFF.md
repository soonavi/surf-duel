# Handoff: where Surf Duel stands

Written Oct 6 2026, when the user paused work. Read this first, then [CLAUDE.md](../CLAUDE.md) (rules, conventions, money and security constraints) and, if needed, [SPEC.md](SPEC.md).

## In one paragraph

Surf Duel is a browser first-person surf racing game, entered in the Handshake AI Skills Studio x OpenAI Multiplayer Game Challenge (**deadline Oct 30 2026, 11:59 PM PT**). All eight phases of the spec are built. It's deployed at https://surf-duel-dun.vercel.app from the public repo https://github.com/soonavi/surf-duel. Every push to `main` deploys to production automatically. The working tree is clean, and everything is pushed and live. The last commit was `b089bee` (audio fixes), deployed as `dpl_JAPNtv6uTEDzEyUjYttogJgcett1`, READY.

## What happened last

The user reported three problems:
- the music was "MUCH too loud";
- the music volume controls "don't work";
- the equalizer "glitching" before any music file was uploaded.

All three were fixed in `b089bee`, test-first. Tests: 426 passing.

- **Volume slider:** `App.applySettings` runs on every step of a slider drag and called `AudioEngine.setSource`, which restarted the music clock each time. Notes were crammed together or scheduled early, so dragging made the music jumble instead of quieten. `setSource` is now a no-op when the source is unchanged. `src/audio/engine.test.ts` (a fake Web Audio context) checks the tempo holds during a drag.
- **"My music" with no file:** every settings change opened the file picker. Now only choosing "My music" does (`wantsMusicFile` in `src/game/settings.ts`).
- **Loudness:** levels moved into `busGains` (`src/audio/levels.ts`). The music is ~10 dB under the effects. At default settings, Chrome measured the music output at RMS ≈0.026 (was 0.08). A music file is trimmed to match. The analyser tap sits before the volume and trims, so the visuals are independent of volume.
- **Equalizer:** the FFT went from 256 to 2048. Bars are log-spaced from 40 Hz to 12 kHz with no duplicates (`spectrumBars(data, count, binHz)`), and eased by `settleBars` (fast rise, gentle fall). The analyser's dB window is −65 to −20. The beat pulse was refitted to the new bass band to keep its old look: a steady glow of about 0.65 that swells toward 0.9 on kicks.

**Not yet confirmed by the user:** they haven't heard the fix. Everything was measured, not heard. Ask how it sounds before changing levels again. If it's now too quiet, raise `MUSIC_TRIM` in `levels.ts`; the test caps it at ≈0.063 at the default volume, so adjust the test's intent with the user.

### Follow-up after resuming (Oct 6)

The user then reported:
- their uploaded song was too loud;
- the slider didn't change it;
- "Off" didn't stop the generated music.

**None of this reproduced** in the browser pane, on either the dev build or the live site. The checks went through the real file input, the chips and slider drags:
- the song routed through the volume stage, with gain 0.25 at 100% and 0.01 at 20%;
- "Off" paused the file and stopped the scheduler.

**The real cause was the agent's own browser pane.** The game the agent had opened there for testing kept playing the generated music, hidden, while the user tested in their own browser. So the user heard two copies at once, and "Off" or the slider in their browser couldn't touch the pane's copy: it has its own localStorage. The user spotted it ("claude is playing the music from the site in the app"); the tab was closed. See the first gotcha below.

Along the way, a real defect was fixed: two game windows in the *same* browser didn't follow each other's settings. They now sync through the `storage` event (`settingsFromOtherWindow`, tested, `427e2e7`).

Then, still Oct 6:
- The effects were "a little too loud": `SFX_TRIM` 0.7 → 0.5 (`725131f`).
- The user asked to remove the wind that rose with speed (`d806588`). The wind is probably what they heard as "my song is much too loud and the slider doesn't control it", since it sat on the effects bus.
- **Firefox 157 (the user's default browser) was checked through the real file input on the live site.** The song goes through the volume stage (gain 0.09 at 60%, 0.01 at 20%, 0.25 at 100%), the same as in Chromium.

After the wind went, the user still reported the song "almost painfully loud" and unchanged by the slider. The live deploy was confirmed current.
- A second Firefox test reproduced the user's real conditions: default autoplay settings, real clicks on ⚙ Settings, and a real file selection (`input.setFiles`). The song still went through the volume stage.
- The user's own Firefox profile has no audio or privacy prefs changed. Their Firefox has been open since 09:51, before every audio fix.
- **Leading theory:** an older Surf Duel tab or window, still running pre-fix code with the song loaded. Old code played the file ~11 dB louder, and it doesn't sync settings, so the new tab's slider can't touch it.
- **Root cause (found):** the user's "Audio Equalizer" Firefox extension. It patches `Audio.prototype.play` and captures every played audio element into its own AudioContext, straight to the speakers. Firefox allows a second `createMediaElementSource`. A copy of its hook in the hidden Firefox reproduced it exactly: the extension's copy played at the full source level whatever the slider. **Fixed:** the song is now decoded and played as an AudioBufferSourceNode, with no media element. Verified in Firefox with the hook installed (it's never called; the song follows the slider). `engine.test.ts` covers the routing, pause and resume, bad files and the size cap.

## Phase 9 (user-requested, Oct 6): harder courses, difficulty picker, likes

**Done, awaiting the user's playtest:**
- There are four difficulties: easy, medium, hard and expert.
- Hard and Expert need air-strafing, through sideways transfers sized from the physics. See CLAUDE.md, "Course layout invariants".
- **Research basis:** surf map tiers 1–6+. Hard maps have fewer checkpoints, shorter ramps, transfers that demand speed and air control, and clean landings.
- A skilled bot (`BotStyle.airStrafe`) proves Hard and Expert courses beatable. The cautious bot must die on every one.
- Speed Demon was redesigned as Hard and Event Horizon as Expert. `LAYOUT_VERSION` is now 4, so the old PBs, boards and Speed Demon's dev ghost are retired.
- The AI generator has difficulty chips. The server enforces the player's pick.
- The flyover camera smoothing is wider, and its glide bound now scales with each course's own descent.

**Then (user feedback, Oct 6):** the Hard and Expert courses were "good starter levels". Expert wasn't hard "because of how fast you can get, and because it is downhill". The user wants surfing around or through things (they sent reference shots of a spiral round a tower and a ramp through a wall) and courses of about a minute. They chose "hand-made first": the AI gets towers and walls next round.

Built:
- Per-ramp `pitch`: level and climbing ramps.
- `wall` (a window round the riding line) and `spiral` (one turn round a tower).
- A new Expert course, **Spire**, at about 60 s.
- Speed Demon (about 57 s) and Event Horizon (about 65 s) lengthened and reworked.
- Expert's default pitch lowered to 6.
- AI ramps can climb, and AI Hard and Expert courses ask for 12–20 ramps.
- Random Hard and Expert courses have 10–15 ramps.
- `LAYOUT_VERSION` is now 5.

**Awaiting the user's playtest** of Spire especially.

**Next, queued by the user:** thumbs up on generated courses, and a **Popular** section listing the most-liked ones. Agreed plan:
- one like per player (`Profile.boardId`) per course, which they can undo;
- counted server-side with the service role, like `submit_run`, with an IP-hash rate limit;
- a Popular list on the home screen with one-click play by share code.

The user picked "hard courses first, then likes" (Oct 6).

## Phase status

| Phase | State |
|---|---|
| 0–6 | Done and approved |
| 7: polish | Built. The user has playtested part of it (they found the audio bugs above). No explicit sign-off yet. |
| 8: deploy and submission | Done, verified live Oct 6: AI generation, share links, leaderboard API with the user's keys |

## Open items, in rough priority

1. **The user's ear-test of the audio fix.** Volume slider, race music, start-screen equalizer, in-race HUD equalizer.
2. **Phase 7 sign-off.** Ask whether anything else from the playtest needs fixing.
3. **Submission checklist.** The user does these; the agent can help.
   - Description: copy from `docs/SUBMISSION.md` (145 words).
   - Cover image: open https://surf-duel-dun.vercel.app/?capture=cover and press **P** to download `surf-duel-cover.png` (1600×900).
   - Seed the leaderboards by racing a few courses on the live site, so judges don't see empty boards.
   - Test a two-player room (a second browser window works).
4. **After the contest.** Pause the Supabase project `surf-duel` (`olpbsvuyawxgybutkswf`, $10/month). Keep its spend cap on until then. OpenAI is prepaid ($5, auto-recharge off), so it can't overspend.

**Known gaps, never asked for:**
- There's no separate assist leaderboard (assisted runs only get a badge).
- The player's music file isn't remembered between visits; this is by design, since files are never uploaded.
- The build warns about an >800 kB chunk; this predates the audio work and is harmless.
- At full intensity the music's low-pass opens to 18 kHz. If the user calls it harsh, cap `cutoffHz` in `mixLevels`.

## Accounts and IDs

| What | Value |
|---|---|
| Repo | `C:\Projects\surf-duel`, branch `main`, remote github.com/soonavi/surf-duel (public) |
| Vercel | Project `prj_dPfwvAHWc2dlsW7eGgpAIshcVCo8`, team `team_xrmRFIHuwqPhALTReSrDNewn` ("soonavi's projects"). Production alias surf-duel-dun.vercel.app. |
| Vercel env vars | Public: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENAI_MODEL` (`gpt-5.4-nano`). Secret: `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which **the user** adds in the Vercel dashboard. Never set, read or print secrets; never print `.env.local`. |
| Supabase | `surf-duel` / `olpbsvuyawxgybutkswf`. **Never** touch "soonavi's Project": it's a live app with real users. |

## Working on this machine: things that bit us

- **Close the browser-pane tab when you finish testing anything with sound** (`tabs_close`). The pane keeps playing audio while hidden (`document.hidden` stays false), and the user hears it mixed into their own playtest. That cost a whole round of chasing audio bugs that weren't there.
- **Don't pipe heredocs into `python` or run a bare `cat >` in the Bash tool here.** Both hung for the full two-minute timeout and had to be killed. Edit files with the Write and Edit tools. For long Python patch scripts, Write them to the scratchpad and run `python path/to/script.py`.
- **To test in Firefox, start a hidden one you control.** Use `firefox.exe --headless --no-remote --profile <scratch dir> --remote-debugging-port 9333`, with `user.js` prefs `media.autoplay.default` 0 and `media.autoplay.blocking_policy` 0. Drive it over WebDriver BiDi from a Node script (Node 24 has `WebSocket` built in; `script.evaluate` takes `userActivation: true`). Kill the process afterwards. Keep test sounds inaudible (e.g. a −63 dBFS tone) and start with the music off: its audio reaches the user's speakers.
- **Wrap long commands with `timeout N ... < /dev/null`** (e.g. `timeout 500 npm test < /dev/null`), so nothing waits on stdin.
- **Commit messages go through a Bash heredoc into `git commit -F -`.** PowerShell adds a BOM and mangles quotes. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **The dev server is the `dev` entry in `.claude/launch.json`** (port 5173). After editing files outside the Edit tool, `touch` them: Vite sometimes serves a stale module.
- **The `?dev` URL parameter exposes the app as `window.__surf`**, and does so on production too. Private fields (e.g. `__surf.audio`) are reachable from JS for inspection.
- **When the browser pane is hidden, `requestAnimationFrame` doesn't run.** Drive frames by hand (`__surf.updateSound(1/60)`, `__surf.audio.frame(dt)`).
- **Audio starts only after a click.** Click an empty page area, then measure by connecting an extra `AnalyserNode` to `__surf.audio.musicVolumeNode` or `.sfxBus`.
- **Before deploying changes to `api/` or `server/`, run `npm run check:api`.** Every relative import needs its `.js`, and JSON imports need `with { type: 'json' }`.
- **Full check:** `npm test`, `npm run typecheck`, `npm run build`, `npm run check:api`.
