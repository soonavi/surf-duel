import GUI from 'lil-gui';
import { z } from 'zod';
import { DEFAULT_PHYSICS, PHYSICS_LIMITS, physics, type PhysicsParams } from '../physics/constants.js';
import { SETTINGS_LIMITS } from '../game/settings.js';
import { SHIPPED_COURSES } from '../course/courses/index.js';
import { randomCourse } from '../course/random.js';
import { THEMES } from '../course/schema.js';
import type { App } from '../game/app.js';

const STORAGE_KEY = 'surfduel.dev.physics.v1';
const StoredPhysics = z.record(z.string(), z.number());
const PHYSICS_KEYS = Object.keys(DEFAULT_PHYSICS) as (keyof PhysicsParams)[];

function loadStoredPhysics(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = StoredPhysics.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    for (const key of PHYSICS_KEYS) {
      const value = parsed.data[key];
      if (value !== undefined && Number.isFinite(value)) physics[key] = value;
    }
  } catch {
    // Ignore unreadable storage; defaults stay in place.
  }
}

function storePhysics(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(physics));
  } catch {
    // Storage unavailable; tweaks last until reload.
  }
}

function isModified(): boolean {
  return PHYSICS_KEYS.some((k) => physics[k] !== DEFAULT_PHYSICS[k]);
}

/**
 * Dev-only tuning panel, toggled with the backtick key. Loaded lazily in dev
 * builds or with `?dev` in the URL, so it never ships in the main bundle.
 * Physics tweaks persist in localStorage until you hit "Reset".
 */
export function createDevPanel(app: App): GUI {
  loadStoredPhysics();

  const gui = new GUI({ title: 'Tuning  ( ` to hide )' });
  gui.hide();

  const refreshModified = (): void => {
    app.tuningModified = isModified();
    gui.title(app.tuningModified ? 'Tuning — modified  ( ` )' : 'Tuning  ( ` to hide )');
  };

  // --- Course -------------------------------------------------------------
  const course = gui.addFolder('Course');
  const courseState = {
    course: SHIPPED_COURSES[0]!.id,
    seed: 1,
    load: () => {
      if (courseState.course === 'random') {
        const built = app.loadCourse(randomCourse(courseState.seed));
        console.info(`[surf-duel] random seed ${courseState.seed}:`, built.course);
      } else {
        app.selectCourse(courseState.course);
      }
    },
    nextSeed: () => {
      courseState.seed++;
      seedCtrl.updateDisplay();
      courseState.course = 'random';
      courseCtrl.updateDisplay();
      courseState.load();
    },
    logSpec: () => console.info('[surf-duel] course spec:', JSON.stringify(app.course.course, null, 2)),
  };
  const courseCtrl = course.add(courseState, 'course', [...SHIPPED_COURSES.map((c) => c.id), 'random']).name('course');
  const seedCtrl = course.add(courseState, 'seed', 1, 9999, 1).name('random seed');
  course.add(courseState, 'load').name('Load course');
  course.add(courseState, 'nextSeed').name('Next random seed');
  course
    .add(app.debug, 'themeOverride', ['auto', ...THEMES])
    .name('theme')
    .onChange(() => app.applyTheme());
  course.add(courseState, 'logSpec').name('Log spec JSON');

  // --- Physics ------------------------------------------------------------
  const phys = gui.addFolder('Physics').close();
  for (const key of PHYSICS_KEYS) {
    const { min, max, step } = PHYSICS_LIMITS[key];
    phys.add(physics, key, min, max, step).onChange(() => {
      storePhysics();
      refreshModified();
    });
  }
  const physActions = {
    reset: () => {
      Object.assign(physics, DEFAULT_PHYSICS);
      storePhysics();
      phys.controllersRecursive().forEach((c) => c.updateDisplay());
      refreshModified();
    },
    copy: async () => {
      const json = JSON.stringify(physics, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        copyCtrl.name('Copied ✓');
      } catch {
        console.info('[surf-duel] physics tuning:\n' + json);
        copyCtrl.name('Logged to console');
      }
      window.setTimeout(() => copyCtrl.name('Copy physics JSON'), 1500);
    },
  };
  phys.add(physActions, 'reset').name('Reset to defaults');
  const copyCtrl = phys.add(physActions, 'copy').name('Copy physics JSON');

  // --- Input & view ---------------------------------------------------------
  const input = gui.addFolder('Input & view').close();
  const { sensitivity, fov } = SETTINGS_LIMITS;
  input.add(app.settings, 'sensitivity', sensitivity.min, sensitivity.max, sensitivity.step).onChange(() => app.applySettings());
  input.add(app.settings, 'invertY').name('invert Y').onChange(() => app.applySettings());
  input.add(app.settings, 'rawInput').name('raw input (next lock)').onChange(() => app.applySettings());
  input.add(app.settings, 'fov', fov.min, fov.max, fov.step).name('FOV (vertical)').onChange(() => app.applySettings());

  // --- Debug ----------------------------------------------------------------
  const debug = gui.addFolder('Debug');
  debug.add(app.debug, 'autopilot').name('autopilot (B)').listen();
  debug.add(app.debug, 'noclip').name('noclip (N)').listen();
  debug.add(app.debug, 'flySpeed', 100, 5000, 50).name('noclip speed');
  debug.add(app.debug, 'showHud').name('debug readout').onChange(() => app.applyDebug());
  debug.add({ restart: () => app.restartRun() }, 'restart').name('Restart run (Shift+R)');

  refreshModified();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' || e.repeat) return;
    e.preventDefault();
    if (gui._hidden) {
      gui.show();
      // The panel needs a free cursor.
      app.releasePointer();
    } else {
      gui.hide();
    }
  });

  return gui;
}
