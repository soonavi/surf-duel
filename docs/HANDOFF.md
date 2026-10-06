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

The one cause that explains all three symptoms is the game open in **two windows**, perhaps from the two-player test. Each window has its own AudioEngine, and settings only applied in the window where they were changed. Fixed: settings now sync across windows via the `storage` event (`settingsFromOtherWindow`, tested), and this was verified with a second instance in a frame.

**Still unconfirmed:** whether the user really had two windows open. If they report the problem again with **one** window, ask:
- which browser (Firefox, Edge, Chrome);
- live site or local;
- the exact click sequence.

Only Chromium has been tested.

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

- **Don't pipe heredocs into `python` or run a bare `cat >` in the Bash tool here.** Both hung for the full two-minute timeout and had to be killed. Edit files with the Write and Edit tools. For long Python patch scripts, Write them to the scratchpad and run `python path/to/script.py`.
- **Wrap long commands with `timeout N ... < /dev/null`** (e.g. `timeout 500 npm test < /dev/null`), so nothing waits on stdin.
- **Commit messages go through a Bash heredoc into `git commit -F -`.** PowerShell adds a BOM and mangles quotes. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **The dev server is the `dev` entry in `.claude/launch.json`** (port 5173). After editing files outside the Edit tool, `touch` them: Vite sometimes serves a stale module.
- **The `?dev` URL parameter exposes the app as `window.__surf`**, and does so on production too. Private fields (e.g. `__surf.audio`) are reachable from JS for inspection.
- **When the browser pane is hidden, `requestAnimationFrame` doesn't run.** Drive frames by hand (`__surf.updateSound(1/60)`, `__surf.audio.frame(dt)`).
- **Audio starts only after a click.** Click an empty page area, then measure by connecting an extra `AnalyserNode` to `__surf.audio.musicVolumeNode` or `.sfxBus`.
- **Before deploying changes to `api/` or `server/`, run `npm run check:api`.** Every relative import needs its `.js`, and JSON imports need `with { type: 'json' }`.
- **Full check:** `npm test`, `npm run typecheck`, `npm run build`, `npm run check:api`.
