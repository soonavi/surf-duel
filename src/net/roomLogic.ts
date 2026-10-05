/**
 * Pure room rules: codes, names, colours, host election, capacity, send-rate
 * budgeting and live ranking. No networking here, so it's all unit-tested.
 */
import { cleanName } from '../util/text';

export const MAX_PLAYERS = 8;
export const NAME_MAX = 16;

/** Distinct, high-contrast player colours (enough for a full room). */
export const PLAYER_COLORS: readonly string[] = [
  '#3ee6ff', // cyan
  '#ff4fd8', // pink
  '#ffd27a', // gold
  '#7cf8c4', // mint
  '#ff8a3d', // orange
  '#a78bfa', // violet
  '#c6f432', // lime
  '#f3f0ff', // white
];

/** Letters only, minus I and O, which read as 1 and 0. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateRoomCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return code;
}

/** Uppercase and strip separators; null unless it's exactly four valid letters. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s\-_.]/g, '');
  return /^[A-HJ-NP-Z]{4}$/.test(code) ? code : null;
}

/** A player name others will see: cleaned, or `fallback` if it's empty or not suitable (links, blocked words). */
export function sanitizeName(raw: unknown, fallback = 'Surfer'): string {
  return cleanName(raw, NAME_MAX, fallback);
}

export interface Member {
  id: string;
  joinedAt: number;
}

/** Stable room order: earliest join first, ties broken by id. Everyone computes the same order. */
export function orderMembers<T extends Member>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The host is the longest-standing member. */
export function hostOf(members: readonly Member[]): string | null {
  return orderMembers(members)[0]?.id ?? null;
}

/** True if `id` isn't among the first MAX_PLAYERS members (it should leave). */
export function overCapacity(members: readonly Member[], id: string): boolean {
  const index = orderMembers(members).findIndex((m) => m.id === id);
  return index >= MAX_PLAYERS;
}

export function pickColor(taken: readonly string[]): string {
  return PLAYER_COLORS.find((c) => !taken.includes(c)) ?? PLAYER_COLORS[0]!;
}

/**
 * Seconds between state messages so a room of `players` stays within
 * `budget` Realtime messages per second. Every send is delivered to everyone,
 * so the room costs about players² messages per batch. Samples are still taken
 * at 20 Hz; bigger rooms just send them in larger batches.
 */
export function batchInterval(players: number, budget: number): number {
  const n = Math.max(1, players);
  return Math.min(1, Math.max(1 / 20, (n * n) / Math.max(1, budget)));
}

export interface RankEntry {
  id: string;
  /** Finish time, or null while still racing. */
  finishedMs: number | null;
  /** 0..1 along the course. */
  progress: number;
  /** Left the room mid-race. */
  left: boolean;
}

/** Live standings: finishers by time, then racers by progress, then leavers. */
export function rankRacers<T extends RankEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.left !== b.left) return a.left ? 1 : -1;
    const af = a.finishedMs !== null;
    const bf = b.finishedMs !== null;
    if (af !== bf) return af ? -1 : 1;
    if (af && bf) return a.finishedMs! - b.finishedMs!;
    return b.progress - a.progress || (a.id < b.id ? -1 : 1);
  });
}
