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

## Current controls (Phase 1 movement playtest)

| Key | Action |
|---|---|
| Mouse | Look (pointer lock, raw input where supported) |
| W A S D | Move / air-strafe |
| Space | Jump (hold to auto-hop) |
| R | Respawn |
| Esc | Pause (release mouse) |
| N | Toggle noclip (dev builds only; Space/C up/down, Shift fast) |

## Movement model

Source/Quake-style, in `src/physics/` — pure, deterministic, and unit-tested:

- `movement.ts` — accelerate / air-accelerate (wish-speed cap), friction, velocity clipping, multi-plane crease logic.
- `collision.ts` — capsule (32 × 72) vs. a three-mesh-bvh BVH, resolved deepest-contact-first so triangle seams don't bleed speed.
- `player.ts` — one 100 Hz tick: half-gravity before/after, jump-before-friction (lossless bunny-hops), ground vs. air movement, sub-stepped collide-and-slide (≤ 8 units per substep, so no tunnelling at 3500 u/s), ground categorisation. Surfaces with `normal.y < 0.7` are surfable.
