import * as THREE from 'three';
import { FixedStepLoop } from './loop';
import { Input } from './input';
import { loadSettings, saveSettings, type Settings } from './settings';
import { applyMouseLook, wrapAngle, type ViewAngles } from './view';
import { noclipStep } from './noclip';
import { EYE_HEIGHT, TICK_RATE, physics } from '../physics/constants';
import { BvhWorld } from '../physics/collision';
import { createPlayer, stepPlayer, type MoveCmd, type PlayerState } from '../physics/player';
import { SceneView } from '../render/scene';
import { CourseView } from '../render/courseView';
import { THEME_DEFS } from '../render/themes';
import { buildCourse, type BuiltCourse, type SpawnPoint } from '../course/builder';
import { CourseRuntime, type CourseEvent } from '../course/runtime';
import { SurfBot } from '../course/bot';
import type { ThemeName } from '../course/schema';
import { validateCourse } from '../course/validator';
import { SHIPPED_COURSES } from '../course/courses';
import { Overlay } from '../ui/overlay';

type AppState = 'start' | 'playing' | 'paused';

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

export class App {
  readonly settings: Settings = loadSettings();
  readonly debug: DebugOptions;
  /** Set by the dev panel so the HUD can flag non-default physics. */
  tuningModified = false;

  private state: AppState = 'start';
  private angles: ViewAngles = { yaw: 0, pitch: 0 };
  private readonly view: SceneView;
  private readonly input: Input;
  private readonly overlay: Overlay;
  private readonly loop: FixedStepLoop;

  private built!: BuiltCourse;
  private courseView: CourseView | null = null;
  private world!: BvhWorld;
  private runtime!: CourseRuntime;
  private bot!: SurfBot;
  private selectedCourseId: string;

  private readonly player: PlayerState = createPlayer();
  /** Feet position at the previous tick, for render interpolation. */
  private readonly prevPos = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();

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
    this.overlay.setDebugVisible(this.debug.showHud);

    this.selectedCourseId = SHIPPED_COURSES.some((c) => c.id === initialCourseId) ? initialCourseId! : SHIPPED_COURSES[0]!.id;
    this.overlay.setCourses(
      SHIPPED_COURSES.map((c) => {
        const spec = validateCourse(c.spec).course;
        return { id: c.id, name: spec.name, difficulty: spec.difficulty, blurb: c.blurb, swatch: THEME_DEFS[spec.theme].swatch };
      }),
      this.selectedCourseId,
    );
    this.selectCourse(this.selectedCourseId);

    this.loop = new FixedStepLoop({
      beginFrame: (steps) => this.beginFrame(steps),
      tick: (dt) => this.tick(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
    this.loop.simulating = false;

    this.overlay.onEngage = () => this.engage();
    this.overlay.onSelectCourse = (id) => this.selectCourse(id);
    this.overlay.onRestart = () => {
      this.restart();
      this.engage();
    };
    this.overlay.onCourseSelect = () => {
      this.state = 'start';
      this.overlay.show('start');
    };
    this.input.onLockChange = (locked) => this.handleLockChange(locked);
    window.addEventListener('resize', () => this.view.resize());
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

  /** Pick one of the shipped courses (start-screen cards). */
  selectCourse(id: string): void {
    const shipped = SHIPPED_COURSES.find((c) => c.id === id);
    if (!shipped) return;
    this.selectedCourseId = id;
    this.overlay.setSelectedCourse(id);
    this.loadCourse(shipped.spec);
  }

  /** Build and show any course spec (shipped, random, or later AI-generated). */
  loadCourse(spec: unknown): BuiltCourse {
    const built = buildCourse(spec);
    if (built.repairs.length > 0 && this.devMode) console.info('[surf-duel] course repaired:', built.repairs);
    this.built = built;
    this.world = new BvhWorld(built.collision);
    this.runtime = new CourseRuntime(built);
    this.bot = new SurfBot(built, { hop: true });
    this.applyTheme();
    this.restart();
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

  /** Back to the start of the course. */
  restart(): void {
    this.runtime.reset();
    this.respawnAt(this.built.spawn);
  }

  /** Back to the last checkpoint reached. */
  respawn(): void {
    this.respawnAt(this.runtime.respawnPoint());
  }

  private respawnAt(point: SpawnPoint): void {
    this.player.pos.copy(point.pos);
    this.player.vel.set(0, 0, 0);
    this.player.onGround = false;
    this.prevPos.copy(this.player.pos);
    this.angles = { yaw: point.heading, pitch: THREE.MathUtils.degToRad(-10) };
    this.yawFrom = this.angles.yaw;
    this.yawDelta = 0;
    this.runtime.afterRespawn(this.player);
    this.bot.resync(this.player);
  }

  private engage(): void {
    this.overlay.setMessage('');
    this.input.requestLock(this.settings.rawInput).catch(() => {
      // Most often Chrome refusing a re-lock within ~1 s of pressing Esc.
      this.overlay.setMessage("Couldn't capture the mouse — click again.");
    });
  }

  private handleLockChange(locked: boolean): void {
    if (locked) {
      this.state = 'playing';
      this.loop.simulating = true;
      this.overlay.show('none');
    } else {
      this.pause();
    }
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.loop.simulating = false;
    this.input.releaseLock();
    this.overlay.show('pause');
  }

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
    this.tickCount++;
    this.tickIndex++;
    const yaw = this.ticksThisFrame > 0 ? this.yawFrom + (this.yawDelta * this.tickIndex) / this.ticksThisFrame : this.angles.yaw;

    if (this.input.consumePress('KeyR')) {
      if (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) this.restart();
      else this.respawn();
      return;
    }
    if (this.devMode && this.input.consumePress('KeyN')) this.debug.noclip = !this.debug.noclip;
    if (this.devMode && this.input.consumePress('KeyB')) this.debug.autopilot = !this.debug.autopilot;

    const key = (code: string): number => (this.input.isDown(code) ? 1 : 0);
    this.prevPos.copy(this.player.pos);

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
      return;
    }

    let cmd: MoveCmd = { forward: key('KeyW') - key('KeyS'), side: key('KeyD') - key('KeyA'), jump: this.input.isDown('Space'), yaw };
    if (this.debug.autopilot) {
      cmd = this.bot.command(this.player);
      // The camera follows the bot's view; your mouse still controls pitch.
      this.angles.yaw = cmd.yaw;
      this.yawFrom = cmd.yaw;
      this.yawDelta = 0;
    }
    stepPlayer(this.player, cmd, physics, this.world, dt);
    for (const event of this.runtime.update(this.player)) this.handleEvent(event);
  }

  private handleEvent(event: CourseEvent): void {
    switch (event.type) {
      case 'kill':
        this.respawn();
        break;
      case 'checkpoint':
        this.overlay.toast(`Checkpoint ${event.index}`);
        break;
      case 'booster':
        this.overlay.toast('Boost!', 900);
        break;
      case 'finish':
        this.overlay.toast('Finish! — timing arrives in Phase 3', 3000);
        break;
      case 'start':
        break;
    }
  }

  private render(alpha: number, frameDt: number): void {
    this.camPos.lerpVectors(this.prevPos, this.player.pos, alpha);
    this.camPos.y += EYE_HEIGHT;
    const cam = this.view.camera;
    cam.position.copy(this.camPos);
    cam.rotation.set(this.angles.pitch, this.angles.yaw, 0);
    this.view.render();

    const v = this.player.vel;
    this.overlay.setSpeed(Math.hypot(v.x, v.z));
    this.updateStats(frameDt);
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
    const rt = this.runtime;
    const lines = [
      `FPS   ${this.fps.toFixed(0)}   TICK ${this.tps.toFixed(0)}/${TICK_RATE}${this.loop.simulating ? '' : ' (paused)'}`,
      `STATE ${moveState}${this.debug.autopilot ? '  [AUTOPILOT]' : ''}`,
      `SPEED ${Math.hypot(vel.x, vel.z).toFixed(0)} h · ${vel.length().toFixed(0)} total u/s`,
      `POS   ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`,
      `COURSE ${this.built.course.name} · ${(rt.progress / 1000).toFixed(1)}k / ${(this.built.path.length / 1000).toFixed(1)}k · CP ${rt.lastCheckpoint}/${this.built.checkpoints.length - 1}`,
      `MOUSE ${this.input.locked ? (this.input.rawActive ? 'raw' : 'accelerated') : 'free'}`,
    ];
    if (this.tuningModified) lines.push('⚠ physics tuning differs from defaults');
    this.overlay.setDebugText(lines.join('\n'));
  }
}
