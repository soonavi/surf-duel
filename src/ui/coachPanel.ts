import { parseCoachText, type CoachKey, type CoachKeys, type CoachPrompt } from '../game/tutorialCoach';

const KEYS: readonly { key: CoachKey; label: string }[] = [
  { key: 'w', label: 'W' },
  { key: 'a', label: 'A' },
  { key: 's', label: 'S' },
  { key: 'd', label: 'D' },
  { key: 'space', label: 'Space' },
];

const HINT_ICON: Record<CoachPrompt['tone'], string> = { good: '✓', warn: '!', info: '→' };

/**
 * The Tutorial coach on the HUD: a live W A S D / Space display (keys to
 * hold pulse, keys to let go of turn orange while held), the lesson (with a
 * step counter; it fades in when it changes), a one-line live hint about
 * your keys, and a note line for things that just happened.
 */
export class CoachPanel {
  private readonly root: HTMLElement;
  private readonly lessonEl: HTMLElement;
  private readonly lessonTitle: HTMLElement;
  private readonly lessonStep: HTMLElement;
  private readonly lessonText: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly hintIcon: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly noteTitle: HTMLElement;
  private readonly noteText: HTMLElement;
  private readonly keyEls = new Map<CoachKey, HTMLElement>();
  private lesson: CoachPrompt | null = null;
  private hint: CoachPrompt | null = null;
  private note: CoachPrompt | null = null;
  private stepText = '';
  private keyState = '';
  private rampColors = { right: '#ff4fd8', left: '#3ee6ff' };

  constructor(parent: HTMLElement) {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      e.className = className;
      return e;
    };
    this.root = el('div', 'coach');
    this.root.hidden = true;

    const keys = el('div', 'coach__keys');
    keys.setAttribute('aria-hidden', 'true');
    for (const { key, label } of KEYS) {
      const k = el('span', `coach__key coach__key--${key}`);
      k.textContent = label;
      keys.append(k);
      this.keyEls.set(key, k);
    }

    const body = el('div', 'coach__body');
    this.lessonEl = el('div', 'coach__lesson');
    this.lessonEl.setAttribute('role', 'status');
    this.lessonEl.setAttribute('aria-live', 'polite');
    const head = el('div', 'coach__head');
    this.lessonTitle = el('span', 'coach__title');
    this.lessonStep = el('span', 'coach__step');
    head.append(this.lessonTitle, this.lessonStep);
    this.lessonText = el('p', 'coach__text');
    this.lessonEl.append(head, this.lessonText);

    this.hintEl = el('div', 'coach__hint');
    this.hintEl.hidden = true;
    this.hintIcon = el('span', 'coach__hint-icon');
    this.hintIcon.setAttribute('aria-hidden', 'true');
    this.hintText = el('span', 'coach__hint-text');
    this.hintEl.append(this.hintIcon, this.hintText);

    this.noteEl = el('div', 'coach__note');
    this.noteEl.setAttribute('role', 'status');
    this.noteEl.hidden = true;
    this.noteTitle = el('span', 'coach__note-title');
    this.noteText = el('span', 'coach__note-text');
    this.noteEl.append(this.noteTitle, this.noteText);

    body.append(this.lessonEl, this.hintEl, this.noteEl);
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
    if (this.hint) this.fill(this.hintText, this.hint.text);
    if (this.note) this.fill(this.noteText, this.note.text);
  }

  /** Call every frame; only touches the DOM when something changed. */
  render(lesson: CoachPrompt | null, hint: CoachPrompt | null, note: CoachPrompt | null, step: { index: number; total: number } | null, keys: CoachKeys): void {
    if (lesson !== this.lesson) {
      this.lesson = lesson;
      this.lessonEl.hidden = lesson === null;
      if (lesson) {
        this.lessonEl.dataset.tone = lesson.tone;
        this.lessonTitle.textContent = lesson.title;
        this.fill(this.lessonText, lesson.text);
        this.replay(this.lessonEl, 'coach__lesson--in');
      }
    }
    const stepText = step && lesson ? `Step ${step.index} of ${step.total}` : '';
    if (stepText !== this.stepText) {
      this.stepText = stepText;
      this.lessonStep.textContent = stepText;
    }
    if (hint !== this.hint) {
      this.hint = hint;
      this.hintEl.hidden = hint === null;
      if (hint) {
        this.hintEl.dataset.tone = hint.tone;
        this.hintIcon.textContent = HINT_ICON[hint.tone];
        this.fill(this.hintText, hint.text);
      }
    }
    if (note !== this.note) {
      this.note = note;
      this.noteEl.hidden = note === null;
      if (note) {
        this.noteEl.dataset.tone = note.tone;
        this.noteTitle.textContent = note.title;
        this.fill(this.noteText, note.text);
        this.replay(this.noteEl, 'coach__note--in');
      }
    }
    this.root.classList.toggle('coach--empty', lesson === null && hint === null && note === null);

    // The key display follows the live hint (what to press right now), else the lesson.
    const guide = hint ?? lesson;
    const hold = guide?.hold ?? [];
    const avoid = guide?.avoid ?? [];
    const state = KEYS.map(({ key }) => `${keys[key] ? 1 : 0}${hold.includes(key) ? 1 : 0}${avoid.includes(key) ? 1 : 0}`).join();
    if (state === this.keyState) return;
    this.keyState = state;
    for (const { key } of KEYS) {
      const k = this.keyEls.get(key)!;
      const down = keys[key];
      k.classList.toggle('is-down', down);
      k.classList.toggle('is-target', hold.includes(key));
      k.classList.toggle('is-wrong', down && avoid.includes(key));
    }
  }

  /** Restart a CSS entrance animation. */
  private replay(element: HTMLElement, className: string): void {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  private fill(element: HTMLElement, text: string): void {
    element.replaceChildren(
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
