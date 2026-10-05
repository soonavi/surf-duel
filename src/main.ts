import './ui/styles.css';
import { App } from './game/app.js';
import { findCourse } from './course/courses/index.js';
import { normalizeShareCode } from './course/shareCode.js';

const root = document.getElementById('app');
if (!root) throw new Error('#app element missing from index.html');

const params = new URLSearchParams(window.location.search);
const devMode = import.meta.env.DEV || params.has('dev');
// ?course= is either a shipped course id (tutorial, easy-cruise…) or a share code for an AI course.
const courseParam = params.get('course') ?? '';
const shipped = findCourse(courseParam) ? courseParam : undefined;
const app = new App(root, devMode, shipped);
app.start();

const roomCode = params.get('room');
const shareCode = shipped ? null : normalizeShareCode(courseParam);
if (roomCode) app.joinRoomFromUrl(roomCode);
else if (shareCode) app.openSharedCourseFromUrl(shareCode);

if (devMode) {
  // Console handle for debugging, e.g. `__surf.respawn()`.
  (window as unknown as { __surf: App }).__surf = app;
  void import('./ui/devPanel.js').then(({ createDevPanel }) => createDevPanel(app));
}
