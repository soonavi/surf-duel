/**
 * The AI course generator screens:
 *  - "generate": prompt box with example prompts, a share-code box, and a
 *    friendly loading/error state (errors always offer a random course).
 *  - "preview": a card over the flyover camera with the course's name, its
 *    prompt and share code, and Race / Regenerate / New prompt.
 * Pure DOM; the App decides what each button does.
 */
import { PROMPT_MAX_CHARS } from '../course/aiSchema.js';
import { DIFFICULTIES, type Difficulty } from '../course/schema.js';
import { likeButton, type LikeButton, type LikeView } from './likeButton.js';

/** The difficulty picker: a label and what to expect from each. */
const DIFFICULTY_CHOICES: Readonly<Record<Difficulty, { label: string; note: string }>> = {
  easy: { label: 'Easy', note: 'Wide, gentle ramps. Good for a first run.' },
  medium: { label: 'Medium', note: 'Steeper ramps and bigger bends.' },
  hard: { label: 'Hard', note: 'Short ramps, each off to the side of the last: air-strafe across or fall. Fewer checkpoints.' },
  expert: { label: 'Expert', note: 'Narrow ramps, long sideways transfers, few checkpoints. For surf veterans.' },
};

export const EXAMPLE_PROMPTS: readonly string[] = [
  'long sweeping ramps over lava, one huge drop',
  'a gentle icy run for beginners',
  'short and brutal: steep ramps, big gaps',
  'neon city highway with boosters everywhere',
  'all pink, with a big drop and boosters',
];

const LOADING_LINES: readonly string[] = [
  'Pouring the ramps…',
  'Waxing the surf faces…',
  'Bribing gravity…',
  'Measuring the drops…',
  'Hanging the checkpoint gates…',
  'Asking for something steep…',
];

export interface PreviewView {
  /** "AI course", "Shared course", "Random course". */
  eyebrow: string;
  name: string;
  meta: string;
  prompt: string | null;
  code: string | null;
  /** Shown instead of the code when there isn't one. */
  codeNote: string;
  primaryLabel: string;
  /** False in view-only mode (touch devices): the race button is shown but disabled. */
  canRace?: boolean;
  canRegenerate: boolean;
  /** The thumbs up, for a course with a share code. */
  like: LikeView | null;
}

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

export class GeneratorUi {
  onGenerate: ((prompt: string, difficulty: Difficulty) => void) | null = null;
  onLoadCode: ((code: string) => void) | null = null;
  onRandom: (() => void) | null = null;
  onBack: (() => void) | null = null;
  onRace: (() => void) | null = null;
  onRegenerate: (() => void) | null = null;
  onNewPrompt: (() => void) | null = null;
  onCopyLink: (() => void) | null = null;
  onPreviewBack: (() => void) | null = null;
  onLike: (() => void) | null = null;

  readonly generateScreen: HTMLElement;
  readonly previewScreen: HTMLElement;
  private readonly promptBox: HTMLTextAreaElement;
  private readonly counter: HTMLElement;
  private readonly generateBtn: HTMLButtonElement;
  private readonly codeInput: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly statusActions: HTMLElement;
  private readonly spinner: HTMLElement;
  private readonly examples: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly preview: HTMLElement;
  private readonly difficultyChips: HTMLButtonElement[] = [];
  private readonly difficultyNote: HTMLElement;
  private difficultyValue: Difficulty = 'medium';
  private previewLike: LikeButton | null = null;
  private loadingTimer = 0;

  constructor() {
    // --- generate ---------------------------------------------------------------
    this.generateScreen = el('section', undefined, 'overlay');
    this.generateScreen.dataset.screen = 'generate';
    this.generateScreen.hidden = true;
    const card = el('div', undefined, 'card gen');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'gen-heading');
    const heading = el('h2', 'Design a course with AI');
    heading.id = 'gen-heading';

    const form = el('form', undefined, 'gen__form');
    form.autocomplete = 'off';
    const label = el('label', 'Describe the course you want', 'gen__label');
    label.htmlFor = 'gen-prompt';
    this.promptBox = el('textarea', undefined, 'input gen__prompt');
    this.promptBox.id = 'gen-prompt';
    this.promptBox.rows = 2;
    this.promptBox.maxLength = PROMPT_MAX_CHARS;
    this.promptBox.placeholder = EXAMPLE_PROMPTS[0]!;
    this.promptBox.spellcheck = true;
    this.counter = el('span', `0/${PROMPT_MAX_CHARS}`, 'gen__counter');
    this.promptBox.addEventListener('input', () => this.updateCounter());
    this.promptBox.addEventListener('keydown', (e) => {
      // One-line prompts: Enter generates (Shift+Enter still makes a new line).
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    this.generateBtn = el('button', 'Generate', 'btn btn--primary');
    this.generateBtn.type = 'submit';

    // The difficulty is the player's pick, not the AI's guess from the description.
    const difficulty = el('div', undefined, 'gen__difficulty');
    const difficultyLabel = el('span', 'Difficulty', 'gen__label');
    difficultyLabel.id = 'gen-difficulty';
    const chips = el('div', undefined, 'settings__choices');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-labelledby', 'gen-difficulty');
    for (const d of DIFFICULTIES) {
      const chip = button(DIFFICULTY_CHOICES[d].label, 'chip', () => this.setDifficulty(d));
      chip.setAttribute('role', 'radio');
      chip.dataset.difficulty = d;
      this.difficultyChips.push(chip);
      chips.append(chip);
    }
    this.difficultyNote = el('p', '', 'hint gen__difficulty-note');
    difficulty.append(difficultyLabel, chips, this.difficultyNote);

    form.append(label, this.promptBox, this.counter, difficulty);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const prompt = this.promptBox.value.trim();
      if (prompt.length === 0) {
        this.promptBox.value = this.promptBox.placeholder;
        this.updateCounter();
      }
      this.onGenerate?.(this.promptBox.value.trim(), this.difficultyValue);
    });

    this.examples = el('div', undefined, 'gen__examples');
    this.examples.setAttribute('role', 'group');
    this.examples.setAttribute('aria-label', 'Example prompts');
    this.examples.append(
      ...EXAMPLE_PROMPTS.map((p) =>
        button(p, 'chip chip--example', () => {
          this.promptBox.value = p;
          this.updateCounter();
          this.promptBox.focus();
        }),
      ),
    );

    this.status = el('div', undefined, 'gen__status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.hidden = true;
    this.spinner = el('div', undefined, 'spinner spinner--small');
    this.spinner.setAttribute('aria-hidden', 'true');
    this.statusText = el('p', '', 'gen__status-text');
    this.statusActions = el('div', undefined, 'btn-row');
    this.status.append(this.spinner, this.statusText, this.statusActions);

    this.backBtn = button('Back', 'btn btn--ghost', () => this.onBack?.());
    const actions = el('div', undefined, 'btn-row');
    actions.append(this.generateBtn, this.backBtn);
    this.generateBtn.addEventListener('click', () => form.requestSubmit());
    this.generateBtn.type = 'button';

    const codeForm = el('form', undefined, 'gen__code');
    codeForm.autocomplete = 'off';
    const codeLabel = el('label', 'Have a share code?', 'gen__label');
    codeLabel.htmlFor = 'gen-code';
    this.codeInput = el('input', undefined, 'input input--code');
    this.codeInput.id = 'gen-code';
    this.codeInput.maxLength = 80; // a pasted share link works too
    this.codeInput.placeholder = 'K7M2QX';
    this.codeInput.spellcheck = false;
    codeForm.append(codeLabel, this.codeInput, el('button', 'Load', 'btn btn--ghost btn--small'));
    codeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.onLoadCode?.(this.codeInput.value);
    });

    const note = el('p', 'Courses are designed by the OpenAI API, then checked by the game so they are always beatable. Your prompt is saved with the course so friends can see what it was made from, so keep it friendly: links and rude words are turned away.', 'hint gen__note');

    card.append(heading, form, this.examples, actions, this.status, codeForm, note);
    this.generateScreen.append(card);

    // --- preview ----------------------------------------------------------------
    this.previewScreen = el('section', undefined, 'overlay overlay--preview');
    this.previewScreen.dataset.screen = 'preview';
    this.previewScreen.hidden = true;
    this.preview = el('div', undefined, 'card preview');
    this.preview.setAttribute('role', 'dialog');
    this.preview.setAttribute('aria-labelledby', 'preview-heading');
    this.previewScreen.append(this.preview);
    this.setDifficulty(this.difficultyValue);
  }

  get prompt(): string {
    return this.promptBox.value.trim();
  }

  get difficulty(): Difficulty {
    return this.difficultyValue;
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficultyValue = difficulty;
    for (const chip of this.difficultyChips) chip.setAttribute('aria-checked', String(chip.dataset.difficulty === difficulty));
    this.difficultyNote.textContent = DIFFICULTY_CHOICES[difficulty].note;
  }

  setPrompt(text: string): void {
    this.promptBox.value = text;
    this.updateCounter();
  }

  /** Room hosts design a course for the room; the back button says where it goes. */
  setBackLabel(text: string): void {
    this.backBtn.textContent = text;
  }

  focusPrompt(): void {
    this.promptBox.focus({ preventScroll: true });
  }

  /** Working: lock the form and cycle the fun loading lines. */
  setBusy(text?: string): void {
    window.clearInterval(this.loadingTimer);
    this.lock(true);
    this.status.hidden = false;
    this.status.dataset.tone = 'busy';
    this.spinner.hidden = false;
    this.statusActions.replaceChildren();
    let i = Math.floor(Math.random() * LOADING_LINES.length);
    this.statusText.textContent = text ?? LOADING_LINES[i]!;
    if (text === undefined) {
      this.loadingTimer = window.setInterval(() => {
        i = (i + 1) % LOADING_LINES.length;
        this.statusText.textContent = LOADING_LINES[i]!;
      }, 1600);
    }
  }

  /** Something went wrong: say so kindly and offer a way forward. */
  showError(message: string, offerRetry: boolean): void {
    window.clearInterval(this.loadingTimer);
    this.lock(false);
    this.status.hidden = false;
    this.status.dataset.tone = 'error';
    this.spinner.hidden = true;
    this.statusText.textContent = message;
    const random = button('Race a random course instead', 'btn btn--primary btn--small', () => this.onRandom?.());
    const row: HTMLElement[] = [random];
    if (offerRetry) row.push(button('Try again', 'btn btn--ghost btn--small', () => this.onGenerate?.(this.prompt, this.difficultyValue)));
    this.statusActions.replaceChildren(...row);
    random.focus({ preventScroll: true });
  }

  clearStatus(): void {
    window.clearInterval(this.loadingTimer);
    this.lock(false);
    this.status.hidden = true;
  }

  showPreview(view: PreviewView): void {
    const p = this.preview;
    const heading = el('h2', view.name, 'preview__name');
    heading.id = 'preview-heading';
    const parts: HTMLElement[] = [el('span', view.eyebrow, 'preview__eyebrow'), heading, el('p', view.meta, 'preview__meta')];
    if (view.prompt) parts.push(el('p', `“${view.prompt}”`, 'preview__prompt'));

    const share = el('div', undefined, 'preview__share');
    if (view.code) {
      share.append(el('span', 'Share code', 'preview__share-label'), el('span', view.code, 'preview__code'), button('Copy link', 'btn btn--ghost btn--small', () => this.onCopyLink?.()));
    } else {
      share.append(el('span', view.codeNote, 'preview__share-label'));
    }
    parts.push(share);
    this.previewLike = null;
    if (view.like) {
      this.previewLike = likeButton(() => this.onLike?.());
      this.previewLike.update(view.like);
      share.append(this.previewLike.element);
    }

    const actions = el('div', undefined, 'btn-row');
    const race = button(view.primaryLabel, 'btn btn--primary', () => this.onRace?.());
    race.disabled = view.canRace === false;
    actions.append(race);
    if (view.canRegenerate) actions.append(button('Regenerate', 'btn btn--ghost', () => this.onRegenerate?.()));
    actions.append(button('New prompt', 'btn btn--ghost', () => this.onNewPrompt?.()), button('Back', 'btn btn--ghost', () => this.onPreviewBack?.()));
    parts.push(actions);
    p.replaceChildren(...parts);
  }

  /** Refresh the preview's thumbs up (the like's reply arrives after it appears). */
  setLike(view: LikeView): void {
    this.previewLike?.update(view);
  }

  private lock(busy: boolean): void {
    this.promptBox.disabled = busy;
    this.generateBtn.disabled = busy;
    this.codeInput.disabled = busy;
    for (const chip of this.examples.querySelectorAll<HTMLButtonElement>('button')) chip.disabled = busy;
    for (const chip of this.difficultyChips) chip.disabled = busy;
  }

  private updateCounter(): void {
    this.counter.textContent = `${Array.from(this.promptBox.value).length}/${PROMPT_MAX_CHARS}`;
  }
}
