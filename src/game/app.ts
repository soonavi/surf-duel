import * as THREE from 'three';
import { FixedStepLoop } from './loop.js';
import { Input } from './input.js';
import { loadSettings, saveSettings, settingsFromOtherWindow, wantsMusicFile, type Settings } from './settings.js';
import { applyMouseLook, wrapAngle, type ViewAngles } from './view.js';
import { noclipStep } from './noclip.js';
import { RaceSession } from './race.js';
import { GhostRecorder, decodeGhost, encodeGhost, sampleGhost, type GhostData } from './ghost.js';
import { RecordStore, type SaveOutcome } from './records.js';
import { recordBotGhost, shippedDevGhost, type GhostRun } from './devGhosts.js';
import type { DevGhostFile } from './devGhostFile.js';
import { Profile } from './profile.js';
import { RemotePlayers } from './remotePlayers.js';
import { formatTime } from './time.js';
import { TutorialCoach, coachCourseFrom, type CoachEvent, type CoachKeys } from './tutorialCoach.js';
import { EYE_HEIGHT, TICK_RATE, physics } from '../physics/constants.js';
import { BvhWorld } from '../physics/collision.js';
import { createPlayer, stepPlayer, type MoveCmd, type PlayerState } from '../physics/player.js';
import { SceneView } from '../render/scene.js';
import { CourseView } from '../render/courseView.js';
import { GhostView } from '../render/ghostView.js';
import { THEME_DEFS, type Theme } from '../render/themes.js';
import { courseTheme, themeLabel } from '../render/palette.js';
import { buildCourse, type BuiltCourse, type SpawnPoint } from '../course/builder.js';
import { CourseRuntime, placeAtSpawn, type CourseEvent } from '../course/runtime.js';
import { SurfBot } from '../course/bot.js';
import { courseKey } from '../course/courseKey.js';
import { forwardOf } from '../course/layout.js';
import { resolveCourseRef } from '../course/courseRef.js';
import type { Course, Difficulty, ThemeName } from '../course/schema.js';
import { validateCourse } from '../course/validator.js';
import { SHIPPED_COURSES } from '../course/courses/index.js';
import { randomCourse } from '../course/random.js';
import { normalizeShareCode } from '../course/shareCode.js';
import { Room, RoomJoinError, type RoomPlayer } from '../net/room.js';
import { MAX_PLAYERS, rankRacers } from '../net/roomLogic.js';
import type { CourseRef } from '../net/protocol.js';
import { multiplayerConfigured } from '../net/config.js';
import { fetchSharedCourse, requestCourse } from '../net/courseApi.js';
import { LikedCourses, POPULAR_SIZE, fetchPopular, sendLike, type PopularCourse } from '../net/likesApi.js';
import { BOARD_SIZE, fetchLeaderboard, fetchRunGhost, submitRun, type BoardEntry, type BoardRef, type SubmitPayload } from '../net/leaderboardApi.js';
import type { RoomTransport } from '../net/transport.js';

/** The Supabase client is only downloaded once someone creates or joins a room. */
async function roomTransport(): Promise<RoomTransport> {
  const { supabaseTransport } = await import('../net/supabase.js');
  return supabaseTransport();
}
import { Overlay, type OverlayScreen, type BoardView, type CourseCard, type LobbyView, type PopularView, type ResultsBoardView, type ResultsView, type StandingRow } from '../ui/overlay.js';
import type { LikeView } from '../ui/likeButton.js';
import { Hud, type HudMarker, type HudStanding } from '../ui/hud.js';
import { GeneratorUi } from '../ui/generator.js';
import { flyoverFade, flyoverPose } from '../render/flyover.js';
import { BEAT_PULSE } from '../render/materials.js';
import { COVER_HEIGHT, COVER_WIDTH, buildCoverRider, coverShot, drawCoverTitle, type CoverShot } from '../render/cover.js';
import { AudioEngine, MAX_MUSIC_FILE_MB } from '../audio/engine.js';
import { assistCommand, assistedPhysics } from './assist.js';
import { approachRoll, speedFov, speedLines } from './feel.js';
import { SpeedLines } from '../render/speedLines.js';
import { ParticleBurst } from '../render/particles.js';
import { speedIntensity } from '../audio/levels.js';
import { hashString } from '../util/rng.js';
import { SettingsUi } from '../ui/settingsPanel.js';
import { drawEqualizer } from '../ui/equalizer.js';

type AppState = 'menu' | 'loading' | 'lobby' | 'countdown' | 'racing' | 'results' | 'spectating' | 'generate' | 'preview' | 'cover';
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
  /** Your best, the course's rival (dev ghost or bot), or a leaderboard run you picked. */
  kind: 'pb' | 'rival' | 'board';
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
const BOARD_COLOR = '#ff8bd1';
/** Leaderboard rows on the start screen, a podium (the results screen shows BOARD_SIZE). */
const HOME_BOARD_ROWS = 3;
/** A fetched leaderboard is reused for this long before asking again. */
const BOARD_FRESH_MS = 30_000;
/** Longest the loading screen waits for a leaderboard ghost before racing without it. */
const GHOST_WAIT_MS = 6_000;
/** Multiplayer: the host announces GO this far ahead, enough for everyone to hear it. */
const ROOM_START_DELAY_MS = 4500;
/** Samples are taken every 5 ticks = 20 Hz. */
const SAMPLE_EVERY_TICKS = 5;
/** The shipped course that gets the on-screen coach. */
const TUTORIAL_ID = 'tutorial';
/** Course-card id for the AI-generated, shared or random course you have loaded. */
const CUSTOM_ID = 'custom';

/** A course from outside the shipped set: generated by AI, loaded by share code, or random. */
interface CustomCourse {
  course: Course;
  source: 'ai' | 'shared' | 'random';
  code: string | null;
  prompt: string | null;
  /** Random courses travel to rooms as just their seed. */
  seed: number | null;
}
const NO_KEYS: CoachKeys = { w: false, a: false, s: false, d: false, space: false };
/** The home screen's Popular list is fetched again after this long. */
const POPULAR_FRESH_MS = 60_000;
/** The start screen's background flyover runs at this fraction of the preview's speed. */
const MENU_FLYOVER_PACE = 0.55;

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
  /** The look in use: the course's theme in its own colours (or the dev panel's override). */
  private theme!: Theme;
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
  /** On-screen coach, on the Tutorial only. */
  private coach: TutorialCoach | null = null;
  /** Keys driving the rider this tick (the bot's, under autopilot), for the coach's key display. */
  private coachKeys: CoachKeys = NO_KEYS;
  /** Things the coach should hear about that aren't course events (pressing R). */
  private coachEvents: CoachEvent[] = [];

  // AI course generator.
  private readonly generator = new GeneratorUi();
  private custom: CustomCourse | null = null;
  /** Who the generator is for: you (back to the menu) or the room you host (back to the lobby). */
  private generatorFor: 'solo' | 'room' = 'solo';

  // Likes and the Popular list.
  private readonly liked = new LikedCourses();
  /** Like counts by share code, as last heard from the database. */
  private readonly likeCounts = new Map<string, number>();
  private likeBusy = false;
  private popular: PopularCourse[] = [];
  private popularState: PopularView['state'] = 'loading';
  private popularAt = -Infinity;
  /** Bumped per request, so a reply that arrives after you've moved on is ignored. */
  private generateRequest = 0;
  private flyoverStart = 0;
  private readonly flyTarget = new THREE.Vector3();
  /** Dims the 3D view through the flyover's loop seam (a cut from the finish back to the start). */
  private readonly sceneFade: HTMLElement;
  private sceneFadeOpacity = 0;

  /** The cover capture's shot and title canvas (/?capture=cover). */
  private cover: { shot: CoverShot; title: HTMLCanvasElement } | null = null;

  /** No mouse to race with: watch, browse leaderboards and design courses only. */
  private readonly viewOnly = Input.touchOnly || !Input.pointerLockSupported;

  // Game feel.
  private fovNow = 75;
  private roll = 0;
  private readonly speedLinesFx: SpeedLines;
  private readonly burst: ParticleBurst;
  /** Assist mode was on at some point during this run. */
  private usedAssist = false;

  // Sound and settings.
  private readonly audio = new AudioEngine();
  private readonly settingsUi: SettingsUi;
  /** The screen to go back to when settings close. */
  private settingsReturn: OverlayScreen = 'start';
  private musicFileProblem = '';
  private readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Leaderboards.
  /** How the server finds the loaded course; null for courses without a board (random ones). */
  private boardRef: BoardRef | null = null;
  /** Fetched leaderboards by course key; entries null when the fetch failed. */
  private readonly boards = new Map<string, { at: number; entries: BoardEntry[] | null }>();
  /** The leaderboard ghost picked to race on this course; `run` is filled in once it has loaded. */
  private boardTarget: { key: string; entry: BoardEntry; run: GhostRun | null; ready: Promise<GhostRun | null> } | null = null;
  /** Course keys whose best was posted this session. */
  private readonly posted = new Set<string>();
  /** The last run posted, and on which course (re-posted under a new name if you change it). */
  private lastPost: { key: string; payload: SubmitPayload } | null = null;
  /** The results screen's leaderboard section while it's up (posting finishes after it appears). */
  private resultsBoard: { key: string; status: string; postingAs: string | null } | null = null;

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
    this.sceneFade = document.createElement('div');
    this.sceneFade.className = 'scene-fade';
    root.appendChild(this.sceneFade);
    this.view.setFov(this.settings.fov);
    this.view.setQuality(this.settings.graphics);
    this.fovNow = this.settings.fov;
    this.speedLinesFx = new SpeedLines(root);
    this.burst = new ParticleBurst(this.view.scene);
    this.input = new Input(this.view.canvas);
    this.overlay = new Overlay(document.body);
    this.hud = new Hud(document.body);
    this.remotes = new RemotePlayers(this.view.scene);
    this.overlay.setDebugVisible(this.debug.showHud);
    this.overlay.setMultiplayerAvailable(multiplayerConfigured());

    this.settingsUi = new SettingsUi(this.settings);
    this.overlay.registerScreen('settings', this.settingsUi.screen);
    this.settingsUi.onChange = (key) => {
      // Picking "My music" with no file yet opens the file picker (still inside the click).
      if (wantsMusicFile(key, this.settings, this.audio.hasFile)) this.settingsUi.pickFile();
      this.applySettings();
    };
    this.settingsUi.onPickMusicFile = (file) => void this.useMusicFile(file);
    // Every open game window plays its own music: follow settings changed in another one.
    window.addEventListener('storage', (e) => {
      const changed = settingsFromOtherWindow(e.key, e.newValue);
      if (!changed) return;
      Object.assign(this.settings, changed);
      this.applySettings(false);
    });
    this.settingsUi.onBack = () => this.closeSettings();
    this.overlay.onOpenSettings = () => this.openSettings();
    // Browsers only allow sound after a user gesture: start it on the first one.
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    this.hud.onCountdown = (value) => this.audio.countdown(value === 'GO' ? 0 : value);
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
    this.audio.setSource(this.settings.music === 'off' ? 'off' : 'generated');

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
    this.overlay.onOpenGenerator = () => this.openGenerator('solo');
    this.bindGenerator();
    this.overlay.onRestart = () => this.raceAgain();
    this.overlay.onRaceAgain = () => this.raceAgain();
    this.overlay.onMenu = () => this.goToMenu();
    this.overlay.onSaveDevGhost = () => void this.saveDevGhost();
    this.overlay.onLeaveRace = () => this.leaveRoomRace();
    this.overlay.onBoardPick = (runId) => this.pickBoardGhost(runId);
    this.overlay.onBoardRace = (runId) => this.raceBoardGhost(runId);
    this.overlay.onChangeName = (name) => this.changeName(name);
    this.overlay.onLike = () => void this.toggleLike();
    this.overlay.onPopularPick = (code) => this.pickPopular(code);
    this.bindRoomUi();
    this.input.onLockChange = (locked) => this.handleLockChange(locked);

    window.addEventListener('resize', () => this.view.resize());
    window.addEventListener('keydown', (e) => this.handleMenuKeys(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });

    // Phones and tablets (or browsers without pointer lock) get everything but racing.
    if (this.viewOnly) this.overlay.setViewOnly();
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
    if (id === CUSTOM_ID && this.custom) {
      this.selectedCourseId = id;
      this.overlay.setSelectedCourse(id);
      this.loadCourse(this.custom.course, null, true, this.custom.code);
      if (!this.inRoom) setUrlCourse(this.custom.code);
      return;
    }
    const shipped = SHIPPED_COURSES.find((c) => c.id === id);
    if (!shipped) return;
    this.selectedCourseId = id;
    this.overlay.setSelectedCourse(id);
    this.loadCourse(shipped.spec, id);
    if (!this.inRoom) setUrlCourse(null);
  }

  /**
   * Build and show any course spec (shipped, random, AI or shared). Solo: returns to the menu.
   * `code` is a shared course's share code: with it (or a shipped id) the course has a leaderboard.
   */
  loadCourse(spec: unknown, shippedId: string | null = null, toMenu = true, code: string | null = null): BuiltCourse {
    const built = buildCourse(spec);
    if (built.repairs.length > 0 && this.devMode) console.info('[surf-duel] course repaired:', built.repairs);
    this.built = built;
    this.key = courseKey(built.course);
    this.courseId = shippedId;
    this.boardRef = shippedId ? { kind: 'shipped', id: shippedId } : code ? { kind: 'code', code } : null;
    if (this.boardTarget && this.boardTarget.key !== this.key) this.setBoardTarget(null);
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
    const theme = this.debug.themeOverride === 'auto' ? courseTheme(this.built.course) : THEME_DEFS[this.debug.themeOverride];
    this.theme = theme;
    this.courseView?.dispose();
    this.courseView = new CourseView(this.built, theme);
    this.view.scene.add(this.courseView.group);
    this.view.applyTheme(theme);
    this.hud.coach.setRampColors(theme.rampRight.ui, theme.rampLeft.ui);
    this.overlay.setRampColors(theme.rampRight.ui, theme.rampLeft.ui);
    // Every course gets its own tune in its theme's mood; the same course always sounds the same.
    this.audio.playSong(this.debug.themeOverride === 'auto' ? this.built.course.theme : this.debug.themeOverride, hashString(this.key));
  }

  private refreshCourseCards(): void {
    const cards: CourseCard[] = SHIPPED_COURSES.map((c) => {
      const spec = validateCourse(c.spec).course;
      return {
        id: c.id,
        name: spec.name,
        difficulty: spec.difficulty,
        meta: themeLabel(spec),
        blurb: c.blurb,
        swatch: courseTheme(spec).swatch,
        bestMs: this.records.best(courseKey(spec))?.timeMs ?? null,
        badge: null,
      };
    });
    const custom = this.custom;
    if (custom) {
      const label = custom.source === 'ai' ? 'AI course' : custom.source === 'shared' ? 'Shared course' : 'Random course';
      const likes = custom.code ? this.likeCounts.get(custom.code) : undefined;
      cards.push({
        id: CUSTOM_ID,
        name: custom.course.name,
        difficulty: custom.course.difficulty,
        meta: [themeLabel(custom.course), label, custom.code, likes === undefined ? null : `👍 ${likes}`].filter(Boolean).join(' · '),
        blurb: custom.prompt ? `“${custom.prompt}”` : 'Made from a random seed.',
        swatch: courseTheme(custom.course).swatch,
        bestMs: this.records.best(courseKey(custom.course))?.timeMs ?? null,
        badge: null,
      });
    }
    // First time here (no finished runs anywhere): point at the Tutorial.
    const tutorial = cards.find((c) => c.id === TUTORIAL_ID);
    if (tutorial && cards.every((c) => c.bestMs === null)) tutorial.badge = 'Start here';
    this.overlay.setCourses(cards, this.selectedCourseId);
  }

  // --- likes and the Popular list ----------------------------------------------

  /** The share code of the course loaded now, if it has one (only shared courses can be liked). */
  private currentCode(): string | null {
    return this.boardRef?.kind === 'code' ? this.boardRef.code : null;
  }

  private likeView(): LikeView | null {
    const code = this.currentCode();
    if (!code || !multiplayerConfigured()) return null;
    return { liked: this.liked.has(code), likes: this.likeCounts.get(code) ?? null, busy: this.likeBusy };
  }

  private renderLike(): void {
    const view = this.likeView();
    if (view) {
      this.overlay.setLike(view);
      this.generator.setLike(view);
    }
  }

  /** Thumbs up (or take it back) on the loaded course: shown at once, then settled by the server's count. */
  private async toggleLike(): Promise<void> {
    const code = this.currentCode();
    if (!code || this.likeBusy) return;
    const want = !this.liked.has(code);
    const before = this.likeCounts.get(code);
    this.likeBusy = true;
    this.liked.set(code, want);
    if (before !== undefined) this.likeCounts.set(code, Math.max(0, before + (want ? 1 : -1)));
    this.renderLike();
    const out = await sendLike(code, this.profile.boardId, want);
    this.likeBusy = false;
    if (out.ok) {
      this.liked.set(code, out.liked);
      this.likeCounts.set(code, out.likes);
      this.popularAt = -Infinity; // the order may have changed
    } else {
      this.liked.set(code, !want);
      if (before !== undefined) this.likeCounts.set(code, before);
      else this.likeCounts.delete(code);
      this.overlay.toast(out.message, 3000);
    }
    this.renderLike();
    this.refreshCourseCards();
  }

  /** The home screen's Popular list, fetched again when stale. */
  private refreshPopular(): void {
    if (!multiplayerConfigured()) {
      this.overlay.setPopular({ state: 'none', rows: [] });
      return;
    }
    this.renderPopular();
    if (performance.now() - this.popularAt < POPULAR_FRESH_MS) return;
    this.popularAt = performance.now();
    void fetchPopular(POPULAR_SIZE).then((out) => {
      if (out.ok) {
        this.popular = out.courses;
        this.popularState = 'ready';
        for (const c of out.courses) this.likeCounts.set(c.code, c.likes);
      } else {
        this.popularAt = -Infinity;
        if (this.popular.length === 0) this.popularState = 'unavailable';
      }
      this.renderPopular();
      if (this.state === 'menu') this.refreshCourseCards();
    });
  }

  private renderPopular(): void {
    this.overlay.setPopular({
      state: this.popularState,
      rows: this.popular.map((p) => ({
        code: p.code,
        name: p.course.name,
        difficulty: p.course.difficulty,
        swatch: courseTheme(p.course).swatch,
        likes: this.likeCounts.get(p.code) ?? p.likes,
        prompt: p.prompt,
        liked: this.liked.has(p.code),
        selected: this.selectedCourseId === CUSTOM_ID && this.custom?.code === p.code,
      })),
    });
  }

  /** Load a Popular course as your custom course, right here on the home screen. */
  private pickPopular(code: string): void {
    const pick = this.popular.find((p) => p.code === code);
    if (!pick || this.state !== 'menu') return;
    this.custom = { course: pick.course, source: 'shared', code: pick.code, prompt: pick.prompt, seed: null };
    this.refreshCourseCards();
    this.selectCourse(CUSTOM_ID);
  }

  /** Arrow keys on the start screen: pick the previous/next course card. */
  private stepCourse(delta: number): void {
    const ids = this.overlay.courseIds();
    if (ids.length === 0) return;
    const at = Math.max(0, ids.indexOf(this.selectedCourseId));
    const next = ids[(at + delta + ids.length) % ids.length]!;
    if (next !== this.selectedCourseId) this.selectCourse(next);
  }

  private checkpointFractions(): number[] {
    const path = this.built.path;
    return this.built.triggers
      .filter((t) => t.kind === 'checkpoint')
      .map((t) => path.relocate(t.center).s / Math.max(1, path.length));
  }

  // --- settings & dev --------------------------------------------------------

  /** Push changed settings into the renderer and audio, and persist them (unless they came from storage). */
  applySettings(save = true): void {
    this.fovNow = this.settings.fov;
    this.view.setFov(this.settings.fov);
    this.view.setQuality(this.settings.graphics);
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
    // "My music" with no file picked this visit plays the generated music until one is.
    this.audio.setSource(this.settings.music === 'file' && !this.audio.hasFile ? 'generated' : this.settings.music);
    if (save) saveSettings(this.settings);
    this.settingsUi?.refresh(this.audio.fileName, this.musicFileProblem);
  }

  private openSettings(): void {
    if (this.overlay.screen !== 'settings') this.settingsReturn = this.overlay.screen;
    this.settingsUi.refresh(this.audio.fileName, this.musicFileProblem);
    this.overlay.show('settings');
  }

  private closeSettings(): void {
    this.overlay.show(this.settingsReturn === 'none' ? 'start' : this.settingsReturn);
  }

  /** The player's own music: played from their disk, never uploaded. */
  private async useMusicFile(file: File): Promise<void> {
    const ok = await this.audio.loadFile(file);
    this.musicFileProblem = ok ? '' : `Couldn't play that file. Try an MP3, OGG, WAV or M4A under ${MAX_MUSIC_FILE_MB} MB.`;
    if (ok) this.settings.music = 'file';
    else if (!this.audio.hasFile && this.settings.music === 'file') this.settings.music = 'generated';
    this.applySettings();
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
    if (this.viewOnly) return;
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
      const target = this.boardTarget?.key === this.key && this.boardTarget.run === null ? this.boardTarget : null;
      this.overlay.setLoadingText(
        target ? `Fetching ${target.entry.name}'s ghost…` : this.rivalCache.has(this.key) ? 'Get ready…' : 'Warming up your rival ghost…',
      );
      this.overlay.show('loading');
      // Let the loading screen paint before the (brief) synchronous work.
      const go = (): void => void window.setTimeout(() => this.beginCountdown(COUNTDOWN_FULL), 30);
      if (target) void Promise.race([target.ready, new Promise((resolve) => window.setTimeout(resolve, GHOST_WAIT_MS))]).finally(go);
      else go();
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
    this.usedAssist = this.settings.assist;
    this.hud.setAssist(this.settings.assist);
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

    this.coach = this.courseId === TUTORIAL_ID ? new TutorialCoach(coachCourseFrom(this.built.pieces)) : null;
    this.coachEvents = [];
    this.coachKeys = NO_KEYS;
    this.hud.coach.setVisible(this.coach !== null);
    this.hud.coach.render(null, null, null, null, NO_KEYS);
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
    this.flyoverStart = performance.now();
    this.overlay.show('start');
    this.refreshHomeBoard();
    this.refreshPopular();
  }

  private handleMenuKeys(e: KeyboardEvent): void {
    if (this.overlay.screen === 'settings' && e.code === 'Escape') {
      e.preventDefault();
      this.closeSettings();
      return;
    }
    if (this.state === 'menu' && this.overlay.screen === 'start' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      this.stepCourse(e.code === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.repeat) return;
    if ((this.state === 'generate' || this.state === 'preview') && e.code === 'Escape') {
      e.preventDefault();
      this.leaveGenerator();
      return;
    }
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

  // --- leaderboards ------------------------------------------------------------

  /** The start screen's top times for the selected course, fetched again when stale. */
  private refreshHomeBoard(): void {
    const key = this.key;
    const name = this.built.course.name;
    if (!this.boardRef || !multiplayerConfigured()) {
      const note = !this.boardRef ? 'Random courses have no leaderboard. Make one with AI to get one!' : 'Leaderboards are offline in this build.';
      this.overlay.setHomeBoard({ state: 'none', rows: [], note }, name);
      return;
    }
    const cached = this.boards.get(key);
    this.overlay.setHomeBoard(this.boardView(key, HOME_BOARD_ROWS), name);
    if (cached && performance.now() - cached.at < BOARD_FRESH_MS) return;
    void this.loadBoard(key).then(() => {
      if (this.key === key && this.state === 'menu') this.overlay.setHomeBoard(this.boardView(key, HOME_BOARD_ROWS), name);
    });
  }

  private async loadBoard(key: string): Promise<void> {
    const out = await fetchLeaderboard(key, BOARD_SIZE);
    this.boards.set(key, { at: performance.now(), entries: out.ok ? out.entries : (this.boards.get(key)?.entries ?? null) });
  }

  private boardView(key: string, limit: number): BoardView {
    const cached = this.boards.get(key);
    if (!cached) return { state: 'loading', rows: [], note: '' };
    if (cached.entries === null) return { state: 'unavailable', rows: [], note: "Couldn't load the leaderboard." };
    const entries = cached.entries;
    const mine = this.records.boardRunId(key);
    const picked = this.boardTarget?.key === key ? this.boardTarget.entry.id : null;
    const rows = entries.slice(0, limit).map((e) => ({
      id: e.id,
      place: 1 + entries.filter((o) => o.timeMs < e.timeMs).length, // ties share a place
      name: e.name,
      timeMs: e.timeMs,
      isMe: e.id === mine,
      selected: e.id === picked,
      assist: e.assist,
    }));
    return { state: 'ready', rows, note: rows.length === 0 ? 'No times yet: set the first!' : '' };
  }

  /** Start screen: pick a leaderboard run to race its ghost (pick it again to drop it). */
  private pickBoardGhost(runId: string): void {
    if (this.boardTarget?.entry.id === runId) this.setBoardTarget(null);
    else {
      const entry = this.boards.get(this.key)?.entries?.find((e) => e.id === runId);
      if (entry) this.setBoardTarget(entry);
    }
    if (this.state === 'menu') this.overlay.setHomeBoard(this.boardView(this.key, HOME_BOARD_ROWS), this.built.course.name);
  }

  /** Results screen: race a leaderboard ghost right away (this click is the gesture pointer lock needs). */
  private raceBoardGhost(runId: string): void {
    if (this.boardTarget?.entry.id !== runId) {
      const entry = this.boards.get(this.key)?.entries?.find((e) => e.id === runId);
      if (!entry) return;
      this.setBoardTarget(entry);
    }
    this.pendingStart = 'full';
    this.engage();
  }

  private setBoardTarget(entry: BoardEntry | null): void {
    if (!entry) {
      this.boardTarget = null;
      this.overlay.setRaceVs(null);
      return;
    }
    const ready = fetchRunGhost(entry.id).then((g): GhostRun | null =>
      g ? { label: entry.name, timeMs: entry.timeMs, splits: g.splits, ghost: g.ghost } : null,
    );
    const target = { key: this.key, entry, run: null as GhostRun | null, ready };
    this.boardTarget = target;
    this.overlay.setRaceVs(entry.name);
    void ready.then((run) => {
      if (this.boardTarget !== target) return;
      if (run) {
        target.run = run;
        return;
      }
      this.setBoardTarget(null);
      this.overlay.toast("Couldn't load that ghost", 2500);
      if (this.state === 'menu') this.refreshHomeBoard();
    });
  }

  /**
   * After a finish: post the run (or your stored best, if that's faster) to
   * the course's leaderboard when it qualifies. Returns the results screen's
   * leaderboard section, or undefined when the course has no board.
   */
  private postRun(outcome: SaveOutcome | null, splits: readonly (number | null)[]): ResultsBoardView | undefined {
    const key = this.key;
    const ref = this.boardRef;
    if (!ref || !multiplayerConfigured()) return undefined;
    let notPosted = '';
    if (this.assisted) notPosted = 'Not posted: autopilot or noclip was used.';
    else if (this.tuningModified) notPosted = 'Not posted: physics tuning differs from the defaults.';
    else if (this.lostMs > 0) notPosted = 'Not posted: the race clock ran on while the tab was hidden.';
    else if (splits.some((s) => s === null)) notPosted = 'Not posted: you missed a checkpoint.';

    const best = this.records.best(key);
    const payloadFrom = best && best.splits.every((s) => s !== null) ? best : null;
    const shouldPost = notPosted === '' && payloadFrom !== null && (outcome?.isBest === true || !this.posted.has(key));
    this.resultsBoard = {
      key,
      status: notPosted || (shouldPost ? 'Posting your time…' : 'Your best is on the leaderboard.'),
      postingAs: notPosted ? null : this.profile.name,
    };
    if (shouldPost && payloadFrom) {
      const payload: SubmitPayload = {
        course: ref,
        playerId: this.profile.boardId,
        name: this.profile.name,
        timeMs: payloadFrom.timeMs,
        splits: payloadFrom.splits,
        ghost: payloadFrom.ghost,
        assist: payloadFrom.assist === true,
      };
      void this.sendRun(key, payload);
    } else if (!this.boards.has(key)) {
      void this.loadBoard(key).then(() => this.renderResultsBoard());
    }
    return this.resultsBoardView() ?? undefined;
  }

  private async sendRun(key: string, payload: SubmitPayload): Promise<void> {
    const out = await submitRun(payload);
    let status: string;
    if (out.ok) {
      this.posted.add(key);
      this.records.setBoardRunId(key, out.runId);
      this.lastPost = { key, payload: { ...payload, name: out.name } };
      status = out.improved
        ? `You're #${out.place} of ${out.total} on the leaderboard!`
        : `Your best stays ${formatTime(out.bestMs)}: #${out.place} of ${out.total}.`;
    } else {
      status = `Not posted: ${out.message}`;
    }
    if (this.resultsBoard?.key === key) this.resultsBoard.status = status;
    await this.loadBoard(key);
    this.renderResultsBoard();
    if (this.state === 'menu' && this.key === key) this.refreshHomeBoard();
  }

  private resultsBoardView(): ResultsBoardView | null {
    const rb = this.resultsBoard;
    if (!rb || rb.key !== this.key) return null;
    return { board: this.boardView(rb.key, BOARD_SIZE), status: rb.status, postingAs: rb.postingAs };
  }

  private renderResultsBoard(): void {
    const view = this.resultsBoardView();
    if (view && this.state === 'results') this.overlay.updateResultsBoard(view);
  }

  /** New name from the results screen: used everywhere, and your posted run is re-posted under it. */
  private changeName(name: string): void {
    this.profile.name = name;
    this.room?.setName(this.profile.name);
    if (this.resultsBoard?.postingAs !== null && this.resultsBoard) this.resultsBoard.postingAs = this.profile.name;
    const last = this.lastPost;
    if (last && last.key === this.key && this.resultsBoard) {
      this.resultsBoard.status = 'Updating your name…';
      void this.sendRun(last.key, { ...last.payload, name: this.profile.name });
    }
    this.renderResultsBoard();
  }

  // --- ghosts ----------------------------------------------------------------

  /** PB ghost (if any) plus the rival: a recorded dev ghost, or the bot. */
  private prepareGhosts(): void {
    this.clearGhosts();

    const runs: { kind: ActiveGhost['kind']; run: GhostRun; color: string }[] = [];
    const best = this.records.best(this.key);
    const pbGhost = best ? decodeGhost(best.ghost) : null;
    if (best && pbGhost) runs.push({ kind: 'pb', run: { label: 'PB', timeMs: best.timeMs, splits: best.splits, ghost: pbGhost }, color: PB_COLOR });

    // A leaderboard ghost you picked takes the rival's place.
    const picked = this.boardTarget?.key === this.key ? this.boardTarget.run : null;
    if (picked) {
      runs.push({ kind: 'board', run: picked, color: BOARD_COLOR });
    } else {
      if (!this.rivalCache.has(this.key)) {
        const shipped = this.courseId ? shippedDevGhost(this.courseId, this.key) : null;
        this.rivalCache.set(this.key, shipped ?? recordBotGhost(this.built));
      }
      const rival = this.rivalCache.get(this.key);
      if (rival) runs.push({ kind: 'rival', run: rival, color: RIVAL_COLOR });
    }

    for (const { kind, run, color } of runs) {
      const view = new GhostView(run.label, color);
      this.view.scene.add(view.group);
      this.ghosts.push({ kind, run, view, color, hint: 0, progress: 0 });
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
    if (this.viewOnly) {
      this.overlay.showStartMessage('Rooms are live races: open this invite link on a computer to join in.');
      return;
    }
    if (!multiplayerConfigured()) {
      this.overlay.showStartMessage('Multiplayer is not configured in this build.');
      return;
    }
    void this.joinRoom(code);
  }

  /** The course you have selected, as a room refers to it. */
  private currentRef(): CourseRef {
    if (this.selectedCourseId === CUSTOM_ID && this.custom) return this.customRef(this.custom);
    return { kind: 'shipped', id: this.selectedCourseId };
  }

  /** Random courses travel as their seed; AI and shared ones as the full spec (plus share code). */
  private customRef(custom: CustomCourse): CourseRef {
    return custom.seed !== null
      ? { kind: 'random', seed: custom.seed, difficulty: custom.course.difficulty }
      : { kind: 'spec', spec: custom.course, code: custom.code };
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
    if (id === 'ai') {
      this.openGenerator('room');
      return;
    }
    let ref: CourseRef;
    if (id === CUSTOM_ID && this.custom) {
      ref = this.customRef(this.custom);
    } else if (id === 'random') {
      ref = { kind: 'random', seed: Math.floor(Math.random() * 1_000_000) };
    } else {
      ref = { kind: 'shipped', id };
    }
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
    this.loadCourse(spec ?? null, st.course.kind === 'shipped' ? st.course.id : null, false, st.course.kind === 'spec' ? (st.course.code ?? null) : null);
    this.roomCourseKey = st.courseKey;
    this.roomCourseOk = st.courseKey === '' || st.courseKey === this.key;
  }

  private onRoomChange(): void {
    const room = this.room;
    if (!room) return;
    this.remotes.sync(room.players);
    const st = room.state;

    const busyElsewhere = this.state === 'spectating' || this.state === 'generate' || this.state === 'preview';
    if (st.courseKey !== this.roomCourseKey && !this.inRoomRace && !busyElsewhere) this.loadRoomCourse();

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
    // Also reload if a generator preview swapped the course out locally.
    if (room.state.courseKey !== this.roomCourseKey || this.key !== room.state.courseKey) this.loadRoomCourse();
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
    const theme = courseTheme(this.built.course);
    const ready = room.players.filter((p) => p.ready || p.isHost).length;
    const ramps = this.built.segments.filter((s) => s.type === 'ramp').length;
    const isCustom = (st.course.kind === 'spec' || st.course.kind === 'random') && this.custom !== null && this.roomCourseKey === courseKey(this.custom.course);
    const selectedId = isCustom ? CUSTOM_ID : st.course.kind === 'shipped' ? st.course.id : st.course.kind === 'random' ? 'random' : '';
    const roomCode = st.course.kind === 'spec' ? (st.course.code ?? null) : null;
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
        theme: themeLabel(this.built.course),
        swatch: theme.swatch,
        bestMs: this.records.best(this.key)?.timeMs ?? null,
        detail: [plural(ramps, 'ramp'), plural(this.built.checkpoints.length - 1, 'checkpoint'), roomCode ? `share code ${roomCode}` : ''].filter(Boolean).join(' · '),
      },
      courseChoices: [
        ...SHIPPED_COURSES.map((c) => ({ id: c.id, label: validateCourse(c.spec).course.name })),
        { id: 'random', label: 'Random course' },
        ...(this.custom ? [{ id: CUSTOM_ID, label: this.custom.course.name }] : []),
        { id: 'ai', label: '✨ AI course / code…' },
      ].map((c) => ({
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
    this.hud.coach.setVisible(false);
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

  // --- AI course generator ---------------------------------------------------

  private bindGenerator(): void {
    const g = this.generator;
    this.overlay.registerScreen('generate', g.generateScreen);
    this.overlay.registerScreen('preview', g.previewScreen);
    g.onGenerate = (prompt, difficulty) => void this.generate(prompt, difficulty);
    g.onLoadCode = (code) => void this.loadSharedCourse(code);
    g.onRandom = () => this.useRandomCourse();
    g.onBack = () => this.leaveGenerator();
    g.onPreviewBack = () => this.leaveGenerator();
    g.onNewPrompt = () => this.openGenerator(this.generatorFor);
    g.onRegenerate = () => void this.generate(this.custom?.prompt ?? g.prompt, this.custom?.course.difficulty ?? g.difficulty);
    g.onCopyLink = () => void this.copyCourseLink();
    g.onRace = () => this.raceCustom();
    g.onLike = () => void this.toggleLike();
  }

  /** Open the prompt screen, for yourself or (as host) for your room. */
  openGenerator(forWhat: 'solo' | 'room'): void {
    if (forWhat === 'room' && !this.room?.isHost) return;
    this.generateRequest++;
    this.generatorFor = forWhat;
    this.state = 'generate';
    this.pendingStart = null;
    this.loop.simulating = false;
    this.input.releaseLock();
    this.hud.setVisible(false);
    this.generator.clearStatus();
    this.generator.setBackLabel(forWhat === 'room' ? 'Back to lobby' : 'Back');
    this.overlay.show('generate');
    this.generator.focusPrompt();
  }

  /** `?course=CODE` in the address bar: open that shared course. */
  openSharedCourseFromUrl(code: string): void {
    this.openGenerator('solo');
    void this.loadSharedCourse(code);
  }

  private async generate(prompt: string, difficulty: Difficulty): Promise<void> {
    if (this.state !== 'generate' && this.state !== 'preview') return;
    const request = ++this.generateRequest;
    this.state = 'generate';
    this.overlay.show('generate');
    this.generator.setPrompt(prompt);
    this.generator.setDifficulty(difficulty);
    this.generator.setBusy();
    const out = await requestCourse(prompt, { difficulty });
    if (request !== this.generateRequest || this.state !== 'generate') return; // moved on meanwhile
    if (!out.ok) {
      const canRetry = out.reason === 'timeout' || out.reason === 'ai-failed' || out.reason === 'network';
      this.generator.showError(out.message, canRetry);
      return;
    }
    this.generator.clearStatus();
    if (out.value.code) this.likeCounts.set(out.value.code, out.value.likes);
    this.useCustom({ course: out.value.course, source: 'ai', code: out.value.code, prompt: out.value.prompt, seed: null });
  }

  private async loadSharedCourse(input: string): Promise<void> {
    if (this.state !== 'generate') return;
    const request = ++this.generateRequest;
    this.generator.setBusy('Loading the shared course…');
    const out = await fetchSharedCourse(input);
    if (request !== this.generateRequest || this.state !== 'generate') return;
    if (!out.ok) {
      const message =
        out.reason === 'invalid-code'
          ? "That doesn't look like a share code: they're 6 letters and numbers, like K7M2QX."
          : out.reason === 'not-found'
            ? 'No course has that code. Check it and try again.'
            : "Couldn't load the course. Check your connection and try again.";
      this.generator.showError(message, false);
      return;
    }
    this.generator.clearStatus();
    if (out.value.code) this.likeCounts.set(out.value.code, out.value.likes);
    this.useCustom({ course: out.value.course, source: 'shared', code: out.value.code, prompt: out.value.prompt, seed: null });
  }

  /** The never-dead-end fallback: a procedurally generated course. */
  private useRandomCourse(): void {
    if (this.state !== 'generate') return;
    this.generateRequest++;
    this.generator.clearStatus();
    const seed = Math.floor(Math.random() * 1_000_000_000);
    this.useCustom({ course: randomCourse(seed, { difficulty: this.generator.difficulty }), source: 'random', code: null, prompt: null, seed });
  }

  private useCustom(custom: CustomCourse): void {
    this.custom = custom;
    this.loadCourse(custom.course, null, false, custom.code);
    if (this.generatorFor === 'solo') {
      this.selectedCourseId = CUSTOM_ID;
      setUrlCourse(custom.code);
    }
    this.refreshCourseCards();
    this.showPreview();
  }

  private showPreview(): void {
    const c = this.custom;
    if (!c) return;
    this.state = 'preview';
    this.flyoverStart = performance.now();
    const course = this.built.course;
    const ramps = this.built.segments.filter((s) => s.type === 'ramp').length;
    this.generator.showPreview({
      eyebrow: c.source === 'ai' ? 'AI course' : c.source === 'shared' ? 'Shared course' : 'Random course',
      name: course.name,
      meta: `${course.difficulty} · ${themeLabel(course)} · ${plural(ramps, 'ramp')} · ${plural(this.built.checkpoints.length - 1, 'checkpoint')}`,
      prompt: c.prompt,
      code: c.code,
      codeNote: c.source === 'random' ? 'Random courses have no share code.' : "Couldn't save a share code for this one, but you can still race it.",
      primaryLabel: this.viewOnly ? 'Race on a computer' : this.generatorFor === 'room' ? 'Use in room' : 'Race',
      canRace: !this.viewOnly,
      canRegenerate: c.source === 'ai' && c.prompt !== null,
      like: this.likeView(),
    });
    this.overlay.show('preview');
  }

  private raceCustom(): void {
    if (this.generatorFor === 'room') {
      this.hostPickCourse(CUSTOM_ID);
      this.showLobby();
      return;
    }
    this.overlay.setSelectedCourse(CUSTOM_ID);
    this.pendingStart = 'full';
    this.engage();
  }

  private leaveGenerator(): void {
    this.generateRequest++;
    this.generator.clearStatus();
    if (this.generatorFor === 'room' && this.room) {
      this.showLobby();
      return;
    }
    this.goToMenu();
  }

  private courseLink(code: string): string {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('course', code);
    return url.toString();
  }

  private async copyCourseLink(): Promise<void> {
    const code = this.custom?.code;
    if (!code) return;
    const link = this.courseLink(code);
    try {
      await navigator.clipboard.writeText(link);
      this.overlay.toast('Course link copied');
    } catch {
      this.overlay.toast(link, 5000);
    }
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
        this.audio.respawn();
        break;
      case 'checkpoint':
        this.audio.checkpoint();
        if (this.fancyEffects) {
          const at = forwardOf(this.angles.yaw, this.tmp).multiplyScalar(260).add(this.player.pos);
          at.y += EYE_HEIGHT;
          this.burst.fire(at, this.player.vel, this.theme.accent);
        }
        if (session) {
          const split = session.checkpoint(event.index);
          this.hud.showSplit({ label: `Checkpoint ${event.index}`, timeMs: split.timeMs, deltaMs: split.deltaMs });
          this.hud.setCheckpoints(event.index, this.built.checkpoints.length - 1);
        }
        break;
      case 'booster':
        this.overlay.toast('Boost!', 900);
        this.audio.boost();
        break;
      case 'finish':
        this.finishRun();
        break;
      case 'missed':
        // Skipped part of the course (dropped past a spiral, say): it doesn't count until you go back.
        this.overlay.toast(`Missed checkpoint ${event.index}: press R to go back`, 3500);
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
        assist: this.usedAssist,
      });
      this.lastFinish = { timeMs: Math.round(result.timeMs), splits: result.splits, ghost };
      this.refreshCourseCards();
    }

    this.audio.finish(outcome?.isBest === true);
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
      rivals: this.ghosts
        .filter((g) => g.kind !== 'pb')
        .map((g) => ({ label: g.kind === 'board' ? g.run.label : g.run.label === 'BOT' ? 'Bot' : 'Dev ghost', timeMs: g.run.timeMs })),
      note,
      canSaveDevGhost: this.devMode && this.courseId !== null && outcome !== null && !roomRace,
      backToLobby: this.inRoom,
      room: roomRace && this.room ? { standings: this.standingRows(), isHost: this.room.isHost, raceOver: this.room.state.phase === 'lobby' } : undefined,
    };
    const board = this.postRun(outcome, result.splits);
    if (board && !roomRace) view.board = board;
    view.like = this.likeView() ?? undefined;

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
    if (view.board) view.board = this.resultsBoardView() ?? view.board; // posting may have finished meanwhile
    if (view.like) view.like = this.likeView() ?? undefined;
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
        this.audio.respawn();
        this.coachEvents.push({ type: 'respawn' });
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
    if (session.phase === 'countdown') {
      // Frozen on the start pad; look around freely.
      this.updateCoach(this.heldKeys(), []);
      return;
    }
    this.ghostTicks++;

    const key = (code: string): number => (this.input.isDown(code) ? 1 : 0);
    let keys = this.heldKeys();
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
      else if (this.settings.assist) {
        cmd = assistCommand(cmd, this.player);
        this.usedAssist = true;
      }
      stepPlayer(this.player, cmd, this.settings.assist && !this.debug.autopilot ? assistedPhysics(physics) : physics, this.world, dt);
      keys = { w: cmd.forward > 0, s: cmd.forward < 0, d: cmd.side > 0, a: cmd.side < 0, space: cmd.jump };
    }

    session.noteSpeed(Math.hypot(this.player.vel.x, this.player.vel.z));
    const courseEvents = this.runtime.update(this.player);
    for (const event of courseEvents) this.handleEvent(event);
    this.updateCoach(keys, courseEvents);
    if (session.phase === 'racing') this.recorder?.tick(this.ghostTicks, this.player.pos, this.angles.yaw);
    if (roomRace && this.room && this.roomRaceId && this.ghostTicks % SAMPLE_EVERY_TICKS === 0) {
      this.room.queueSample(this.roomRaceId, this.roomRaceClockMs(), this.player.pos, this.player.vel, this.angles.yaw);
    }
    if (this.pendingResults && this.ghostTicks >= this.pendingResults.atTick) this.showResults(this.pendingResults.view);
  }

  private heldKeys(): CoachKeys {
    const down = (code: string): boolean => this.input.isDown(code);
    return { w: down('KeyW'), a: down('KeyA'), s: down('KeyS'), d: down('KeyD'), space: down('Space') };
  }

  private updateCoach(keys: CoachKeys, events: readonly CourseEvent[]): void {
    this.coachKeys = keys;
    const session = this.session;
    if (!this.coach || !session) return;
    const extra = this.coachEvents;
    this.coachEvents = [];
    this.coach.update({
      phase: session.phase,
      piece: this.runtime.piece,
      lateral: this.runtime.lateral,
      surfing: this.player.surfing,
      onGround: this.player.onGround,
      keys,
      events: extra.length > 0 ? [...extra, ...events] : events,
    });
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
    if (this.state === 'cover' && this.cover) {
      cam.position.copy(this.cover.shot.camera);
      cam.lookAt(this.cover.shot.target);
      cam.rotateZ(this.cover.shot.roll);
      this.view.render();
      return;
    } else if (this.state === 'spectating') {
      this.setSceneFade(0);
      this.renderSpectator();
    } else if (this.state === 'preview' || this.state === 'menu') {
      // The menu drifts over the selected course at a calmer pace than the preview.
      const pace = this.state === 'menu' ? MENU_FLYOVER_PACE : 1;
      const t = ((performance.now() - this.flyoverStart) / 1000) * pace;
      flyoverPose(this.built.path, t, cam.position, this.flyTarget);
      cam.lookAt(this.flyTarget);
      this.setSceneFade(flyoverFade(this.built.path, t));
    } else {
      this.setSceneFade(0);
      this.camPos.lerpVectors(this.prevPos, this.player.pos, alpha);
      this.camPos.y += EYE_HEIGHT;
      cam.position.copy(this.camPos);
      const racing = this.session !== null && (this.state === 'countdown' || this.state === 'racing');
      this.updateFeel(racing && this.loop.simulating, frameDt);
      cam.rotation.set(this.angles.pitch, this.angles.yaw, this.roll);
      if (racing) this.updateGhostsAndHud(alpha);
    }
    if (this.state !== 'racing' && this.state !== 'countdown') this.resetFeel();
    this.burst.update(frameDt);
    this.updateSound(frameDt);
    this.view.render();
    this.updateStats(frameDt);
  }

  /** Music intensity from what's happening; the beat pulse and equalizers from the music. */
  private updateSound(frameDt: number): void {
    const racing = this.state === 'racing' && this.session !== null && !this.paused;
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    this.audio.setIntensity(racing ? speedIntensity(speed) : this.state === 'countdown' ? 0.25 : this.state === 'results' ? 0.45 : 0.35);
    this.audio.frame(frameDt);

    const pulse = this.reducedMotion ? 0 : this.audio.pulse;
    BEAT_PULSE.value = pulse;
    this.courseView?.setPulse(pulse);
    if (this.reducedMotion || !this.audio.ready) return;
    if (this.overlay.screen === 'start') drawEqualizer(this.overlay.equalizerCanvas, this.audio.bars(48), this.theme.swatch);
    else if (racing || this.state === 'countdown') drawEqualizer(this.hud.equalizerCanvas, this.audio.bars(16), ['#ffffff', '#ffffff']);
  }

  /**
   * /?capture=cover: a 1600×900 shot for the submission's cover image (a
   * rider mid-surf on Speed Demon, title over it). Take a screenshot of the
   * top-left 1600×900, or press P to download it as a PNG.
   */
  captureCover(): void {
    this.selectCourse('speed-demon');
    this.state = 'cover';
    this.overlay.hideAll();
    this.hud.setVisible(false);
    BEAT_PULSE.value = 0;
    const shot = coverShot(this.built);
    this.view.scene.add(buildCoverRider(shot, '#3ee6ff'));
    this.view.setFixedSize(COVER_WIDTH, COVER_HEIGHT);
    this.view.setFov(shot.fov);

    const title = document.createElement('canvas');
    title.width = COVER_WIDTH;
    title.height = COVER_HEIGHT;
    title.className = 'cover-title';
    const g = title.getContext('2d');
    if (g) drawCoverTitle(g);
    document.body.append(title);
    this.cover = { shot, title };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.saveCover();
    });
    console.info('[surf-duel] Cover mode: press P to save surf-duel-cover.png (1600×900).');
  }

  private saveCover(): void {
    const cover = this.cover;
    if (!cover) return;
    this.render(0, 0); // a fresh frame, so the WebGL canvas can be read
    const out = document.createElement('canvas');
    out.width = COVER_WIDTH;
    out.height = COVER_HEIGHT;
    const g = out.getContext('2d');
    if (!g) return;
    g.drawImage(this.view.canvas, 0, 0, COVER_WIDTH, COVER_HEIGHT);
    g.drawImage(cover.title, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'surf-duel-cover.png';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  /** Extra effects (speed lines, bursts, view sway) are for high graphics, and off with reduced motion. */
  private get fancyEffects(): boolean {
    return this.settings.graphics === 'high' && !this.reducedMotion;
  }

  /** Speed widens the view, strafing leans it a touch, and speed lines rush past at full tilt. */
  private updateFeel(live: boolean, dt: number): void {
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    const motion = !this.reducedMotion;
    const targetFov = live && motion ? speedFov(this.settings.fov, speed) : this.settings.fov;
    this.fovNow += (targetFov - this.fovNow) * Math.min(1, dt * 4);
    if (Math.abs(this.view.camera.fov - this.fovNow) > 0.01) this.view.setFov(this.fovNow);
    const side = this.coachKeys.d ? 1 : this.coachKeys.a ? -1 : 0;
    this.roll = motion ? approachRoll(this.roll, live ? side : 0, dt) : 0;
    this.speedLinesFx.draw(live && this.fancyEffects ? speedLines(speed) : 0, dt);
  }

  private resetFeel(): void {
    this.roll = 0;
    this.speedLinesFx.draw(0, 0);
    if (this.fovNow !== this.settings.fov) {
      this.fovNow = this.settings.fov;
      this.view.setFov(this.fovNow);
    }
  }

  private setSceneFade(opacity: number): void {
    const rounded = Math.round(opacity * 100) / 100;
    if (rounded === this.sceneFadeOpacity) return;
    this.sceneFadeOpacity = rounded;
    this.sceneFade.style.opacity = String(rounded);
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

    if (this.coach) this.hud.coach.render(this.coach.current, this.coach.hint, this.coach.note, this.coach.step, this.coachKeys);
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

/** Keep ?course=CODE in the address bar for a shared/AI course, so a refresh comes back to it. */
function setUrlCourse(code: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('course', code);
    else if (url.searchParams.has('course') && normalizeShareCode(url.searchParams.get('course') ?? '')) url.searchParams.delete('course');
    else return;
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Not fatal: the preview's copy-link button still works.
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

/** "1 ramp", "3 ramps". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
