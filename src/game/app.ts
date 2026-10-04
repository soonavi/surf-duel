import * as THREE from 'three';
import { FixedStepLoop } from './loop';
import { Input } from './input';
import { loadSettings, saveSettings, type Settings } from './settings';
import { applyMouseLook, type ViewAngles } from './view';
import { noclipStep } from './noclip';
import { EYE_HEIGHT, TICK_RATE } from '../physics/constants';
import { SceneView } from '../render/scene';
import { buildTestLevel } from '../course/testLevel';
import { Overlay } from '../ui/overlay';

type AppState = 'start' | 'playing' | 'paused';

/** Dev-only knobs, exposed in the tuning panel. */
export interface DebugOptions {
  showHud: boolean;
  flySpeed: number;
}

export class App {
  readonly settings: Settings = loadSettings();
  readonly debug: DebugOptions = { showHud: import.meta.env.DEV, flySpeed: 900 };
  /** Set by the dev panel so the HUD can flag non-default physics. */
  tuningModified = false;

  private state: AppState = 'start';
  private angles: ViewAngles = { yaw: 0, pitch: 0 };
  private readonly view: SceneView;
  private readonly input: Input;
  private readonly overlay: Overlay;
  private readonly loop: FixedStepLoop;
  private readonly spawn: THREE.Vector3;

  // Simulation state: positions at the previous and current tick, for render interpolation.
  private readonly pos = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();
  private speed = 0;

  // Stats for the debug readout.
  private tickCount = 0;
  private frameCount = 0;
  private statsTime = 0;
  private fps = 0;
  private tps = 0;

  constructor(root: HTMLElement) {
    this.view = new SceneView(root);
    this.view.setFov(this.settings.fov);
    this.input = new Input(this.view.canvas);
    this.overlay = new Overlay(document.body);
    this.overlay.setDebugVisible(this.debug.showHud);

    const level = buildTestLevel();
    this.view.scene.add(level.group);
    this.spawn = level.spawn;
    this.respawn();

    this.loop = new FixedStepLoop({
      tick: (dt) => this.tick(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
    this.loop.simulating = false;

    this.overlay.onEngage = () => this.engage();
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

  respawn(): void {
    this.pos.copy(this.spawn).setY(this.spawn.y + EYE_HEIGHT);
    this.prevPos.copy(this.pos);
    // Tilt down a little so the first view shows the ramp below the platform.
    this.angles = { yaw: 0, pitch: THREE.MathUtils.degToRad(-15) };
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

  private tick(dt: number): void {
    this.tickCount++;
    if (this.input.consumePress('KeyR')) this.respawn();

    const key = (code: string): number => (this.input.isDown(code) ? 1 : 0);
    this.prevPos.copy(this.pos);
    noclipStep(
      this.pos,
      this.angles,
      {
        forward: key('KeyW') - key('KeyS'),
        right: key('KeyD') - key('KeyA'),
        up: key('Space') - key('KeyC'),
        fast: this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight'),
      },
      this.debug.flySpeed,
      dt,
    );
    this.speed = this.pos.distanceTo(this.prevPos) / dt;
  }

  private render(alpha: number, frameDt: number): void {
    // Mouse look is applied per frame, not per tick, so aiming never waits on the simulation.
    if (this.state === 'playing') {
      const { dx, dy } = this.input.consumeMouse();
      this.angles = applyMouseLook(this.angles, dx, dy, this.settings.sensitivity, this.settings.invertY);
    }

    const cam = this.view.camera;
    cam.position.lerpVectors(this.prevPos, this.pos, alpha);
    cam.rotation.set(this.angles.pitch, this.angles.yaw, 0);
    this.view.render();

    this.updateStats(frameDt);
  }

  private updateStats(frameDt: number): void {
    this.frameCount++;
    this.statsTime += frameDt;
    if (this.statsTime < 0.5) return;
    this.fps = this.frameCount / this.statsTime;
    this.tps = this.tickCount / this.statsTime;
    this.frameCount = 0;
    this.tickCount = 0;
    this.statsTime = 0;

    if (!this.debug.showHud) return;
    const p = this.pos;
    const lines = [
      `FPS   ${this.fps.toFixed(0)}`,
      `TICK  ${this.tps.toFixed(0)} / ${TICK_RATE} Hz${this.loop.simulating ? '' : ' (paused)'}`,
      `SPEED ${this.speed.toFixed(0)} u/s`,
      `POS   ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`,
      `YAW   ${THREE.MathUtils.radToDeg(this.angles.yaw).toFixed(1)}°  PITCH ${THREE.MathUtils.radToDeg(this.angles.pitch).toFixed(1)}°`,
      `MOUSE ${this.input.locked ? (this.input.rawActive ? 'raw' : 'accelerated') : 'free'}`,
    ];
    if (this.tuningModified) lines.push('⚠ physics tuning differs from defaults');
    this.overlay.setDebugText(lines.join('\n'));
  }
}
