import { parseCoachText, type CoachKey, type CoachKeys, type CoachPrompt } from '../game/tutorialCoach';

const KEYS: readonly { key: CoachKey; label: string }[] = [
  { key: 'w', label: 'W' },
  { key: 'a', label: 'A' },
  { key: 's', label: 'S' },
  { key: 'd', label: 'D' },
  { key: 'space', label: 'Space' },
];

/**
 * The Tutorial coach on the HUD: a live W A S D / Space display (keys you
 * should hold pulse, keys you should let go of turn orange while held), the
 * current lesson, and a note line for things that just happened.
 */
export class CoachPanel {
  private readonly root: HTMLElement;
  private readonly lessonEl: HTMLElement;
  private readonly lessonTitle: HTMLElement;
  private readonly lessonText: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly noteTitle: HTMLElement;
  private readonly noteText: HTMLElement;
  private readonly keyEls = new Map<CoachKey, HTMLElement>();
  private lesson: CoachPrompt | null = null;
  private note: CoachPrompt | null = null;
  private keyState = '';
  private rampColors = { right: '#ff4fd8', left: '#3ee6ff' };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'coach';
    this.root.hidden = true;

    const keys = document.createElement('div');
    keys.className = 'coach__keys';
    keys.setAttribute('aria-hidden', 'true');
    for (const { key, label } of KEYS) {
      const el = document.createElement('span');
      el.className = `coach__key coach__key--${key}`;
      el.textContent = label;
      keys.append(el);
      this.keyEls.set(key, el);
    }

    const body = document.createElement('div');
    body.className = 'coach__body';
    this.lessonEl = document.createElement('div');
    this.lessonEl.className = 'coach__lesson';
    this.lessonEl.setAttribute('role', 'status');
    this.lessonEl.setAttribute('aria-live', 'polite');
    this.lessonTitle = document.createElement('div');
    this.lessonTitle.className = 'coach__title';
    this.lessonText = document.createElement('p');
    this.lessonText.className = 'coach__text';
    this.lessonEl.append(this.lessonTitle, this.lessonText);

    this.noteEl = document.createElement('div');
    this.noteEl.className = 'coach__note';
    this.noteEl.setAttribute('role', 'status');
    this.noteEl.hidden = true;
    this.noteTitle = document.createElement('span');
    this.noteTitle.className = 'coach__note-title';
    this.noteText = document.createElement('span');
    this.noteText.className = 'coach__note-text';
    this.noteEl.append(this.noteTitle, this.noteText);

    body.append(this.lessonEl, this.noteEl);
    this.root.append(keys, body);
    parent.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** The theme's ramp colours, for the "which key" swatches. */
  setRampColors(right: string, left: string): void {
    this.rampColors = { right, left };
    if (this.lesson) this.fill(this.lessonText, this.lesson.text);
    if (this.note) this.fill(this.noteText, this.note.text);
  }

  /** Call every frame; only touches the DOM when something changed. */
  render(lesson: CoachPrompt | null, note: CoachPrompt | null, keys: CoachKeys): void {
    if (lesson !== this.lesson) {
      this.lesson = lesson;
      this.lessonEl.hidden = lesson === null;
      if (lesson) {
        this.lessonEl.dataset.tone = lesson.tone;
        this.lessonTitle.textContent = lesson.title;
        this.fill(this.lessonText, lesson.text);
      }
    }
    if (note !== this.note) {
      this.note = note;
      this.noteEl.hidden = note === null;
      if (note) {
        this.noteEl.dataset.tone = note.tone;
        this.noteTitle.textContent = note.title;
        this.fill(this.noteText, note.text);
        this.noteEl.classList.remove('coach__note--in');
        void this.noteEl.offsetWidth; // restart the animation
        this.noteEl.classList.add('coach__note--in');
      }
    }
    this.root.classList.toggle('coach--empty', lesson === null && note === null);

    const hold = lesson?.hold ?? [];
    const avoid = lesson?.avoid ?? [];
    const state = KEYS.map(({ key }) => `${keys[key] ? 1 : 0}${hold.includes(key) ? 1 : 0}${avoid.includes(key) ? 1 : 0}`).join();
    if (state === this.keyState) return;
    this.keyState = state;
    for (const { key } of KEYS) {
      const el = this.keyEls.get(key)!;
      const down = keys[key];
      el.classList.toggle('is-down', down);
      el.classList.toggle('is-target', hold.includes(key));
      el.classList.toggle('is-wrong', down && avoid.includes(key));
    }
  }

  private fill(el: HTMLElement, text: string): void {
    el.replaceChildren(
      ...parseCoachText(text).map((part) => {
        if (part.kind === 'text') return document.createTextNode(part.value);
        if (part.kind === 'key') {
          const kbd = document.createElement('kbd');
          kbd.textContent = part.value;
          return kbd;
        }
        const swatch = document.createElement('span');
        swatch.className = 'coach__swatch';
        swatch.style.background = this.rampColors[part.value];
        swatch.title = part.value === 'right' ? 'Ramp on your right' : 'Ramp on your left';
        return swatch;
      }),
    );
  }
}
