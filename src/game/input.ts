/** Mouse deltas larger than this in a single event are treated as a browser glitch and dropped. */
const MOUSE_SPIKE_LIMIT = 1500;

/** Keys whose browser default (scrolling, focus moves, button activation) we suppress while playing. */
const SUPPRESSED_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Keyboard + pointer-locked mouse. Keys are tracked by `KeyboardEvent.code`, so
 * WASD stays in the same physical place on AZERTY/QWERTZ keyboards.
 */
export class Input {
  /** True while the pointer is locked to the game canvas. */
  locked = false;
  /** True when the current lock was granted with `unadjustedMovement`. */
  rawActive = false;

  onLockChange: ((locked: boolean) => void) | null = null;

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private dx = 0;
  private dy = 0;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('pointerlockchange', this.handleLockChange);
  }

  static get pointerLockSupported(): boolean {
    return typeof Element !== 'undefined' && 'requestPointerLock' in Element.prototype;
  }

  /**
   * Lock the pointer. Must be called from a user gesture (click/keypress).
   * Tries raw input first and falls back where the platform doesn't support it.
   * Rejects if the browser refuses (e.g. re-locking too soon after Esc).
   */
  async requestLock(raw: boolean): Promise<void> {
    if (raw) {
      try {
        await this.element.requestPointerLock({ unadjustedMovement: true });
        this.rawActive = true;
        return;
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'NotSupportedError')) throw err;
      }
    }
    this.rawActive = false;
    await this.element.requestPointerLock();
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical press (ignores key repeat). */
  consumePress(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Mouse movement accumulated since the last call. */
  consumeMouse(): { dx: number; dy: number } {
    const out = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return out;
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    // Typing into a text field (tuning panel, later name/prompt boxes) never drives the game.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.locked && SUPPRESSED_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressed.add(e.code);
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    if (Math.abs(e.movementX) > MOUSE_SPIKE_LIMIT || Math.abs(e.movementY) > MOUSE_SPIKE_LIMIT) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private readonly handleLockChange = (): void => {
    const locked = document.pointerLockElement === this.element;
    if (locked === this.locked) return;
    this.locked = locked;
    this.dx = 0;
    this.dy = 0;
    this.clear();
    this.onLockChange?.(locked);
  };

  /** Drop all held keys, e.g. when focus leaves the window, so nothing sticks. */
  private readonly clear = (): void => {
    this.down.clear();
    this.pressed.clear();
  };
}
