import './ui/styles.css';
import { App } from './game/app';

const root = document.getElementById('app');
if (!root) throw new Error('#app element missing from index.html');

const params = new URLSearchParams(window.location.search);
const devMode = import.meta.env.DEV || params.has('dev');
const app = new App(root, devMode, params.get('course') ?? undefined);
app.start();

if (devMode) {
  // Console handle for debugging, e.g. `__surf.respawn()`.
  (window as unknown as { __surf: App }).__surf = app;
  void import('./ui/devPanel').then(({ createDevPanel }) => createDevPanel(app));
}
