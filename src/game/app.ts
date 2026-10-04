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
import { Profile } from './profile';
import { RemotePlayers } from './remotePlayers';
import { formatTime } from './time';
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
import { forwardOf } from '../course/layout';
import { resolveCourseRef } from '../course/courseRef';
import type { ThemeName } from '../course/schema';
import { validateCourse } from '../course/validator';
import { SHIPPED_COURSES } from '../course/courses';
import { Room, RoomJoinError, type RoomPlayer } from '../net/room';
import { MAX_PLAYERS, rankRacers } from '../net/roomLogic';
import type { CourseRef } from '../net/protocol';
import { multiplayerConfigured } from '../net/config';
import type { RoomTransport } from '../net/transport';

/** The Supabase client is only downloaded once someone creates or joins a room. */
async function roomTransport(): Promise<RoomTransport> {
  const { supabaseTransport } = await import('../net/supabase');
  return supabaseTransport();
}
import { Overlay, type LobbyView, type ResultsView, type StandingRow } from '../ui/overlay';
import { Hud, type HudMarker, type HudStanding } from '../ui/hud';

type AppState = 'menu' | 'loading' | 'lobby' | 'countdown' | 'racing' | 'results' | 'spectating';
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
/** Multiplayer: the host announces GO this far ahead, enough for everyone to hear it. */
const ROOM_START_DELAY_MS = 4500;
/** Samples are taken every 5 ticks = 20 Hz. */
const SAMPLE_EVERY_TICKS = 5;

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
  private readonly profile = new Profile();

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

  // Multiplayer.
  private room: Room | null = null;
  private readonly remotes: RemotePlayers;
  /** The room race we're riding (or last saw), so we notice new ones. */
  private roomRaceId: string | null = null;
  /** Real time charged to the multiplayer race clock that the simulation didn't run. */
  private lostMs = 0;
  /** A practice run against the ghosts, inside a room. */
  private practice = false;
  /** Courses build identically for us and the host (else we can only spectate). */
  private roomCourseOk = true;
  private roomCourseKey = '';
  private spectateTarget: string | null = null;
  private lastCountdownShown = 0;
  private standingsAt = 0;
  private finishedInRoom = new Set<string>();

  private readonly player: PlayerState = createPlayer();
  /** Feet position at the previous tick, for render interpolation. */
  private readonly prevPos = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly ghostPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

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
    this.remotes = new RemotePlayers(this.view.scene);
    this.overlay.setDebugVisible(this.debug.showHud);
    this.overlay.setMultiplayerAvailable(multiplayerConfigured());

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
    this.overlay.onLeaveRace = () => this.leaveRoomRace();
    this.bindRoomUi();
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

  private get inRoom(): boolean {
    return this.room !== null;
  }

  /** Riding a shared room race (not a practice run). */
  private get inRoomRace(): boolean {
    return this.inRoom && !this.practice && (this.state === 'countdown' || this.state === 'racing');
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

  /** Build and show any course spec (shipped, random, or later AI-generated). Solo: returns to the menu. */
  loadCourse(spec: unknown, shippedId: string | null = null, toMenu = true): BuiltCourse {
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
    if (toMenu && !this.inRoom) this.goToMenu();
    else {
      this.runtime.reset();
      this.respawnAt(this.built.spawn);
    }
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

  // --- solo flow -------------------------------------------------------------

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

  /** Start (or restart) a solo run. A full start shows the loading screen first. */
  private startRace(kind: StartKind): void {
    this.pendingResults = null;
    this.paused = false;
    this.state = 'loading';
    if (this.inRoom) {
      this.practice = true;
      this.room?.setStatus('practice');
    }
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
    this.resetRun(seconds);
    this.hud.setCountdown(this.session!.countdownNumber);
    this.loop.simulating = this.input.locked;
    if (!this.input.locked) this.pause();
  }

  /** Fresh run state at the start line (solo or room). */
  private resetRun(countdownSeconds: number): void {
    this.runtime.reset();
    this.respawnAt(this.built.spawn);
    const best = this.records.best(this.key);
    this.session = new RaceSession({
      countdownSeconds,
      checkpoints: this.built.checkpoints.length - 1,
      best: best ? { timeMs: best.timeMs, splits: best.splits } : null,
    });
    this.recorder = new GhostRecorder();
    this.recorder.tick(0, this.player.pos, this.angles.yaw);
    this.ghostTicks = 0;
    this.lostMs = 0;
    this.loop.droppedTime = 0;
    this.assisted = this.debug.autopilot || this.debug.noclip;
    this.lastFinish = null;
    this.goShowing = false;
    this.lastCountdownShown = 0;

    this.state = 'countdown';
    this.overlay.show('none');
    this.overlay.setBanner(null);
    this.hud.setVisible(true);
    this.hud.hideSplit();
    this.hud.setTimer(0);
    this.hud.setCheckpoints(0, this.built.checkpoints.length - 1);
    this.hud.setPosition(null);
    this.hud.setStandings(null);
  }

  /** Restart the current run (Shift+R), if one is under way. */
  restartRun(): void {
    if ((this.state === 'countdown' || this.state === 'racing') && !this.inRoomRace) this.startRace('quick');
  }

  private raceAgain(): void {
    this.pendingStart = 'quick';
    this.engage();
  }

  private pause(): void {
    if ((this.state !== 'countdown' && this.state !== 'racing') || this.paused) return;
    this.paused = true;
    this.input.releaseLock();
    if (this.inRoomRace) {
      // A shared race can't stop for one player: keep simulating, just offer the mouse back.
      this.overlay.setPauseMode('room-race');
    } else {
      this.loop.simulating = false;
      this.overlay.setPauseMode('solo');
    }
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
    this.practice = false;
    this.loop.simulating = false;
    this.input.releaseLock();
    this.hud.setVisible(false);
    for (const g of this.ghosts) g.view.hide();
    this.runtime.reset();
    this.respawnAt(this.built.spawn);
    this.overlay.show('start');
  }

  private handleMenuKeys(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (this.state === 'spectating') {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
        this.cycleSpectate(e.code === 'ArrowLeft' ? -1 : 1);
      } else if (e.code === 'Escape' || e.code === 'KeyL') {
        e.preventDefault();
        this.showLobby();
      }
      return;
    }
    if (this.state !== 'results') return;
    const roomRace = this.inRoom && !this.practice;
    if (e.code === 'KeyR' || e.code === 'Enter') {
      e.preventDefault();
      if (roomRace) this.showLobby();
      else this.raceAgain();
    } else if (e.code === 'KeyM' || e.code === 'Escape') {
      e.preventDefault();
      if (this.inRoom) this.showLobby();
      else this.goToMenu();
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

  // --- multiplayer: rooms ------------------------------------------------------

  private bindRoomUi(): void {
    const o = this.overlay;
    o.onCreateRoom = () => void this.createRoom();
    o.onJoinRoom = (code) => void this.joinRoom(code);
    o.onLobbyName = (name) => {
      this.profile.name = name;
      this.room?.setName(this.profile.name);
    };
    o.onLobbyReady = () => {
      const me = this.room?.players.find((p) => p.isMe);
      this.room?.setReady(!me?.ready);
    };
    o.onLobbyCourse = (id) => this.hostPickCourse(id);
    o.onLobbyStart = () => {
      if (this.room?.isHost && this.room.state.phase === 'lobby') this.room.startRace(ROOM_START_DELAY_MS);
    };
    o.onLobbyLeave = () => void this.leaveRoom();
    o.onLobbyCopyLink = () => void this.copyInvite();
    o.onLobbySecondTab = () => {
      void this.copyInvite(false);
      window.open(this.inviteLink(), '_blank', 'noopener');
    };
    o.onLobbyPractice = () => {
      this.pendingStart = 'full';
      this.engage();
    };
    o.onLobbySpectate = () => this.enterSpectate();
    o.onEndRace = () => this.room?.endRace();
    o.onBackToLobby = () => this.showLobby();
  }

  /** Called by main.ts for ?room=CODE links. */
  joinRoomFromUrl(code: string): void {
    if (!multiplayerConfigured()) {
      this.overlay.showStartMessage('Multiplayer is not configured in this build.');
      return;
    }
    void this.joinRoom(code);
  }

  private currentRef(): CourseRef {
    return { kind: 'shipped', id: this.selectedCourseId };
  }

  private async createRoom(): Promise<void> {
    if (this.room) return;
    this.state = 'loading';
    this.overlay.setLoadingText('Creating a room…');
    this.overlay.show('loading');
    try {
      const room = await Room.create({ transport: await roomTransport() }, { id: this.profile.id, name: this.profile.name }, { course: this.currentRef(), courseKey: this.key });
      this.enterRoom(room);
    } catch (err) {
      this.state = 'menu';
      this.overlay.showStartMessage(err instanceof Error ? err.message : 'Could not create a room.');
    }
  }

  private async joinRoom(code: string): Promise<void> {
    if (this.room) return;
    this.state = 'loading';
    this.overlay.setLoadingText(`Joining room ${code.toUpperCase()}…`);
    this.overlay.show('loading');
    try {
      const room = await Room.join({ transport: await roomTransport() }, code, { id: this.profile.id, name: this.profile.name });
      this.enterRoom(room);
    } catch (err) {
      this.state = 'menu';
      setUrlRoom(null);
      const message = err instanceof RoomJoinError ? err.message : 'Could not join that room.';
      this.overlay.showStartMessage(err instanceof RoomJoinError && err.kind === 'not-found' ? `${message} Create one instead?` : message);
    }
  }

  private enterRoom(room: Room): void {
    this.room = room;
    this.roomRaceId = room.state.raceId; // a race already running isn't ours to join
    this.finishedInRoom.clear();
    room.onChange = () => this.onRoomChange();
    room.onFinish = (p, r) => {
      this.hud.pushFeed(`${p.isMe ? 'You' : p.name} finished — ${formatTime(r.timeMs)}`);
      this.finishedInRoom.add(p.id);
    };
    room.onPlayerLeft = (p) => {
      if (this.state === 'lobby') this.overlay.toast(`${p.name} left`);
      else this.hud.pushFeed(`${p.name} left`);
    };
    room.onConnection = (status) =>
      this.overlay.setBanner(status === 'connected' ? null : status === 'reconnecting' ? 'Connection lost — reconnecting…' : 'Disconnected from the room');
    setUrlRoom(room.code);
    this.remotes.sync(room.players);
    this.loadRoomCourse();
    if (room.state.phase === 'racing') this.enterSpectate();
    else this.showLobby();
  }

  private async leaveRoom(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.room = null;
    this.practice = false;
    this.remotes.dispose();
    this.overlay.setBanner(null);
    this.hud.setStandings(null);
    this.hud.setPosition(null);
    setUrlRoom(null);
    await room.leave();
    this.selectCourse(this.selectedCourseId);
  }

  private inviteLink(): string {
    const url = new URL(window.location.href);
    url.search = '';
    if (this.room) url.searchParams.set('room', this.room.code);
    return url.toString();
  }

  private async copyInvite(toast = true): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLink());
      if (toast) this.overlay.toast('Invite link copied');
    } catch {
      if (toast) this.overlay.toast(this.inviteLink(), 5000);
    }
  }

  private hostPickCourse(id: string): void {
    const room = this.room;
    if (!room?.isHost || room.state.phase !== 'lobby') return;
    const ref: CourseRef = id === 'random' ? { kind: 'random', seed: Math.floor(Math.random() * 1_000_000) } : { kind: 'shipped', id };
    const spec = resolveCourseRef(ref);
    if (!spec) return;
    room.setCourse(ref, courseKey(validateCourse(spec).course));
  }

  /** Build the room's course, and check we build it exactly as the host does. */
  private loadRoomCourse(): void {
    const room = this.room;
    if (!room) return;
    const st = room.state;
    const spec = resolveCourseRef(st.course);
    this.loadCourse(spec ?? null, st.course.kind === 'shipped' ? st.course.id : null, false);
    this.roomCourseKey = st.courseKey;
    this.roomCourseOk = st.courseKey === '' || st.courseKey === this.key;
  }

  private onRoomChange(): void {
    const room = this.room;
    if (!room) return;
    this.remotes.sync(room.players);
    const st = room.state;

    if (st.courseKey !== this.roomCourseKey && !this.inRoomRace && this.state !== 'spectating') this.loadRoomCourse();

    if (st.phase === 'racing' && st.raceId && st.raceId !== this.roomRaceId) {
      this.roomRaceId = st.raceId;
      this.finishedInRoom.clear();
      if (this.roomCourseOk) this.joinRoomRace();
      else this.enterSpectate();
    }

    if (st.phase === 'lobby') {
      if (this.state === 'spectating') this.showLobby();
      else if (this.inRoomRace && this.session?.phase !== 'finished') {
        this.overlay.toast('The host ended the race');
        this.showLobby();
      }
    }

    if (this.state === 'lobby') this.renderLobby();
    if (this.state === 'results' && !this.practice) this.overlay.updateStandings(this.standingRows(), st.phase === 'lobby' || st.raceId !== this.roomRaceId, room.isHost);
  }

  private showLobby(): void {
    const room = this.room;
    if (!room) return;
    this.pendingResults = null;
    this.state = 'lobby';
    this.paused = false;
    this.practice = false;
    this.session = null;
    this.spectateTarget = null;
    this.loop.simulating = false;
    this.input.releaseLock();
    this.hud.setVisible(false);
    this.hud.setStandings(null);
    this.overlay.setBanner(null);
    this.clearGhosts();
    this.remotes.hideAll();
    if (room.state.courseKey !== this.roomCourseKey) this.loadRoomCourse();
    this.runtime.reset();
    this.respawnAt(this.built.spawn);
    room.setStatus('lobby');
    this.renderLobby();
  }

  private renderLobby(): void {
    const room = this.room;
    if (!room) return;
    const st = room.state;
    const me = room.players.find((p) => p.isMe);
    const theme = THEME_DEFS[this.built.course.theme];
    const ready = room.players.filter((p) => p.ready || p.isHost).length;
    const ramps = this.built.segments.filter((s) => s.type === 'ramp').length;
    const selectedId = st.course.kind === 'shipped' ? st.course.id : st.course.kind === 'random' ? 'random' : '';
    const statusLabel = (p: RoomPlayer): string =>
      p.status === 'racing' ? 'racing' : p.status === 'spectating' ? 'watching' : p.status === 'practice' ? 'practising' : p.status === 'finished' ? 'finished' : '';

    const view: LobbyView = {
      code: room.code,
      link: this.inviteLink(),
      players: room.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, isMe: p.isMe, ready: p.ready, status: statusLabel(p) })),
      maxPlayers: MAX_PLAYERS,
      isHost: room.isHost,
      myName: me?.name ?? this.profile.name,
      myReady: me?.ready ?? false,
      course: {
        name: this.built.course.name,
        difficulty: this.built.course.difficulty,
        theme: theme.label,
        swatch: theme.swatch,
        bestMs: this.records.best(this.key)?.timeMs ?? null,
        detail: `${ramps} ramps · ${this.built.checkpoints.length - 1} checkpoints`,
      },
      courseChoices: [...SHIPPED_COURSES.map((c) => ({ id: c.id, label: validateCourse(c.spec).course.name })), { id: 'random', label: 'Random course' }].map((c) => ({
        ...c,
        selected: c.id === selectedId,
      })),
      startLabel: ready >= room.players.length ? 'Start race' : `Start race (${ready}/${room.players.length} ready)`,
      canStart: room.isHost && st.phase === 'lobby',
      raceInProgress: st.phase === 'racing',
      warning: this.roomCourseOk ? '' : 'This room was made with a different version of Surf Duel, so you can only watch. Refresh the page to update.',
    };
    this.overlay.showLobby(view);
  }

  /** The host started a race: line up and wait for GO on the shared clock. */
  private joinRoomRace(): void {
    const room = this.room;
    if (!room) return;
    this.practice = false;
    this.pendingResults = null;
    this.clearGhosts(); // only real players in a room race
    if (room.state.courseKey !== this.roomCourseKey) this.loadRoomCourse();
    room.setStatus('racing');
    this.resetRun(999); // GO comes from the room clock, not the countdown
    this.paused = false;
    this.loop.simulating = true; // a shared race never pauses
    this.hud.setCountdown(this.roomCountdownNumber());
    if (!this.input.locked) {
      this.paused = true;
      this.overlay.setPauseMode('room-grab');
      this.overlay.show('pause');
    }
  }

  private leaveRoomRace(): void {
    if (!this.inRoom) return;
    if (this.practice) {
      this.showLobby();
      return;
    }
    this.room?.setStatus('lobby');
    this.showLobby();
  }

  private roomCountdownNumber(): number {
    const startAt = this.room?.localStartAt();
    if (startAt == null) return 3;
    return Math.min(9, Math.max(1, Math.ceil((startAt - Date.now()) / 1000)));
  }

  private enterSpectate(): void {
    const room = this.room;
    if (!room) return;
    this.state = 'spectating';
    this.session = null;
    this.paused = false;
    this.loop.simulating = false;
    this.input.releaseLock();
    this.clearGhosts();
    this.overlay.show('none');
    this.hud.setVisible(true);
    this.hud.hideSplit();
    this.hud.setCountdown(null);
    this.hud.setPosition(null);
    room.setStatus('spectating');
    this.spectateTarget = null;
    this.cycleSpectate(1);
  }

  private racingIds(): Set<string> {
    const room = this.room;
    const ids = new Set<string>();
    if (!room) return ids;
    for (const p of room.players) {
      if (p.status === 'racing' || (p.status === 'finished' && p.result?.raceId === room.state.raceId)) ids.add(p.id);
    }
    return ids;
  }

  private cycleSpectate(dir: number): void {
    const room = this.room;
    if (!room) return;
    const candidates = room.players.filter((p) => !p.isMe && this.racingIds().has(p.id));
    if (candidates.length === 0) {
      this.spectateTarget = null;
      this.overlay.setBanner('Nobody to watch yet · Esc for the lobby');
      return;
    }
    const i = candidates.findIndex((p) => p.id === this.spectateTarget);
    const next = candidates[(i + dir + candidates.length) % candidates.length]!;
    this.spectateTarget = next.id;
    this.overlay.setBanner(`Watching ${next.name} · ←/→ to switch · Esc for the lobby`);
  }

  /** Current race time for the room race (ms since the shared GO). */
  private roomRaceClockMs(alpha = 0): number {
    if (this.session && this.inRoomRace) return (this.ghostTicks + alpha) * (1000 / TICK_RATE) + this.lostMs;
    const startAt = this.room?.localStartAt();
    return startAt == null ? 0 : Date.now() - startAt;
  }

  private standingRows(): StandingRow[] {
    const room = this.room;
    if (!room) return [];
    const raceId = this.roomRaceId;
    const entrants = room.players.filter((p) => p.status === 'racing' || p.result?.raceId === raceId);
    const ranked = rankRacers(
      entrants.map((p) => ({
        id: p.id,
        player: p,
        finishedMs: p.result?.raceId === raceId ? p.result.timeMs : null,
        progress: p.isMe ? this.runtime.progress / Math.max(1, this.built.path.length) : (this.remotes.sampleOf(p.id)?.progress ?? 0),
        left: false,
      })),
    );
    return ranked.map((r, i) => ({
      place: r.finishedMs !== null ? i + 1 : null,
      name: r.player.name,
      color: r.player.color,
      isMe: r.player.isMe,
      timeMs: r.finishedMs,
      status: 'racing…',
    }));
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

    const roomRace = this.inRoomRace;
    if (roomRace && this.room && this.roomRaceId) {
      this.room.reportFinish({ raceId: this.roomRaceId, timeMs: Math.round(result.timeMs), splits: result.splits });
    }

    let note = '';
    let outcome: SaveOutcome | null = null;
    if (this.assisted) note = 'Not saved: autopilot or noclip was used this run.';
    else if (this.tuningModified) note = 'Not saved: physics tuning differs from the defaults (dev panel).';
    else {
      outcome = this.records.save(this.key, {
        timeMs: Math.round(result.timeMs),
        splits: result.splits,
        topSpeed: result.topSpeed,
        ghost: encodeGhost(ghost),
        at: Date.now(),
      });
      this.lastFinish = { timeMs: Math.round(result.timeMs), splits: result.splits, ghost };
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
      canSaveDevGhost: this.devMode && this.courseId !== null && outcome !== null && !roomRace,
      backToLobby: this.inRoom,
      room: roomRace && this.room ? { standings: this.standingRows(), isHost: this.room.isHost, raceOver: this.room.state.phase === 'lobby' } : undefined,
    };

    // Keep sliding on the finish pad for a moment, then show the results.
    // Counted in simulation ticks so pausing in between holds it too.
    this.pendingResults = { view, atTick: this.ghostTicks + Math.round((RESULTS_DELAY_MS / 1000) * TICK_RATE) };
  }

  private showResults(view: ResultsView): void {
    this.pendingResults = null;
    this.state = 'results';
    this.paused = false;
    this.loop.simulating = false;
    this.hud.setVisible(false);
    this.input.releaseLock();
    if (view.room) view.room.standings = this.standingRows();
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
    const roomRace = this.inRoomRace;

    if (this.input.consumePress('KeyR')) {
      if (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) {
        if (!roomRace) {
          this.startRace('quick');
          return;
        }
      } else if (session.phase === 'racing') {
        this.respawn();
        return;
      }
    }
    if (this.devMode && this.input.consumePress('KeyN')) this.debug.noclip = !this.debug.noclip;
    if (this.devMode && this.input.consumePress('KeyB')) this.debug.autopilot = !this.debug.autopilot;
    if (this.debug.noclip || this.debug.autopilot) this.assisted = true;

    // Solo counts down in ticks; a room race goes on the shared wall clock.
    let events = session.phase === 'countdown' && roomRace ? [] : session.tick();
    if (session.phase === 'countdown' && roomRace) {
      const startAt = this.room?.localStartAt();
      const now = Date.now();
      if (startAt != null && now >= startAt) {
        events = session.startRacing(now - startAt);
        this.lostMs = now - startAt;
      } else {
        const n = this.roomCountdownNumber();
        if (n !== this.lastCountdownShown) {
          this.lastCountdownShown = n;
          this.hud.setCountdown(n);
        }
      }
    }
    for (const e of events) {
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
    if (roomRace && this.room && this.roomRaceId && this.ghostTicks % SAMPLE_EVERY_TICKS === 0) {
      this.room.queueSample(this.roomRaceId, this.roomRaceClockMs(), this.player.pos, this.player.vel, this.angles.yaw);
    }
    if (this.pendingResults && this.ghostTicks >= this.pendingResults.atTick) this.showResults(this.pendingResults.view);
  }

  // --- rendering -------------------------------------------------------------

  private render(alpha: number, frameDt: number): void {
    this.room?.update();

    // Multiplayer: real time the simulation missed (hidden tab, hitch) still counts.
    if (this.inRoomRace && this.session?.phase === 'racing' && this.loop.droppedTime > 0) {
      const ms = this.loop.droppedTime * 1000;
      this.session.addLostTime(ms);
      this.lostMs += ms;
    }
    this.loop.droppedTime = 0;

    const cam = this.view.camera;
    if (this.state === 'spectating') {
      this.renderSpectator();
    } else {
      this.camPos.lerpVectors(this.prevPos, this.player.pos, alpha);
      this.camPos.y += EYE_HEIGHT;
      cam.position.copy(this.camPos);
      cam.rotation.set(this.angles.pitch, this.angles.yaw, 0);
      const racing = this.session !== null && (this.state === 'countdown' || this.state === 'racing');
      if (racing) this.updateGhostsAndHud(alpha);
    }
    this.view.render();
    this.updateStats(frameDt);
  }

  private renderRemotes(raceTimeMs: number): void {
    const room = this.room;
    if (!room) return;
    this.remotes.render(room, raceTimeMs - room.interpDelayMs, this.camPos, this.built.path, this.racingIds());
  }

  private renderSpectator(): void {
    const room = this.room;
    const cam = this.view.camera;
    if (!room) return;
    const clock = this.roomRaceClockMs();
    this.renderRemotes(clock);
    const target = this.spectateTarget ? this.remotes.sampleOf(this.spectateTarget) : null;
    if (!target && this.spectateTarget === null) this.cycleSpectate(1);
    if (target) {
      // Chase cam: behind and above, looking at the rider.
      forwardOf(target.yaw, this.tmp);
      this.camPos.copy(target.pos).addScaledVector(this.tmp, -260);
      this.camPos.y += 150;
      cam.position.lerp(this.camPos, 0.25);
      cam.lookAt(target.pos.x, target.pos.y + 50, target.pos.z);
    }
    this.hud.setTimer(Math.max(0, clock));
    this.updateRoomStandings(true);
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

    if (this.inRoomRace) {
      this.renderRemotes(session.phase === 'countdown' ? 0 : this.roomRaceClockMs(live ? alpha : 0));
      for (const p of this.room?.players ?? []) {
        const s = p.isMe ? null : this.remotes.sampleOf(p.id);
        if (s) markers.push({ label: p.name.slice(0, 3).toUpperCase(), color: p.color, progress: s.progress });
      }
      this.updateRoomStandings(false);
    }

    if (session.phase !== 'finished') this.hud.setTimer(session.elapsedMs);
    this.hud.setSpeed(Math.hypot(this.player.vel.x, this.player.vel.z));
    this.hud.setProgress(this.runtime.progress / Math.max(1, path.length), markers);
    if (this.goShowing && session.phase !== 'countdown' && this.ghostTicks * (1000 / TICK_RATE) > GO_FLASH_MS) {
      this.hud.setCountdown(null);
      this.goShowing = false;
    }
  }

  /** Live standings panel and "P2 / 4", at ~8 Hz. */
  private updateRoomStandings(spectating: boolean): void {
    const now = performance.now();
    if (now - this.standingsAt < 120) return;
    this.standingsAt = now;
    const rows = this.standingRows();
    const standings: HudStanding[] = rows.map((r, i) => ({
      place: i + 1,
      name: r.name,
      color: r.color,
      isMe: r.isMe,
      text: r.timeMs !== null ? formatTime(r.timeMs) : '',
    }));
    this.hud.setStandings(standings.length > 0 ? standings : null);
    const myPlace = rows.findIndex((r) => r.isMe);
    this.hud.setPosition(!spectating && myPlace >= 0 && rows.length > 1 ? `P${myPlace + 1} / ${rows.length}` : null);
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
    const room = this.room;
    if (room) {
      lines.push(
        `ROOM  ${room.code} · ${room.players.length}p · ${room.isHost ? 'host' : 'guest'} · ${room.state.phase} · offset ${room.clock.offset?.toFixed(0) ?? '?'}ms rtt ${Number.isFinite(room.clock.rtt) ? room.clock.rtt.toFixed(0) : '?'}ms · delay ${room.interpDelayMs.toFixed(0)}ms`,
      );
    }
    if (this.tuningModified) lines.push('⚠ physics tuning differs from defaults');
    this.overlay.setDebugText(lines.join('\n'));
  }
}

/** Keep ?room=CODE in the address bar so a refresh rejoins and the link can be shared. */
function setUrlRoom(code: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Not fatal: the in-lobby copy-link button still works.
  }
}
