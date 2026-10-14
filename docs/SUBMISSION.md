# Surf Duel: submission notes

**Title:** Surf Duel

**Tagline:** Surf AI-built courses. Race your friends live.

**Play:** https://surf-duel-dun.vercel.app · **Code:** https://github.com/soonavi/surf-duel

## Description for the submission form (≤ 500 characters: this one is 488)

Surf Duel is my take on "surf", the Counter-Strike trick where you lean into steep ramps and let gravity fling you forward. Race friends live (up to eight of you), chase other players' ghosts, or type a course idea and watch OpenAI build it in seconds. The best part was tweaking the physics until it finally felt right. The hardest was making sure every AI course could be beaten, so a bot test-rides each one before you get it. Next up: more maps, rings to fly through and gaps to jump.

## Longer project description

Surf Duel is a browser racing game built on "surf", the cult movement trick from Source-engine games: you slide along steep angled ramps, holding the key toward the ramp and steering with the mouse, turning gravity into blistering speed.

To play, pick a course, hold A or D toward the ramp you're on, never press W, and fly from ramp to ramp to the finish. A coached tutorial teaches it in two minutes.

The twists: create a room and race up to eight friends live, with real-time positions and standings, or describe any course in a sentence and the OpenAI API designs it in seconds, ready to race and share with a code. Every course has a global leaderboard where you can race anyone's ghost, and its own generated synthwave soundtrack.

Built with TypeScript, Three.js, Supabase Realtime and Postgres, Vercel functions and the OpenAI API.

## Cover image

`docs/cover.png`: 1800×1200 (3:2, as the form asks), a rider chasing a rival down Speed Demon. To make it again, open `/?capture=cover` on the deployed site (or `npm run dev`) and press **P**: it downloads `surf-duel-cover.png`.

## A two-minute tour for judges

1. Play the **Tutorial**: the on-screen coach teaches surfing in about two minutes.
2. Race **Easy Cruise**, then race the top time's ghost from the leaderboard.
3. **Design a course with AI**: type a description, watch the flyover preview, race it, copy its share link.
4. **Create room**, open the invite link in a second window, and race yourself live.
