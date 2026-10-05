import { formatDelta, formatTime } from '../game/time';
import { MAX_PLAYERS } from '../net/roomLogic';

export type OverlayScreen = 'start' | 'loading' | 'lobby' | 'pause' | 'results' | 'unsupported' | 'generate' | 'preview' | 'none';

export interface CourseCard {
  id: string;
  name: string;
  difficulty: string;
  /** Theme label ("Lava"), plus the source and share code for custom courses. */
  meta: string;
  blurb: string;
  swatch: [string, string];
  /** Your best time on this course, if any. */
  bestMs: number | null;
  /** A short callout on the card ("Start here"), if any. */
  badge: string | null;
}

/** One line of a leaderboard. */
export interface BoardRowView {
  id: string;
  place: number;
  name: string;
  timeMs: number;
  /** Your own entry. */
  isMe: boolean;
  /** The ghost you've picked to race. */
  selected: boolean;
}

export interface BoardView {
  /** 'none': this course has no leaderboard (random courses, offline builds). */
  state: 'loading' | 'ready' | 'unavailable' | 'none';
  rows: BoardRowView[];
  /** A line under the list ("No times yet: set the first!"). */
  note: string;
}

/** The leaderboard part of the results screen. */
export interface ResultsBoardView {
  board: BoardView;
  /** What happened to this run: "Posting your time…", "#3 of 12 on the leaderboard", "Not posted: …". */
  status: string;
  /** The name runs are posted under, or null when this run can't be posted. */
  postingAs: string | null;
}

export interface ResultsRow {
  label: string;
  timeMs: number | null;
  deltaMs: number | null;
}

/** One line of a multiplayer standings table. */
export interface StandingRow {
  place: number | null;
  name: string;
  color: string;
  isMe: boolean;
  /** Finish time, or null while still racing. */
  timeMs: number | null;
  /** Shown instead of a time when there isn't one: "racing…", "DNF". */
  status: string;
}

export interface ResultsView {
  courseName: string;
  timeMs: number;
  /** Versus your previous best; null on a first run. */
  deltaMs: number | null;
  isBest: boolean;
  rank: number | null;
  runs: number | null;
  topSpeed: number;
  splits: ResultsRow[];
  /** Other ghosts' times on this course, for comparison. */
  rivals: { label: string; timeMs: number }[];
  /** Why the run wasn't saved, if it wasn't. */
  note: string;
  canSaveDevGhost: boolean;
  /** A practice run inside a room: the secondary button returns to the lobby, not the menu. */
  backToLobby?: boolean;
  /** Present for a multiplayer race: the shared standings and room controls. */
  room?: { standings: StandingRow[]; isHost: boolean; raceOver: boolean };
  /** Present when the course has a leaderboard (solo and practice runs). */
  board?: ResultsBoardView;
}

export interface LobbyPlayerRow {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  isMe: boolean;
  ready: boolean;
  status: string;
}

export interface LobbyView {
  code: string;
  link: string;
  players: LobbyPlayerRow[];
  maxPlayers: number;
  isHost: boolean;
  myName: string;
  myReady: boolean;
  course: { name: string; difficulty: string; theme: string; swatch: [string, string]; bestMs: number | null; detail: string };
  courseChoices: { id: string; label: string; selected: boolean }[];
  startLabel: string;
  canStart: boolean;
  raceInProgress: boolean;
  warning: string;
}

export type PauseMode = 'solo' | 'room-race' | 'room-grab';

const tone = (delta: number | null): string => (delta === null ? '' : delta < 0 ? 'ahead' : delta > 0 ? 'behind' : 'even');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', label, className);
  b.type = 'button';
  b.addEventListener('click', () => {
    b.blur();
    onClick();
  });
  return b;
}

/** A leaderboard list: home rows pick a ghost (toggle), results rows race one. */
function boardList(view: BoardView, where: 'home' | 'results', onRow: (row: BoardRowView) => void): HTMLElement {
  const list = el('ol', undefined, `board board--${where}`);
  if (view.state === 'loading') {
    list.append(el('li', 'Loading times…', 'board__empty'));
    return list;
  }
  if (view.state !== 'ready' || view.rows.length === 0) return list;
  for (const row of view.rows) {
    const li = el('li', undefined, 'board__item');
    const b = el('button', undefined, 'board__row');
    b.type = 'button';
    if (row.isMe) b.classList.add('is-me');
    if (where === 'home') b.setAttribute('aria-pressed', String(row.selected));
    b.title = where === 'home' ? `Race ${row.name}'s ghost` : `Race ${row.name}'s ghost now`;
    b.append(
      el('span', String(row.place), 'board__place'),
      el('span', row.isMe ? `${row.name} (you)` : row.name, 'board__name'),
      el('span', formatTime(row.timeMs), 'board__time'),
      el('span', where === 'home' ? (row.selected ? 'picked' : 'ghost') : 'race', 'board__ghost'),
    );
    b.addEventListener('click', () => {
      b.blur();
      onRow(row);
    });
    li.append(b);
    list.append(li);
  }
  return list;
}

/**
 * Full-screen HTML overlays (start, loading, lobby, pause, results), toasts,
 * the connection banner and the debug readout. In-race HUD elements live in hud.ts.
 */
export class Overlay {
  onEngage: (() => void) | null = null;
  onOpenGenerator: (() => void) | null = null;
  onSelectCourse: ((id: string) => void) | null = null;
  onRestart: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  onRaceAgain: (() => void) | null = null;
  onSaveDevGhost: (() => void) | null = null;
  onLeaveRace: (() => void) | null = null;
  // Multiplayer.
  onCreateRoom: (() => void) | null = null;
  onJoinRoom: ((code: string) => void) | null = null;
  onLobbyName: ((name: string) => void) | null = null;
  onLobbyReady: (() => void) | null = null;
  onLobbyCourse: ((id: string) => void) | null = null;
  onLobbyStart: (() => void) | null = null;
  onLobbyLeave: (() => void) | null = null;
  onLobbyCopyLink: (() => void) | null = null;
  onLobbySecondTab: (() => void) | null = null;
  onLobbyPractice: (() => void) | null = null;
  onLobbySpectate: (() => void) | null = null;
  onEndRace: (() => void) | null = null;
  onBackToLobby: (() => void) | null = null;
  // Leaderboards.
  /** Home screen: pick (or un-pick) a leaderboard ghost to race. */
  onBoardPick: ((runId: string) => void) | null = null;
  /** Results screen: race a leaderboard ghost now. */
  onBoardRace: ((runId: string) => void) | null = null;
  onChangeName: ((name: string) => void) | null = null;

  private readonly root: HTMLElement;
  private readonly screens: Partial<Record<Exclude<OverlayScreen, 'none'>, HTMLElement>>;
  private readonly messages: HTMLElement[];
  private readonly debugHud: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly courseList: HTMLElement;
  private readonly raceCourse: HTMLElement;
  private courseNames = new Map<string, string>();
  private raceVs: string | null = null;
  private readonly homeBoard: HTMLElement;
  private resultsBoard: HTMLElement | null = null;
  private readonly toastEl: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly loadingText: HTMLElement;
  private readonly results: HTMLElement;
  private readonly lobby: HTMLElement;
  private readonly mpBlock: HTMLElement;
  private readonly joinInput: HTMLInputElement;
  private readonly pauseTitle: HTMLElement;
  private readonly pauseText: HTMLElement;
  private toastTimer = 0;
  private current: OverlayScreen = 'start';
  private lobbyBuilt = false;
  private standingsTable: HTMLTableElement | null = null;
  private resultsRoomNote: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ui-root';
    this.root.innerHTML = `
      <div class="crosshair" hidden></div>
      <pre class="debug-hud" aria-hidden="true"></pre>
      <div class="toast" role="status" aria-live="polite" hidden></div>
      <div class="banner" role="status" aria-live="polite" hidden></div>

      <section class="overlay overlay--start" data-screen="start">
        <div class="home">
          <header class="home__brand">
            <h1 class="title">SURF DUEL</h1>
            <p class="pitch">Slide the ramps. Race your friends. Build courses with AI.</p>
          </header>

          <div class="home__main">
            <section class="panel home__courses" aria-labelledby="home-courses-title">
              <h2 class="panel__title" id="home-courses-title">Choose a course</h2>
              <div class="course-list" role="group" aria-labelledby="home-courses-title"></div>
              <div class="home__board" aria-live="polite"></div>
              <button class="btn btn--primary btn--race" data-action="engage" type="button">
                <span class="btn--race__go" aria-hidden="true"></span>
                <span class="btn--race__label">Race</span>
                <span class="btn--race__course"></span>
              </button>
              <p class="home__keyhint"><kbd>↑</kbd><kbd>↓</kbd> pick a course &nbsp;·&nbsp; <kbd>Enter</kbd> race</p>
            </section>

            <div class="home__side">
              <button class="feature" data-action="open-generator" type="button">
                <span class="feature__icon" aria-hidden="true">✨</span>
                <span class="feature__text">
                  <span class="feature__title">Design a course with AI</span>
                  <span class="feature__sub">Describe it in a sentence. It's built in seconds.</span>
                </span>
                <span class="feature__arrow" aria-hidden="true">→</span>
              </button>

              <section class="panel mp-block" aria-labelledby="home-mp-title">
                <h2 class="panel__title" id="home-mp-title">Race friends</h2>
                <p class="panel__sub">Up to ${MAX_PLAYERS} players, live. Share the link to invite.</p>
                <div class="mp-row">
                  <button class="btn btn--ghost btn--small" data-action="create-room" type="button">Create room</button>
                  <span class="mp-row__or">or</span>
                  <form class="join-form" autocomplete="off">
                    <label class="visually-hidden" for="join-code">Room code</label>
                    <input id="join-code" class="input input--code" maxlength="6" placeholder="CODE" spellcheck="false" />
                    <button class="btn btn--ghost btn--small" type="submit">Join</button>
                  </form>
                </div>
              </section>

              <section class="panel howto" aria-labelledby="home-howto-title">
                <h2 class="panel__title" id="home-howto-title">How to surf</h2>
                <div class="howto__keys">
                  <div class="howto__key"><kbd class="howto__kbd howto__kbd--a">A</kbd><span>ramp on your <strong>left</strong></span></div>
                  <div class="howto__key"><kbd class="howto__kbd howto__kbd--d">D</kbd><span>ramp on your <strong>right</strong></span></div>
                </div>
                <p class="howto__text">Hold the key toward the ramp and steer with the mouse. Don't press <kbd>W</kbd>: your speed comes from the slope.</p>
                <ul class="howto__controls">
                  <li><kbd>Space</kbd> hop</li>
                  <li><kbd>R</kbd> last checkpoint</li>
                  <li><kbd>Shift</kbd><kbd>R</kbd> restart</li>
                  <li><kbd>Esc</kbd> pause</li>
                </ul>
              </section>
            </div>
          </div>

          <p class="message home__message" role="status" aria-live="polite"></p>
          <p class="phase-tag">Phase 6 · Leaderboards</p>
        </div>
      </section>

      <section class="overlay" data-screen="loading" hidden>
        <div class="card">
          <div class="spinner" aria-hidden="true"></div>
          <p class="loading-text" role="status" aria-live="polite">Building course…</p>
        </div>
      </section>

      <section class="overlay" data-screen="lobby" hidden>
        <div class="card lobby" role="dialog" aria-labelledby="lobby-heading"></div>
      </section>

      <section class="overlay overlay--pause" data-screen="pause" hidden>
        <div class="card">
          <h2 class="pause-title">Paused</h2>
          <p class="pause-text pitch" hidden></p>
          <div class="btn-row">
            <button class="btn btn--primary" data-action="engage" type="button">Resume</button>
            <button class="btn btn--ghost" data-action="restart" data-mode="solo" type="button">Restart run</button>
            <button class="btn btn--ghost" data-action="menu" data-mode="solo" type="button">Menu</button>
            <button class="btn btn--ghost" data-action="leave-race" data-mode="room" type="button">Leave race</button>
          </div>
          <p class="message" role="status" aria-live="polite"></p>
          <p class="hint" data-mode="solo">Press <kbd>\`</kbd> to toggle the tuning panel</p>
        </div>
      </section>

      <section class="overlay" data-screen="results" hidden>
        <div class="card results" role="dialog" aria-labelledby="results-heading"></div>
      </section>

      <section class="overlay" data-screen="unsupported" hidden>
        <div class="card">
          <h2>Best on desktop</h2>
          <p class="pitch">Surf Duel needs a desktop browser with a mouse or trackpad.</p>
        </div>
      </section>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const found = this.root.querySelector<T>(sel);
      if (!found) throw new Error(`Overlay: missing ${sel}`);
      return found;
    };
    this.screens = {
      start: q('[data-screen="start"]'),
      loading: q('[data-screen="loading"]'),
      lobby: q('[data-screen="lobby"]'),
      pause: q('[data-screen="pause"]'),
      results: q('[data-screen="results"]'),
      unsupported: q('[data-screen="unsupported"]'),
    };
    this.messages = [...this.root.querySelectorAll<HTMLElement>('.message')];
    this.debugHud = q('.debug-hud');
    this.crosshair = q('.crosshair');
    this.courseList = q('.course-list');
    this.raceCourse = q('.btn--race__course');
    this.homeBoard = q('.home__board');
    this.toastEl = q('.toast');
    this.banner = q('.banner');
    this.loadingText = q('.loading-text');
    this.results = q('.results');
    this.lobby = q('.lobby');
    this.mpBlock = q('.mp-block');
    this.joinInput = q<HTMLInputElement>('#join-code');
    this.pauseTitle = q('.pause-title');
    this.pauseText = q('.pause-text');

    q<HTMLFormElement>('.join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.onJoinRoom?.(this.joinInput.value);
    });
    this.bindActions(this.root);
  }

  get screen(): OverlayScreen {
    return this.current;
  }

  show(screen: OverlayScreen): void {
    this.current = screen;
    this.root.dataset.screen = screen;
    for (const [name, element] of Object.entries(this.screens)) element.hidden = name !== screen;
    this.crosshair.hidden = screen !== 'none';
    if (screen !== 'none') this.setMessage('');
    // Move focus to the screen's main button for keyboard players.
    const primary = screen === 'none' ? null : (this.screens[screen]?.querySelector<HTMLButtonElement>('.btn--primary:not([disabled])') ?? null);
    primary?.focus({ preventScroll: true });
  }

  /** Add a screen built elsewhere (the AI generator's), so show() manages it with the rest. */
  registerScreen(name: 'generate' | 'preview', element: HTMLElement): void {
    element.hidden = this.current !== name;
    this.root.append(element);
    this.screens[name] = element;
  }

  setMessage(text: string): void {
    for (const m of this.messages) m.textContent = text;
  }

  /** Show a message on the start screen after show() (which clears messages). */
  showStartMessage(text: string): void {
    this.show('start');
    this.setMessage(text);
  }

  setLoadingText(text: string): void {
    this.loadingText.textContent = text;
  }

  setMultiplayerAvailable(available: boolean): void {
    this.mpBlock.hidden = !available;
  }

  /** A slim status line at the top of the screen (connection problems, spectating…). */
  setBanner(text: string | null): void {
    this.banner.hidden = text === null;
    if (text !== null && this.banner.textContent !== text) this.banner.textContent = text;
  }

  setPauseMode(mode: PauseMode): void {
    const room = mode !== 'solo';
    this.pauseTitle.textContent = mode === 'room-grab' ? 'Race starting!' : room ? 'Mouse released' : 'Paused';
    this.pauseText.hidden = !room;
    this.pauseText.textContent =
      mode === 'room-grab' ? 'Click to take control of your surfer.' : 'The race keeps going without you — click to jump back in.';
    const pause = this.screens.pause!; // built in the constructor
    const resume = pause.querySelector<HTMLButtonElement>('[data-action="engage"]');
    if (resume) resume.textContent = mode === 'room-grab' ? 'Take control' : 'Resume';
    for (const e of pause.querySelectorAll<HTMLElement>('[data-mode]')) e.hidden = e.dataset.mode !== (room ? 'room' : 'solo');
  }

  setCourses(cards: readonly CourseCard[], selected: string): void {
    this.courseNames = new Map(cards.map((c) => [c.id, c.name]));
    this.courseList.replaceChildren(
      ...cards.map((c) => {
        const btn = el('button', undefined, 'course-card');
        btn.type = 'button';
        btn.dataset.id = c.id;
        btn.style.setProperty('--swatch-a', c.swatch[0]);
        btn.style.setProperty('--swatch-b', c.swatch[1]);
        const head = el('span', undefined, 'course-card__head');
        head.append(el('span', c.name, 'course-card__name'));
        if (c.badge) head.append(el('span', c.badge, 'course-card__badge'));
        const meta = el('span', undefined, 'course-card__meta');
        const diff = el('span', c.difficulty, 'diff');
        diff.dataset.level = c.difficulty;
        meta.append(diff, el('span', c.meta));
        const best = el('span', undefined, 'course-card__best');
        if (c.bestMs !== null) best.append(el('span', 'your best', 'course-card__best-label'), el('span', formatTime(c.bestMs)));
        btn.append(head, best, meta, el('span', c.blurb, 'course-card__blurb'));
        btn.addEventListener('click', () => this.onSelectCourse?.(c.id));
        return btn;
      }),
    );
    this.setSelectedCourse(selected);
  }

  setSelectedCourse(id: string): void {
    for (const btn of this.courseList.querySelectorAll<HTMLButtonElement>('.course-card')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === id));
    }
    this.selectedId = id;
    this.renderRaceLabel();
  }

  private selectedId = '';

  private renderRaceLabel(): void {
    const name = this.courseNames.get(this.selectedId) ?? '';
    this.raceCourse.textContent = this.raceVs ? `${name} · vs ${this.raceVs}` : name;
  }

  /** "Race · Speed Demon · vs Wave Rider" while a leaderboard ghost is picked. */
  setRaceVs(name: string | null): void {
    this.raceVs = name;
    this.renderRaceLabel();
  }

  /** The selected course's top times on the start screen. Click one to race its ghost. */
  setHomeBoard(view: BoardView, courseName: string): void {
    const box = this.homeBoard;
    const head = el('div', undefined, 'home__board-head');
    head.append(el('span', 'Top times', 'panel__title'));
    if (view.state === 'ready' && view.rows.length > 0) head.append(el('span', 'pick one to race its ghost', 'home__board-hint'));
    const list = boardList(view, 'home', (row) => this.onBoardPick?.(row.id));
    list.setAttribute('aria-label', `Top times on ${courseName}`);
    box.replaceChildren(head, list);
    if (view.note) box.append(el('p', view.note, 'board__note'));
  }

  /** Ids of the start-screen course cards, in order (for arrow-key picking). */
  courseIds(): string[] {
    return [...this.courseNames.keys()];
  }

  /** Colour the A/D keys in "How to surf" like the selected course's ramps. */
  setRampColors(right: string, left: string): void {
    this.root.style.setProperty('--ramp-right', right);
    this.root.style.setProperty('--ramp-left', left);
  }

  // --- lobby -----------------------------------------------------------------

  /** Render (or refresh) the room lobby. Keeps the name field intact while you type in it. */
  showLobby(view: LobbyView): void {
    if (!this.lobbyBuilt) this.buildLobby();
    const l = this.lobby;
    const q = (sel: string): HTMLElement => l.querySelector<HTMLElement>(sel)!;

    q('.lobby__code').textContent = view.code;
    q('.lobby__count').textContent = `${view.players.length}/${view.maxPlayers} players`;
    q('.lobby__players').replaceChildren(
      ...view.players.map((p) => {
        const li = el('li', undefined, 'lobby__player');
        const dot = el('span', undefined, 'dot');
        dot.style.background = p.color;
        li.append(dot, el('span', p.isMe ? `${p.name} (you)` : p.name, 'lobby__name'));
        if (p.isHost) li.append(el('span', 'host', 'tag tag--host'));
        if (p.status) li.append(el('span', p.status, 'tag'));
        li.append(el('span', p.ready ? '✓ ready' : '', 'lobby__ready'));
        return li;
      }),
    );

    const nameInput = l.querySelector<HTMLInputElement>('#lobby-name')!;
    if (document.activeElement !== nameInput) nameInput.value = view.myName;
    const ready = q('.lobby__ready-btn') as HTMLButtonElement;
    ready.textContent = view.myReady ? '✓ Ready' : 'Ready up';
    ready.setAttribute('aria-pressed', String(view.myReady));
    ready.hidden = view.isHost; // the host starts the race; readiness is for everyone else

    const card = q('.lobby__course');
    card.style.setProperty('--swatch-a', view.course.swatch[0]);
    card.style.setProperty('--swatch-b', view.course.swatch[1]);
    q('.lobby__course-name').textContent = view.course.name;
    q('.lobby__course-meta').textContent = [view.course.difficulty, view.course.theme, view.course.bestMs !== null ? `your best ${formatTime(view.course.bestMs)}` : '']
      .filter(Boolean)
      .join(' · ');
    q('.lobby__course-detail').textContent = view.course.detail;

    const choices = q('.lobby__choices');
    choices.hidden = !view.isHost;
    choices.replaceChildren(
      ...view.courseChoices.map((c) => {
        const b = button(c.label, 'chip', () => this.onLobbyCourse?.(c.id));
        b.setAttribute('aria-pressed', String(c.selected));
        b.disabled = view.raceInProgress;
        return b;
      }),
    );

    const start = q('.lobby__start') as HTMLButtonElement;
    start.hidden = !view.isHost;
    start.textContent = view.startLabel;
    start.disabled = !view.canStart;
    q('.lobby__waiting').hidden = view.isHost;
    q('.lobby__waiting').textContent = view.raceInProgress ? 'A race is under way — watch it, or wait for the next one.' : 'Waiting for the host to start the race…';
    q('.lobby__spectate').hidden = !view.raceInProgress;
    q('.lobby__warning').textContent = view.warning;
    q('.lobby__warning').hidden = view.warning === '';

    if (this.current !== 'lobby') this.show('lobby');
  }

  private buildLobby(): void {
    this.lobbyBuilt = true;
    const l = this.lobby;
    l.replaceChildren();

    const header = el('div', undefined, 'lobby__header');
    const heading = el('h2', 'Room ');
    heading.id = 'lobby-heading';
    heading.append(el('span', '', 'lobby__code'));
    header.append(
      heading,
      el('span', '', 'lobby__count'),
      button('Copy invite link', 'btn btn--ghost btn--small', () => this.onLobbyCopyLink?.()),
      button('Leave', 'btn btn--ghost btn--small', () => this.onLobbyLeave?.()),
    );

    const body = el('div', undefined, 'lobby__body');
    const left = el('div', undefined, 'lobby__col');
    left.append(el('h3', 'Players'), el('ul', undefined, 'lobby__players'));
    const me = el('div', undefined, 'lobby__me');
    const label = el('label', 'Your name', 'lobby__label');
    label.htmlFor = 'lobby-name';
    const name = el('input', undefined, 'input');
    name.id = 'lobby-name';
    name.maxLength = 16;
    name.spellcheck = false;
    name.autocomplete = 'off';
    name.addEventListener('change', () => this.onLobbyName?.(name.value));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
    me.append(label, name, button('Ready up', 'btn btn--ghost btn--small lobby__ready-btn', () => this.onLobbyReady?.()));
    left.append(me);

    const right = el('div', undefined, 'lobby__col');
    const card = el('div', undefined, 'lobby__course course-card');
    card.append(el('span', '', 'course-card__name lobby__course-name'), el('span', '', 'course-card__meta lobby__course-meta'), el('span', '', 'course-card__blurb lobby__course-detail'));
    right.append(el('h3', 'Course'), card, el('div', undefined, 'lobby__choices'));

    body.append(left, right);

    const actions = el('div', undefined, 'btn-row lobby__actions');
    actions.append(
      button('Start race', 'btn btn--primary lobby__start', () => this.onLobbyStart?.()),
      el('p', '', 'lobby__waiting'),
      button('Spectate the race', 'btn btn--ghost lobby__spectate', () => this.onLobbySpectate?.()),
    );

    const solo = el('div', undefined, 'lobby__solo');
    solo.append(
      el('span', 'Testing alone?', 'lobby__solo-label'),
      button('Open a second tab', 'btn btn--ghost btn--small', () => this.onLobbySecondTab?.()),
      button('Race the dev ghost', 'btn btn--ghost btn--small', () => this.onLobbyPractice?.()),
    );

    l.append(header, body, el('p', '', 'results__note lobby__warning'), actions, solo, el('p', '', 'message'));
    this.messages.push(...l.querySelectorAll<HTMLElement>('.message'));
  }

  // --- results ---------------------------------------------------------------

  showResults(view: ResultsView): void {
    const card = this.results;
    card.replaceChildren();
    card.classList.toggle('results--board', view.board !== undefined);
    this.standingsTable = null;
    this.resultsRoomNote = null;
    this.resultsBoard = null;
    const r = el('div', undefined, 'results__main');
    card.append(r);
    if (view.board) {
      this.resultsBoard = el('section', undefined, 'results__side');
      this.resultsBoard.setAttribute('aria-labelledby', 'results-board-title');
      card.append(this.resultsBoard);
      this.updateResultsBoard(view.board);
    }

    const badge = el('div', 'New personal best!', 'results__badge');
    badge.hidden = !view.isBest;
    const heading = el('h2', 'Finished');
    heading.id = 'results-heading';
    r.append(badge, el('p', view.courseName, 'results__course'), heading, el('div', formatTime(view.timeMs), 'results__time'));

    const delta = el('p', view.deltaMs === null ? 'First finish on this course' : `${formatDelta(view.deltaMs)} vs your best`, 'results__delta');
    delta.dataset.tone = view.isBest && view.deltaMs !== null ? 'ahead' : tone(view.deltaMs);
    r.append(delta);

    if (view.room) {
      this.standingsTable = el('table', undefined, 'results__table results__standings');
      r.append(this.standingsTable);
      this.updateStandings(view.room.standings, view.room.raceOver, view.room.isHost);
    } else if (view.splits.length > 0) {
      const table = el('table', undefined, 'results__table');
      const head = el('tr');
      head.append(el('th', 'Split'), el('th', 'Time'), el('th', 'vs best'));
      table.append(head);
      for (const s of view.splits) {
        const row = el('tr');
        const d = el('td', s.deltaMs === null ? '—' : formatDelta(s.deltaMs));
        d.dataset.tone = tone(s.deltaMs);
        row.append(el('td', s.label), el('td', s.timeMs === null ? 'missed' : formatTime(s.timeMs)), d);
        table.append(row);
      }
      r.append(table);
    }

    const stats = el('div', undefined, 'results__stats');
    const stat = (label: string, value: string): HTMLElement => {
      const span = el('span', `${label} `);
      span.append(el('strong', value));
      return span;
    };
    stats.append(stat('Top speed', `${Math.round(view.topSpeed).toLocaleString()} u/s`));
    if (view.rank !== null && view.runs !== null) {
      stats.append(stat('Rank', `#${view.rank} of ${view.runs} ${view.runs === 1 ? 'run' : 'runs'}`));
    }
    for (const rival of view.rivals) {
      stats.append(stat(rival.label, `${formatTime(rival.timeMs)} (${formatDelta(view.timeMs - rival.timeMs)})`));
    }
    r.append(stats);

    const buttons = el('div', undefined, 'btn-row');
    if (view.room) {
      buttons.append(button('Back to lobby', 'btn btn--primary', () => this.onBackToLobby?.()));
      if (view.room.isHost) {
        const end = button('End race for everyone', 'btn btn--ghost results__end', () => this.onEndRace?.());
        end.hidden = view.room.raceOver;
        buttons.append(end);
      }
      r.append(buttons);
      this.resultsRoomNote = el('p', '', 'hint');
      r.append(this.resultsRoomNote);
      this.updateStandings(view.room.standings, view.room.raceOver, view.room.isHost);
    } else {
      const again = button('Race again', 'btn btn--primary', () => this.onRaceAgain?.());
      buttons.append(
        again,
        view.backToLobby ? button('Back to lobby', 'btn btn--ghost', () => this.onBackToLobby?.()) : button('Menu', 'btn btn--ghost', () => this.onMenu?.()),
      );
      if (view.canSaveDevGhost) buttons.append(button('Save as dev ghost', 'btn btn--ghost', () => this.onSaveDevGhost?.()));
      r.append(buttons, el('p', 'R or Enter to race again · M for the menu', 'hint'));
    }
    r.append(el('p', view.note, 'results__note'));
    this.show('results');
  }

  /** Refresh the leaderboard on the results screen (posting finishes after it appears). */
  updateResultsBoard(view: ResultsBoardView): void {
    const side = this.resultsBoard;
    if (!side) return;
    const heading = el('h3', 'Leaderboard', 'results__board-title');
    heading.id = 'results-board-title';
    const status = el('p', view.status, 'results__board-status');
    const list = boardList(view.board, 'results', (row) => this.onBoardRace?.(row.id));
    side.replaceChildren(heading, status, list);
    if (view.board.note) side.append(el('p', view.board.note, 'board__note'));
    if (view.postingAs !== null) side.append(this.nameLine(view.postingAs));
  }

  /** "Posting as Surfer 123 · Change name", which turns into a name field. */
  private nameLine(name: string): HTMLElement {
    const line = el('p', undefined, 'results__name');
    const show = (): void => {
      line.replaceChildren(document.createTextNode('Posting as '), el('strong', name), document.createTextNode(' · '));
      line.append(
        button('Change name', 'link-btn', () => {
          const input = el('input', undefined, 'input input--name');
          input.value = name;
          input.maxLength = 16;
          input.spellcheck = false;
          input.autocomplete = 'off';
          input.setAttribute('aria-label', 'Your name on the leaderboard');
          let done = false;
          const finish = (save: boolean): void => {
            if (done) return;
            done = true;
            if (save && input.value.trim() !== '' && input.value !== name) this.onChangeName?.(input.value);
            else show();
          };
          input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // R / Enter / M mean something on this screen
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
          });
          input.addEventListener('blur', () => finish(true));
          line.replaceChildren(document.createTextNode('Name: '), input);
          input.focus();
          input.select();
        }),
      );
    };
    show();
    return line;
  }

  /** Refresh the live standings on a multiplayer results screen. */
  updateStandings(rows: readonly StandingRow[], raceOver: boolean, isHost: boolean): void {
    const table = this.standingsTable;
    if (!table) return;
    const head = el('tr');
    head.append(el('th', '#'), el('th', 'Player'), el('th', 'Time'));
    table.replaceChildren(
      head,
      ...rows.map((s) => {
        const row = el('tr');
        if (s.isMe) row.className = 'is-me';
        const nameCell = el('td');
        const dot = el('span', undefined, 'dot');
        dot.style.background = s.color;
        nameCell.append(dot, document.createTextNode(s.isMe ? `${s.name} (you)` : s.name));
        row.append(el('td', s.place === null ? '–' : String(s.place)), nameCell, el('td', s.timeMs === null ? s.status : formatTime(s.timeMs)));
        return row;
      }),
    );
    if (this.resultsRoomNote) {
      this.resultsRoomNote.textContent = raceOver
        ? isHost
          ? 'Race over. Head back to the lobby to start a rematch.'
          : 'Race over. Head back to the lobby for the rematch.'
        : 'Waiting for the others to finish…';
    }
    const end = this.results.querySelector<HTMLElement>('.results__end');
    if (end) end.hidden = raceOver;
  }

  toast(text: string, ms = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.classList.remove('toast--in');
    void this.toastEl.offsetWidth; // restart the CSS animation
    this.toastEl.classList.add('toast--in');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, ms);
  }

  setDebugVisible(visible: boolean): void {
    this.debugHud.hidden = !visible;
  }

  setDebugText(text: string): void {
    if (this.debugHud.textContent !== text) this.debugHud.textContent = text;
  }

  private bindActions(scope: HTMLElement): void {
    const handlers: Record<string, () => void> = {
      engage: () => this.onEngage?.(),
      restart: () => this.onRestart?.(),
      menu: () => this.onMenu?.(),
      'leave-race': () => this.onLeaveRace?.(),
      'create-room': () => this.onCreateRoom?.(),
      'open-generator': () => this.onOpenGenerator?.(),
    };
    for (const btn of scope.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      if (btn.dataset.bound) continue;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        btn.blur();
        handlers[btn.dataset.action ?? '']?.();
      });
    }
  }
}
