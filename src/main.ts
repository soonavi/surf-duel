import './ui/styles.css';
import { App } from './game/app';

const root = document.getElementById('app');
if (!root) throw new Error('#app element missing from index.html');

const app = new App(root);
app.start();

const wantsDevPanel = import.meta.env.DEV || new URLSearchParams(window.location.search).has('dev');
if (wantsDevPanel) {
  // Console handle for debugging, e.g. `__surf.respawn()`.
  (window as unknown as { __surf: App }).__surf = app;
  void import('./ui/devPanel').then(({ createDevPanel }) => createDevPanel(app));
}
