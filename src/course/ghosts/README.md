# Dev ghosts

Ghost runs recorded by a human on the shipped courses, one `<course-id>.json` per course.

Record one in a dev build (`npm run dev`): finish a clean run (no autopilot, noclip or modified physics), then click **Save as dev ghost** on the results screen. The dev server writes the file here; commit it.

A file only applies while its `courseKey` matches the current course. If the course or its layout changes, the game ignores the stale file and falls back to the bot ghost until a new one is recorded.
