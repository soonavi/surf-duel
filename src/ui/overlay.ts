import { formatDelta, formatTime } from '../game/time';

export type OverlayScreen = 'start' | 'loading' | 'lobby' | 'pause' | 'results' | 'unsupported' | 'none';

export interface CourseCard {
  id: string;
  name: string;
  difficulty: string;
  blurb: string;
  swatch: [string, string];
  /** Your best time on this course, if any. */
  bestMs: number | null;
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

/**
 * Full-screen HTML overlays (start, loading, lobby, pause, results), toasts,
 * the connection banner and the debug readout. In-race HUD elements live in hud.ts.
 */
export class Overlay {
  onEngage: (() => void) | null = null;
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

  private readonly root: HTMLElement;
  private readonly screens: Record<Exclude<OverlayScreen, 'none'>, HTMLElement>;
  private readonly messages: HTMLElement[];
  private readonly debugHud: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly courseList: HTMLElement;
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
        <div class="card card--hero">
          <h1 class="title">SURF DUEL</h1>
          <p class="pitch">Slide the ramps. Race your friends. Build courses with AI.</p>
          <div class="course-list" role="group" aria-label="Choose a course"></div>
          <button class="btn btn--primary" data-action="engage" type="button">Play solo</button>
          <div class="mp-block">
            <span class="mp-block__label">Multiplayer</span>
            <button class="btn btn--ghost btn--small" data-action="create-room" type="button">Create room</button>
            <form class="join-form" autocomplete="off">
              <label class="visually-hidden" for="join-code">Room code</label>
              <input id="join-code" class="input input--code" maxlength="6" placeholder="CODE" spellcheck="false" />
              <button class="btn btn--ghost btn--small" type="submit">Join</button>
            </form>
          </div>
          <p class="message" role="status" aria-live="polite"></p>
          <p class="hint hint--howto">
            On a ramp to your <em>right</em>, hold <kbd>D</kbd>. To your <em>left</em>, hold <kbd>A</kbd>.
            Steer with the mouse, and don't press <kbd>W</kbd>.
          </p>
          <p class="hint">
            <span><kbd>Space</kbd> jump (hold to bunny-hop) &nbsp;·&nbsp; <kbd>R</kbd> last checkpoint &nbsp;·&nbsp;
            <kbd>Shift</kbd><kbd>R</kbd> restart &nbsp;·&nbsp; <kbd>Esc</kbd> pause</span>
          </p>
          <p class="phase-tag">Phase 4 · multiplayer rooms</p>
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
    for (const [name, element] of Object.entries(this.screens)) element.hidden = name !== screen;
    this.crosshair.hidden = screen !== 'none';
    if (screen !== 'none') this.setMessage('');
    // Move focus to the screen's main button for keyboard players.
    const primary = screen === 'none' ? null : this.screens[screen].querySelector<HTMLButtonElement>('.btn--primary:not([disabled])');
    primary?.focus({ preventScroll: true });
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
    const resume = this.screens.pause.querySelector<HTMLButtonElement>('[data-action="engage"]');
    if (resume) resume.textContent = mode === 'room-grab' ? 'Take control' : 'Resume';
    for (const e of this.screens.pause.querySelectorAll<HTMLElement>('[data-mode]')) e.hidden = e.dataset.mode !== (room ? 'room' : 'solo');
  }

  setCourses(cards: readonly CourseCard[], selected: string): void {
    this.courseList.replaceChildren(
      ...cards.map((c) => {
        const btn = el('button', undefined, 'course-card');
        btn.type = 'button';
        btn.dataset.id = c.id;
        btn.setAttribute('aria-pressed', String(c.id === selected));
        btn.style.setProperty('--swatch-a', c.swatch[0]);
        btn.style.setProperty('--swatch-b', c.swatch[1]);
        const meta = c.bestMs !== null ? `${c.difficulty} · best ${formatTime(c.bestMs)}` : c.difficulty;
        btn.append(el('span', c.name, 'course-card__name'), el('span', meta, 'course-card__meta'), el('span', c.blurb, 'course-card__blurb'));
        btn.addEventListener('click', () => this.onSelectCourse?.(c.id));
        return btn;
      }),
    );
  }

  setSelectedCourse(id: string): void {
    for (const btn of this.courseList.querySelectorAll<HTMLButtonElement>('.course-card')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === id));
    }
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
    const r = this.results;
    r.replaceChildren();
    this.standingsTable = null;
    this.resultsRoomNote = null;

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
