/**
 * Who you are. The display name persists (localStorage). Two ids:
 *  - `id`, fresh per page load, for multiplayer: two tabs on one machine are
 *    two players, which is exactly what testing multiplayer alone needs;
 *  - `boardId`, kept in localStorage, for the leaderboards: it keeps one
 *    entry (your best) per course. It's random, not a secret, and not shown.
 */
import { sanitizeName } from '../net/roomLogic.js';
import { browserStorage, type KeyValueStorage } from './records.js';

const NAME_KEY = 'surfduel.name.v1';
const BOARD_ID_KEY = 'surfduel.player.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A random v4 UUID (the leaderboard API insists on one). */
function randomUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    const h = hex.join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

const randomId = randomUuid;

/** The id stored under `key`, made (and stored, if possible) on first use. */
export function persistentId(storage: KeyValueStorage | null, key: string): string {
  try {
    const stored = storage?.getItem(key) ?? null;
    if (stored && UUID.test(stored)) return stored;
  } catch {
    // Unreadable storage: a fresh id for this session.
  }
  const id = randomUuid();
  try {
    storage?.setItem(key, id);
  } catch {
    // Not persisted; fine for this session.
  }
  return id;
}

function defaultName(): string {
  return `Surfer ${Math.floor(100 + Math.random() * 900)}`;
}

export class Profile {
  readonly id = randomId();
  readonly boardId = persistentId(browserStorage(), BOARD_ID_KEY);
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
