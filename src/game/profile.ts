/**
 * Who you are in multiplayer. The display name persists (localStorage); the
 * id is fresh per page load, so two tabs on one machine are two players —
 * which is exactly what testing multiplayer alone needs.
 */
import { sanitizeName } from '../net/roomLogic';
import { browserStorage } from './records';

const NAME_KEY = 'surfduel.name.v1';

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function defaultName(): string {
  return `Surfer ${Math.floor(100 + Math.random() * 900)}`;
}

export class Profile {
  readonly id = randomId();
  private current: string;

  constructor() {
    let stored: string | null = null;
    try {
      stored = browserStorage()?.getItem(NAME_KEY) ?? null;
    } catch {
      stored = null;
    }
    this.current = sanitizeName(stored ?? '', defaultName());
  }

  get name(): string {
    return this.current;
  }

  set name(value: string) {
    this.current = sanitizeName(value, this.current);
    try {
      browserStorage()?.setItem(NAME_KEY, this.current);
    } catch {
      // Not persisted; fine for this session.
    }
  }
}
