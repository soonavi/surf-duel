/**
 * The player-facing settings screen: mouse, field of view, sound (music
 * volume, effects volume, and where the music comes from: generated, your
 * own file, or off), graphics quality, assist mode, and the key list.
 * It edits the Settings object in place and calls onChange; the App applies
 * and saves. Pure DOM.
 */
import { SETTINGS_LIMITS, type GraphicsQuality, type MusicChoice, type Settings } from '../game/settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

const KEYS: readonly [string, string][] = [
  ['A / D', 'hold toward the ramp you are on'],
  ['Mouse', 'steer (never press W: speed comes from the slope)'],
  ['Space', 'jump (hold to bunny-hop)'],
  ['R', 'back to the last checkpoint'],
  ['Shift + R', 'restart the run'],
  ['Esc', 'pause / release the mouse'],
  ['Enter', 'race (start screen), race again (results)'],
  ['↑ / ↓', 'pick a course on the start screen'],
];

export class SettingsUi {
  onChange: (() => void) | null = null;
  onPickMusicFile: ((file: File) => void) | null = null;
  onBack: (() => void) | null = null;

  readonly screen: HTMLElement;
  private readonly syncs: (() => void)[] = [];
  private readonly fileLine: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  constructor(private readonly settings: Settings) {
    this.screen = el('section', undefined, 'overlay');
    this.screen.dataset.screen = 'settings';
    const card = el('div', undefined, 'card settings');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'settings-title');
    const title = el('h2', 'Settings');
    title.id = 'settings-title';

    const controls = this.section('Controls');
    controls.append(
      this.slider('Mouse sensitivity', 'sensitivity', SETTINGS_LIMITS.sensitivity.min, SETTINGS_LIMITS.sensitivity.max, SETTINGS_LIMITS.sensitivity.step, (v) => v.toFixed(2)),
      this.slider('Field of view', 'fov', SETTINGS_LIMITS.fov.min, SETTINGS_LIMITS.fov.max, 1, (v) => `${Math.round(v)}°`),
      this.checkbox('Invert mouse Y', 'invertY'),
      this.checkbox('Assist mode', 'assist', 'Steadier on ramps and in the air: good for trackpads and first runs. Times set with it get an assist badge on the leaderboard.'),
    );

    const graphics = this.section('Graphics');
    graphics.append(this.choice<GraphicsQuality>('Quality', 'graphics', [['high', 'High'], ['low', 'Low (faster)']]));

    const sound = this.section('Sound');
    this.fileInput = el('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) this.onPickMusicFile?.(file);
      this.fileInput.value = '';
    });
    const pick = el('button', 'Choose a music file…', 'btn btn--ghost btn--small');
    pick.type = 'button';
    pick.addEventListener('click', () => this.fileInput.click());
    this.fileLine = el('p', '', 'settings__file');
    const fileRow = el('div', undefined, 'settings__file-row');
    fileRow.append(pick, this.fileLine, this.fileInput);
    sound.append(
      this.slider('Music volume', 'musicVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      this.slider('Effects volume', 'sfxVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      this.choice<MusicChoice>('Music', 'music', [['generated', 'Generated'], ['file', 'My music'], ['off', 'Off']]),
      fileRow,
      el('p', 'Generated music is made live for each course, and builds up as you speed up. Your own file plays straight from your computer: it is never uploaded.', 'settings__note'),
    );

    const keys = this.section('Keys');
    const list = el('dl', undefined, 'settings__keys');
    for (const [key, what] of KEYS) list.append(el('dt', key), el('dd', what));
    keys.append(list);

    const columns = el('div', undefined, 'settings__columns');
    const left = el('div');
    left.append(controls, graphics);
    const right = el('div');
    right.append(sound);
    columns.append(left, right);

    const back = el('button', 'Done', 'btn btn--primary');
    back.type = 'button';
    back.addEventListener('click', () => this.onBack?.());
    const actions = el('div', undefined, 'btn-row settings__actions');
    actions.append(back);
    card.append(title, columns, keys, actions);
    this.screen.append(card);
    this.screen.hidden = true;
    this.refresh(null);
  }

  /** Open the file picker (call from a click: browsers only allow it then). */
  pickFile(): void {
    this.fileInput.click();
  }

  /** Re-read every control from the settings, and show the music file state. */
  refresh(fileName: string | null, fileProblem = ''): void {
    for (const sync of this.syncs) sync();
    if (fileProblem) this.fileLine.textContent = fileProblem;
    else if (fileName) this.fileLine.textContent = `Playing: ${fileName}`;
    else this.fileLine.textContent = this.settings.music === 'file' ? 'No file chosen yet (pick one each visit).' : '';
  }

  private changed(): void {
    for (const sync of this.syncs) sync();
    this.onChange?.();
  }

  private section(title: string): HTMLElement {
    const s = el('section', undefined, 'settings__section');
    s.append(el('h3', title, 'panel__title'));
    return s;
  }

  private slider(label: string, key: 'sensitivity' | 'fov' | 'musicVolume' | 'sfxVolume', min: number, max: number, step: number, show: (v: number) => string): HTMLElement {
    const row = el('label', undefined, 'settings__row');
    const value = el('span', '', 'settings__value');
    const input = el('input', undefined, 'settings__slider');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value);
      this.changed();
    });
    this.syncs.push(() => {
      input.value = String(this.settings[key]);
      value.textContent = show(this.settings[key]);
    });
    const head = el('span', undefined, 'settings__label');
    head.append(el('span', label), value);
    row.append(head, input);
    return row;
  }

  private checkbox(label: string, key: 'invertY' | 'assist', note?: string): HTMLElement {
    const row = el('label', undefined, 'settings__check');
    const input = el('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => {
      this.settings[key] = input.checked;
      this.changed();
    });
    this.syncs.push(() => {
      input.checked = this.settings[key];
    });
    const text = el('span');
    text.append(el('span', label, 'settings__check-label'));
    if (note) text.append(el('span', note, 'settings__note'));
    row.append(input, text);
    return row;
  }

  private choice<T extends string>(label: string, key: 'music' | 'graphics', options: [T, string][]): HTMLElement {
    const row = el('div', undefined, 'settings__row');
    row.append(el('span', label, 'settings__label'));
    const group = el('div', undefined, 'settings__choices');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const b = el('button', text, 'chip');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        (this.settings as unknown as Record<string, string>)[key] = value;
        this.changed();
      });
      this.syncs.push(() => b.setAttribute('aria-checked', String(this.settings[key] === value)));
      group.append(b);
    }
    row.append(group);
    return row;
  }
}
