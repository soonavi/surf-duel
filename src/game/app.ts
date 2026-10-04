import * as THREE from 'three';
import { FixedStepLoop } from './loop';
import { Input } from './input';
import { loadSettings, saveSettings, type Settings } from './settings';
import { applyMouseLook, wrapAngle, type ViewAngles } from './view';
import { noclipStep } from './noclip';
import { RaceSession } from './race';
import { GhostRecorder, decodeGhost, encodeGhost, sampleGhost, type GhostData } from './ghost';
import { RecordStore, type SaveOutcome } from './records';
import { recordBotGhost, shippedDevGhost, type GhostRun } from './devGhosts';
import type { DevGhostFile } from './devGhostFile';
import { EYE_HEIGHT, TICK_RATE, physics } from '../physics/constants';
import { BvhWorld } from '../physics/collision';
import { createPlayer, stepPlayer, type MoveCmd, type PlayerState } from '../physics/player';
import { SceneView } from '../render/scene';
import { CourseView } from '../render/courseView';
import { GhostView } from '../render/ghostView';
import { THEME_DEFS } from '../render/themes';
import { buildCourse, type BuiltCourse, type SpawnPoint } from '../course/builder';
import { CourseRuntime, placeAtSpawn, type CourseEvent } from '../course/runtime';
import { SurfBot } from '../course/bot';
import { courseKey } from '../course/courseKey';
import type { ThemeName } from '../course/schema';
import { validateCourse } from '../course/validator';
import { SHIPPED_COURSES } from '../course/courses';
import { Overlay, type ResultsView } from '../ui/overlay';
import { Hud, type HudMarker } from '../ui/hud';

type AppState = 'menu' | 'loading' | 'countdown' | 'racing' | 'results';
type StartKind = 'full' | 'quick';

/** Dev-only knobs, exposed in the tuning panel. */
export interface DebugOptions {
  showHud: boolean;
  noclip: boolean;
  /** Let the bot drive (watch a course get surfed). */
  autopilot: boolean;
  flySpeed: number;
  /** Force a theme regardless of the course spec. */
  themeOverride: ThemeName | 'auto';
}

interface ActiveGhost {
  run: GhostRun;
  view: GhostView;
  color: string;
  hint: number;
  progress: number;
}

const COUNTDOWN_FULL = 3;
const COUNTDOWN_QUICK = 2;
/** How long you keep sliding on the finish pad before the results appear. */
const RESULTS_DELAY_MS = 1400;
const GO_FLASH_MS = 700;
const PB_COLOR = '#ffd27a';
const RIVAL_COLOR = '#7cf8c4';

export class App {
  readonly settings: Settings = loadSettings();
  readonly debug: DebugOptions;
  /** Set by the dev panel so the HUD can flag non-default physics. */
  tuningModified = false;

  private state: AppState = 'menu';
  private paused = false;
  private pendingStart: StartKind | null = null;
  private angles: ViewAngles = { yaw: 0, pitch: 0 };
  private readonly view: SceneView;
  private readonly input: Input;
  private readonly overlay: Overlay;
  private readonly hud: Hud;
  private readonly loop: FixedStepLoop;
  private readonly records = new RecordStore();

  private built!: BuiltCourse;
  private key = '';
  private courseId: string | null = null;
  private courseView: CourseView | null = null;
  private world!: BvhWorld;
  private runtime!: CourseRuntime;
  private bot!: SurfBot;
  private selectedCourseId: string;

  // Current run.
  private session: RaceSession | null = null;
  private recorder: GhostRecorder | null = null;
  /** Ticks since the go signal; keeps running after you finish so ghosts carry on. */
  private ghostTicks = 0;
  private ghosts: ActiveGhost[] = [];
  private readonly rivalCache = new Map<string, GhostRun | null>();
  /** Autopilot or noclip used during this run: it won't be saved. */
  private assisted = false;
  /** "GO!" is on screen; hidden GO_FLASH_MS of race time after the start. */
  private goShowing = false;
  /** Results waiting to be shown, and the ghost tick at which to show them. */
  private pendingResults: { view: ResultsView; atTick: number } | null = null;
  private lastFinish: { timeMs: number; splits: (number | null)[]; ghost: GhostData } | null = null;

  private readonly player: PlayerState = createPlayer();
  /** Feet position at the previous tick, for render interpolation. */
  private readonly prevPos = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly ghostPos = new THREE.Vector3();

  // Mouse yaw is spread evenly across the ticks of a frame, so fast flicks
  // while strafing turn smoothly instead of in one lump per frame.
  private yawFrom = 0;
  private yawDelta = 0;
  private ticksThisFrame = 0;
  private tickIndex = 0;

  // Stats for the debug readout.
  private tickCount = 0;
  private frameCount = 0;
  private statsTime = 0;
  private fps = 0;
  private tps = 0;

  constructor(
    root: HTMLElement,
    private readonly devMode: boolean,
    initialCourseId?: string,
  ) {
    this.debug = { showHud: devMode, noclip: false, autopilot: false, flySpeed: 900, themeOverride: 'auto' };
    this.view = new SceneView(root);
    this.view.setFov(this.settings.fov);
    this.input = new Input(this.view.canvas);
    this.overlay = new Overlay(document.body);
    this.hud = new Hud(document.body);
    this.overlay.setDebugVisible(this.debug.showHud);

    // The loop must exist before the first course loads (loading resets to the menu, which pauses it).
    this.loop = new FixedStepLoop({
      beginFrame: (steps) => this.beginFrame(steps),
      tick: (dt) => this.tick(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
    this.loop.simulating = false;

    this.selectedCourseId = SHIPPED_COURSES.some((c) => c.id === initialCourseId) ? initialCourseId! : SHIPPED_COURSES[0]!.id;
    this.refreshCourseCards();
    this.selectCourse(this.selectedCourseId);

    this.overlay.onEngage = () => {
      if (this.state === 'menu') this.pendingStart = 'full';
      this.engage();
    };
    this.overlay.onSelectCourse = (id) => this.selectCourse(id);
    this.overlay.onRestart = () => this.raceAgain();
    this.overlay.onRaceAgain = () => this.raceAgain();
    this.overlay.onMenu = () => this.goToMenu();
    this.overlay.onSaveDevGhost = () => void this.saveDevGhost();
    this.input.onLockChange = (locked) => this.handleLockChange(locked);

    window.addEventListener('resize', () => this.view.resize());
    window.addEventListener('keydown', (e) => this.handleMenuKeys(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    if (!Input.pointerLockSupported) this.overlay.show('unsupported');
  }

  start(): void {
    this.loop.start();
  }

  get course(): BuiltCourse {
    return this.built;
  }

  // --- courses ---------------------------------------------------------------

  /** Pick one of the shipped courses (start-screen cards). */
  selectCourse(id: string): void {
    const shipped = SHIPPED_COURSES.find((c) => c.id === id);
    if (!shipped) return;
    this.selectedCourseId = id;
    this.overlay.setSelectedCourse(id);
    this.loadCourse(shipped.spec, id);
  }

  /** Build and show any course spec (shipped, random, or later AI-generated). Returns to the menu. */
  loadCourse(spec: unknown, shippedId: string | null = null): BuiltCourse {
    const built = buildCourse(spec);
    if (built.repairs.length > 0 && this.devMode) console.info('[surf-duel] course repaired:', built.repairs);
    this.built = built;
    this.key = courseKey(built.course);
    this.courseId = shippedId;
    this.world = new BvhWorld(built.collision);
    this.runtime = new CourseRuntime(built);
    this.bot = new SurfBot(built, { hop: true });
    this.applyTheme();
    this.clearGhosts();
    this.hud.setCheckpointTicks(this.checkpointFractions());
    this.goToMenu();
    return built;
  }

  /** Rebuild visuals with the current theme (course theme or dev override). */
  applyTheme(): void {
    const theme = THEME_DEFS[this.debug.themeOverride === 'auto' ? this.built.course.theme : this.debug.themeOverride];
    this.courseView?.dispose();
    this.courseView = new CourseView(this.built, theme);
    this.view.scene.add(this.courseView.group);
    this.view.applyTheme(theme);
  }

  private refreshCourseCards(): void {
    this.overlay.setCourses(
      SHIPPED_COURSES.map((c) => {
        const spec = validateCourse(c.spec).course;
        return {
          id: c.id,
          name: spec.name,
          difficulty: spec.difficulty,
          blurb: c.blurb,
          swatch: THEME_DEFS[spec.theme].swatch,
          bestMs: this.records.best(courseKey(spec))?.timeMs ?? null,
        };
      }),
      this.selectedCourseId,
    );
  }

  private checkpointFractions(): number[] {
    const path = this.built.path;
    return this.built.triggers
      .filter((t) => t.kind === 'checkpoint')
      .map((t) => path.locate(t.center, 0).s / Math.max(1, path.length));
  }

  // --- settings & dev --------------------------------------------------------

  /** Push changed settings into the renderer and persist them. */
  applySettings(): void {
    this.view.setFov(this.settings.fov);
    saveSettings(this.settings);
  }

  applyDebug(): void {
    this.overlay.setDebugVisible(this.debug.showHud);
  }

  /** Free the mouse without leaving the game, e.g. to use the tuning panel. */
  releasePointer(): void {
    this.input.releaseLock();
  }

  // --- flow ------------------------------------------------------------------

  private engage(): void {
    this.overlay.setMessage('');
    this.input.requestLock(this.settings.rawInput).catch(() => {
      // Most often Chrome refusing a re-lock within ~1 s of pressing Esc.
      this.overlay.setMessage("Couldn't capture the mouse — click again.");
    });
  }

  private handleLockChange(locked: boolean): void {
    if (locked) {
      if (this.pendingStart) {
        const kind = this.pendingStart;
        this.pendingStart = null;
        this.startRace(kind);
      } else if (this.paused) {
        this.resume();
      }
    } else {
      this.pause();
    }
  }

  /** Start (or restart) a run. A full start shows the loading screen first. */
  private startRace(kind: StartKind): void {
    this.pendingResults = null;
    this.paused = false;
    this.state = 'loading';
    if (kind === 'full') {
      this.hud.setVisible(false);
      this.overlay.setLoadingText(this.rivalCache.has(this.key) ? 'Get ready…' : 'Warming up your rival ghost…');
      this.overlay.show('loading');
      // Let the loading screen paint before the (brief) synchronous work.
      window.setTimeout(() => this.beginCountdown(COUNTDOWN_FULL), 30);
    } else {
      this.beginCountdown(COUNTDOWN_QUICK);
    }
  }

  private beginCountdown(seconds: number): void {
    if (this.state !== 'loading') return; // backed out (e.g. to the menu) while loading
    this.prepareGhosts();
    this.runtime.reset();
    this.respawnAt(this.built.spawn);
    const best = this.records.best(this.key);
    this.session = new RaceSession({
      countdownSeconds: seconds,
      checkpoints: this.built.checkpoints.length - 1,
      best: best ? { timeMs: best.timeMs, splits: best.splits } : null,
    });
    this.recorder = new GhostRecorder();
    this.recorder.tick(0, this.player.pos, this.angles.yaw);
    this.ghostTicks = 0;
    this.assisted = this.debug.autopilot || this.debug.noclip;
    this.lastFinish = null;

    this.state = 'countdown';
    this.overlay.show('none');
    this.hud.setVisible(true);
    this.hud.hideSplit();
    this.hud.setTimer(0);
    this.hud.setCheckpoints(0, this.built.checkpoints.length - 1);
    this.hud.setCountdown(this.session.countdownNumber);
    this.loop.simulating = this.input.locked;
    if (!this.input.locked) this.pause();
  }

  /** Restart the current run (Shift+R), if one is under way. */
  restartRun(): void {
    if (this.state === 'countdown' || this.state === 'racing') this.startRace('quick');
  }

  private raceAgain(): void {
    this.pendingStart = 'quick';
    this.engage();
  }

  private pause(): void {
    if ((this.state !== 'countdown' && this.state !== 'racing') || this.paused) return;
    this.paused = true;
    this.loop.simulating = false;
    this.input.releaseLock();
    this.overlay.show('pause');
  }

  private resume(): void {
    this.paused = false;
    this.overlay.show('none');
    this.loop.simulating = true;
  }

  private goToMenu(): void {
    this.pendingResults = null;
    this.state = 'menu';
    this.paused = false;
    this.pendingStart = null;
    this.session = null;
    this.loop.simulating = false;
    this.input.releaseLock();
    this.hud.setVisible(false);
    for (const g of this.ghosts) g.view.hide();
    this.runtime.reset();
    this.respawnAt(this.built.spawn);
    this.overlay.show('start');
  }

  private handleMenuKeys(e: KeyboardEvent): void {
    if (this.state !== 'results' || e.repeat) return;
    if (e.code === 'KeyR' || e.code === 'Enter') {
      e.preventDefault();
      this.raceAgain();
    } else if (e.code === 'KeyM' || e.code === 'Escape') {
      e.preventDefault();
      this.goToMenu();
    }
  }

  // --- ghosts ----------------------------------------------------------------

  /** PB ghost (if any) plus the rival: a recorded dev ghost, or the bot. */
  private prepareGhosts(): void {
    this.clearGhosts();
    const runs: { run: GhostRun; color: string }[] = [];

    const best = this.records.best(this.key);
    const pbGhost = best ? decodeGhost(best.ghost) : null;
    if (best && pbGhost) runs.push({ run: { label: 'PB', timeMs: best.timeMs, splits: best.splits, ghost: pbGhost }, color: PB_COLOR });

    if (!this.rivalCache.has(this.key)) {
      const shipped = this.courseId ? shippedDevGhost(this.courseId, this.key) : null;
      this.rivalCache.set(this.key, shipped ?? recordBotGhost(this.built));
    }
    const rival = this.rivalCache.get(this.key);
    if (rival) runs.push({ run: rival, color: RIVAL_COLOR });

    for (const { run, color } of runs) {
      const view = new GhostView(run.label, color);
      this.view.scene.add(view.group);
      this.ghosts.push({ run, view, color, hint: 0, progress: 0 });
    }
  }

  private clearGhosts(): void {
    for (const g of this.ghosts) g.view.dispose();
    this.ghosts = [];
  }

  // --- race events -----------------------------------------------------------

  private respawn(): void {
    this.respawnAt(this.runtime.respawnPoint());
  }

  private respawnAt(point: SpawnPoint): void {
    placeAtSpawn(this.player, point);
    this.prevPos.copy(this.player.pos);
    this.angles = { yaw: point.heading, pitch: THREE.MathUtils.degToRad(-10) };
    this.yawFrom = this.angles.yaw;
    this.yawDelta = 0;
    this.runtime.afterRespawn(this.player);
    this.bot.resync(this.player);
  }

  private handleEvent(event: CourseEvent): void {
    const session = this.session;
    switch (event.type) {
      case 'kill':
        this.respawn();
        break;
      case 'checkpoint':
        if (session) {
          const split = session.checkpoint(event.index);
          this.hud.showSplit({ label: `Checkpoint ${event.index}`, timeMs: split.timeMs, deltaMs: split.deltaMs });
          this.hud.setCheckpoints(event.index, this.built.checkpoints.length - 1);
        }
        break;
      case 'booster':
        this.overlay.toast('Boost!', 900);
        break;
      case 'finish':
        this.finishRun();
        break;
      case 'start':
        break;
    }
  }

  private finishRun(): void {
    const session = this.session;
    if (!session || session.phase === 'finished') return;
    const result = session.finish();
    const ghost = this.recorder?.data() ?? { rate: 20, samples: [] };
    this.recorder = null;
    this.hud.setTimer(result.timeMs);
    this.hud.showSplit({ label: 'Finish', timeMs: result.timeMs, deltaMs: result.deltaMs }, 0);

    let note = '';
    let outcome: SaveOutcome | null = null;
    if (this.assisted) note = 'Not saved: autopilot or noclip was used this run.';
    else if (this.tuningModified) note = 'Not saved: physics tuning differs from the defaults (dev panel).';
    else {
      outcome = this.records.save(this.key, {
        timeMs: result.timeMs,
        splits: result.splits,
        topSpeed: result.topSpeed,
        ghost: encodeGhost(ghost),
        at: Date.now(),
      });
      this.lastFinish = { timeMs: result.timeMs, splits: result.splits, ghost };
      this.refreshCourseCards();
    }

    const best = outcome?.previousBest ?? null;
    const view: ResultsView = {
      courseName: this.built.course.name,
      timeMs: result.timeMs,
      deltaMs: best ? result.timeMs - best.timeMs : null,
      isBest: outcome?.isBest === true && best !== null,
      rank: outcome?.rank ?? null,
      runs: outcome?.runs ?? null,
      topSpeed: result.topSpeed,
      splits: result.splits.map((t, i) => ({
        label: `Checkpoint ${i + 1}`,
        timeMs: t,
        deltaMs: t !== null && best?.splits[i] != null ? t - best.splits[i]! : null,
      })),
      rivals: this.ghosts.filter((g) => g.run.label !== 'PB').map((g) => ({ label: g.run.label === 'BOT' ? 'Bot' : 'Dev ghost', timeMs: g.run.timeMs })),
      note,
      canSaveDevGhost: this.devMode && this.courseId !== null && outcome !== null,
    };

    // Keep sliding on the finish pad for a moment, then show the results.
    // Counted in simulation ticks so pausing in between holds it too.
    this.pendingResults = { view, atTick: this.ghostTicks + Math.round((RESULTS_DELAY_MS / 1000) * TICK_RATE) };
  }

  private showResults(view: ResultsView): void {
    this.pendingResults = null;
    this.state = 'results';
    this.loop.simulating = false;
    this.hud.setVisible(false);
    this.input.releaseLock();
    this.overlay.showResults(view);
  }

  private async saveDevGhost(): Promise<void> {
    if (!this.lastFinish || !this.courseId) return;
    const file: DevGhostFile = {
      id: this.courseId,
      courseKey: this.key,
      timeMs: this.lastFinish.timeMs,
      splits: this.lastFinish.splits,
      ghost: encodeGhost(this.lastFinish.ghost),
      recordedAt: new Date().toISOString(),
    };
    try {
      const res = await fetch('/__dev/ghost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(file) });
      const body = (await res.json()) as { ok: boolean; path?: string; error?: string };
      this.overlay.toast(body.ok ? `Saved ${body.path}` : `Save failed: ${body.error}`, 4000);
      if (body.ok) this.rivalCache.delete(this.key);
    } catch (err) {
      this.overlay.toast(`Save failed: ${String(err)}`, 4000);
    }
  }

  // --- simulation ------------------------------------------------------------

  private beginFrame(steps: number): void {
    const { dx, dy } = this.input.consumeMouse();
    const next = applyMouseLook(this.angles, dx, dy, this.settings.sensitivity, this.settings.invertY);
    this.yawFrom = this.angles.yaw;
    this.yawDelta = wrapAngle(next.yaw - this.angles.yaw);
    this.ticksThisFrame = steps;
    this.tickIndex = 0;
    this.angles = next;
  }

  private tick(dt: number): void {
    const session = this.session;
    if (!session || (this.state !== 'countdown' && this.state !== 'racing')) return;
    this.tickCount++;
    this.tickIndex++;
    const yaw = this.ticksThisFrame > 0 ? this.yawFrom + (this.yawDelta * this.tickIndex) / this.ticksThisFrame : this.angles.yaw;

    if (this.input.consumePress('KeyR')) {
      if (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) {
        this.startRace('quick');
        return;
      }
      if (session.phase === 'racing') this.respawn();
      return;
    }
    if (this.devMode && this.input.consumePress('KeyN')) this.debug.noclip = !this.debug.noclip;
    if (this.devMode && this.input.consumePress('KeyB')) this.debug.autopilot = !this.debug.autopilot;
    if (this.debug.noclip || this.debug.autopilot) this.assisted = true;

    for (const e of session.tick()) {
      if (e.type === 'count') this.hud.setCountdown(e.n);
      if (e.type === 'go') {
        this.state = 'racing';
        this.hud.setCountdown('GO');
        this.goShowing = true;
      }
    }
    this.prevPos.copy(this.player.pos);
    if (session.phase === 'countdown') return; // frozen on the start pad; look around freely
    this.ghostTicks++;

    const key = (code: string): number => (this.input.isDown(code) ? 1 : 0);
    if (this.debug.noclip) {
      noclipStep(
        this.player.pos,
        { yaw, pitch: this.angles.pitch },
        {
          forward: key('KeyW') - key('KeyS'),
          right: key('KeyD') - key('KeyA'),
          up: key('Space') - key('KeyC'),
          fast: this.input.isDown('ShiftLeft'),
        },
        this.debug.flySpeed,
        dt,
      );
      this.player.vel.set(0, 0, 0);
      this.player.onGround = false;
    } else {
      let cmd: MoveCmd = { forward: key('KeyW') - key('KeyS'), side: key('KeyD') - key('KeyA'), jump: this.input.isDown('Space'), yaw };
      if (this.debug.autopilot) {
        cmd = this.bot.command(this.player);
        // The camera follows the bot's view; your mouse still controls pitch.
        this.angles.yaw = cmd.yaw;
        this.yawFrom = cmd.yaw;
        this.yawDelta = 0;
      }
      stepPlayer(this.player, cmd, physics, this.world, dt);
    }

    session.noteSpeed(Math.hypot(this.player.vel.x, this.player.vel.z));
    for (const event of this.runtime.update(this.player)) this.handleEvent(event);
    if (session.phase === 'racing') this.recorder?.tick(this.ghostTicks, this.player.pos, this.angles.yaw);
    if (this.pendingResults && this.ghostTicks >= this.pendingResults.atTick) this.showResults(this.pendingResults.view);
  }

  // --- rendering -------------------------------------------------------------

  private render(alpha: number, frameDt: number): void {
    this.camPos.lerpVectors(this.prevPos, this.player.pos, alpha);
    this.camPos.y += EYE_HEIGHT;
    const cam = this.view.camera;
    cam.position.copy(this.camPos);
    cam.rotation.set(this.angles.pitch, this.angles.yaw, 0);

    const racing = this.session !== null && (this.state === 'countdown' || this.state === 'racing');
    if (racing) this.updateGhostsAndHud(alpha);
    this.view.render();
    this.updateStats(frameDt);
  }

  private updateGhostsAndHud(alpha: number): void {
    const session = this.session!;
    const path = this.built.path;
    const live = this.loop.simulating && session.phase !== 'countdown';
    const t = (this.ghostTicks + (live ? alpha : 0)) / TICK_RATE;
    const markers: HudMarker[] = [];
    for (const g of this.ghosts) {
      const yaw = sampleGhost(g.run.ghost, t, this.ghostPos);
      g.view.update(this.ghostPos, yaw, this.camPos);
      const hit = path.locate(this.ghostPos, g.hint);
      g.hint = hit.index;
      g.progress = hit.s / Math.max(1, path.length);
      markers.push({ label: g.run.label, color: g.color, progress: g.progress });
    }

    if (session.phase !== 'finished') this.hud.setTimer(session.elapsedMs);
    this.hud.setSpeed(Math.hypot(this.player.vel.x, this.player.vel.z));
    this.hud.setProgress(this.runtime.progress / Math.max(1, path.length), markers);
    if (this.goShowing && session.phase !== 'countdown' && this.ghostTicks * (1000 / TICK_RATE) > GO_FLASH_MS) {
      this.hud.setCountdown(null);
      this.goShowing = false;
    }
  }

  private updateStats(frameDt: number): void {
    this.frameCount++;
    this.statsTime += frameDt;
    if (this.statsTime < 0.25) return;
    this.fps = this.frameCount / this.statsTime;
    this.tps = this.tickCount / this.statsTime;
    this.frameCount = 0;
    this.tickCount = 0;
    this.statsTime = 0;

    if (!this.debug.showHud) return;
    const { pos, vel, onGround, surfing } = this.player;
    const moveState = this.debug.noclip ? 'NOCLIP' : onGround ? 'GROUND' : surfing ? 'SURF' : 'AIR';
    const lines = [
      `FPS   ${this.fps.toFixed(0)}   TICK ${this.tps.toFixed(0)}/${TICK_RATE}${this.loop.simulating ? '' : ' (paused)'}`,
      `STATE ${this.state}${this.paused ? ' (paused)' : ''} · ${moveState}${this.debug.autopilot ? ' [AUTOPILOT]' : ''}`,
      `SPEED ${Math.hypot(vel.x, vel.z).toFixed(0)} h · ${vel.length().toFixed(0)} total u/s`,
      `POS   ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`,
      `COURSE ${this.built.course.name} · ${this.key}`,
      `MOUSE ${this.input.locked ? (this.input.rawActive ? 'raw' : 'accelerated') : 'free'}`,
    ];
    if (this.tuningModified) lines.push('⚠ physics tuning differs from defaults');
    this.overlay.setDebugText(lines.join('\n'));
  }
}
