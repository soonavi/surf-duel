import * as THREE from 'three';
import { FixedStepLoop } from './loop';
import { Input } from './input';
import { loadSettings, saveSettings, type Settings } from './settings';
import { applyMouseLook, wrapAngle, type ViewAngles } from './view';
import { noclipStep } from './noclip';
import { EYE_HEIGHT, TICK_RATE, physics } from '../physics/constants';
import { BvhWorld, mergeCollisionGeometry, type CollisionWorld } from '../physics/collision';
import { createPlayer, stepPlayer, type PlayerState } from '../physics/player';
import { SceneView } from '../render/scene';
import { buildTestLevel } from '../course/testLevel';
import { Overlay } from '../ui/overlay';

type AppState = 'start' | 'playing' | 'paused';

/** Dev-only knobs, exposed in the tuning panel. */
export interface DebugOptions {
  showHud: boolean;
  noclip: boolean;
  flySpeed: number;
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
  private readonly world: CollisionWorld;
  private readonly spawn: THREE.Vector3;
  private readonly killY: number;

  private readonly player: PlayerState;
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
  ) {
    this.debug = { showHud: devMode, noclip: false, flySpeed: 900 };
    this.view = new SceneView(root);
    this.view.setFov(this.settings.fov);
    this.input = new Input(this.view.canvas);
    this.overlay = new Overlay(document.body);
    this.overlay.setDebugVisible(this.debug.showHud);

    const level = buildTestLevel();
    this.view.scene.add(level.group);
    this.world = new BvhWorld(mergeCollisionGeometry(level.group));
    this.spawn = level.spawn;
    this.killY = level.killY;
    this.player = createPlayer(this.spawn);
    this.respawn();

    this.loop = new FixedStepLoop({
      beginFrame: (steps) => this.beginFrame(steps),
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
    this.player.pos.copy(this.spawn);
    this.player.vel.set(0, 0, 0);
    this.player.onGround = false;
    this.prevPos.copy(this.player.pos);
    this.angles = { yaw: 0, pitch: THREE.MathUtils.degToRad(-10) };
    this.yawFrom = this.angles.yaw;
    this.yawDelta = 0;
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
      this.respawn();
      return;
    }
    if (this.devMode && this.input.consumePress('KeyN')) this.debug.noclip = !this.debug.noclip;

    const key = (code: string): number => (this.input.isDown(code) ? 1 : 0);
    const forward = key('KeyW') - key('KeyS');
    const side = key('KeyD') - key('KeyA');
    this.prevPos.copy(this.player.pos);

    if (this.debug.noclip) {
      noclipStep(
        this.player.pos,
        { yaw, pitch: this.angles.pitch },
        { forward, right: side, up: key('Space') - key('KeyC'), fast: this.input.isDown('ShiftLeft') },
        this.debug.flySpeed,
        dt,
      );
      this.player.vel.set(0, 0, 0);
      this.player.onGround = false;
      return;
    }

    stepPlayer(this.player, { forward, side, jump: this.input.isDown('Space'), yaw }, physics, this.world, dt);
    if (this.player.pos.y < this.killY) this.respawn();
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
    const lines = [
      `FPS   ${this.fps.toFixed(0)}`,
      `TICK  ${this.tps.toFixed(0)} / ${TICK_RATE} Hz${this.loop.simulating ? '' : ' (paused)'}`,
      `STATE ${moveState}`,
      `SPEED ${Math.hypot(vel.x, vel.z).toFixed(0)} h · ${vel.length().toFixed(0)} total u/s`,
      `VEL   ${vel.x.toFixed(0)}, ${vel.y.toFixed(0)}, ${vel.z.toFixed(0)}`,
      `POS   ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`,
      `YAW   ${THREE.MathUtils.radToDeg(this.angles.yaw).toFixed(1)}°  PITCH ${THREE.MathUtils.radToDeg(this.angles.pitch).toFixed(1)}°`,
      `MOUSE ${this.input.locked ? (this.input.rawActive ? 'raw' : 'accelerated') : 'free'}`,
    ];
    if (this.tuningModified) lines.push('⚠ physics tuning differs from defaults');
    this.overlay.setDebugText(lines.join('\n'));
  }
}
