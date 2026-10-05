# Surf Duel: submission notes

**Title:** Surf Duel

**Tagline:** Surf AI-built courses. Race your friends live.

**Play:** https://surf-duel-dun.vercel.app · **Code:** https://github.com/soonavi/surf-duel

## Project description

Surf Duel is a browser racing game built on "surf", the cult movement trick from Source-engine games: you slide along steep angled ramps, holding the key toward the ramp and steering with the mouse, turning gravity into blistering speed.

To play, pick a course, hold A or D toward the ramp you're on, never press W, and fly from ramp to ramp to the finish. A coached tutorial teaches it in two minutes.

The twists: create a room and race up to eight friends live, with real-time positions and standings, or describe any course in a sentence and the OpenAI API designs it in seconds, ready to race and share with a code. Every course has a global leaderboard where you can race anyone's ghost, and its own generated synthwave soundtrack.

Built with TypeScript, Three.js, Supabase Realtime and Postgres, Vercel functions and the OpenAI API.

## Cover image

Open `/?capture=cover` on the deployed site (or `npm run dev`) and press **P**: it downloads `surf-duel-cover.png`, 1600×900.

## A two-minute tour for judges

1. Play the **Tutorial**: the on-screen coach teaches surfing in about two minutes.
2. Race **Easy Cruise**, then race the top time's ghost from the leaderboard.
3. **Design a course with AI**: type a description, watch the flyover preview, race it, copy its share link.
4. **Create room**, open the invite link in a second window, and race yourself live.
