/**
 * Local personal bests and run history, per course. Backed by localStorage
 * when it works, with an in-memory copy so a blocked or full storage never
 * breaks the game — records then just last for the session.
 */
import { z } from 'zod';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RunRecord {
  timeMs: number;
  splits: (number | null)[];
  topSpeed: number;
  /** Encoded ghost (see ghost.ts). */
  ghost: string;
  /** Epoch ms. */
  at: number;
  /** Set with assist mode on (shown as a badge on the leaderboard). */
  assist?: boolean;
}

export interface SaveOutcome {
  isBest: boolean;
  /** 1 = fastest of your stored runs on this course. */
  rank: number;
  runs: number;
  previousBest: RunRecord | null;
}

const MAX_HISTORY = 200;

const StoredRun = z.object({
  timeMs: z.number().int().positive(),
  splits: z.array(z.number().int().nonnegative().nullable()).max(64),
  topSpeed: z.number().nonnegative(),
  ghost: z.string().max(400_000),
  at: z.number(),
  assist: z.boolean().optional(),
});

const StoredHistory = z.array(z.number().int().positive()).max(MAX_HISTORY * 2);

const BoardRunId = z.string().min(1).max(64);

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class RecordStore {
  private readonly memory = new Map<string, string>();

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  best(courseKey: string): RunRecord | null {
    return this.readJson(`surfduel.best.v1.${courseKey}`, StoredRun);
  }

  save(courseKey: string, run: RunRecord): SaveOutcome {
    const previousBest = this.best(courseKey);
    const isBest = !previousBest || run.timeMs < previousBest.timeMs;
    if (isBest) this.write(`surfduel.best.v1.${courseKey}`, JSON.stringify(run));

    const historyKey = `surfduel.runs.v1.${courseKey}`;
    const history = [...(this.readJson(historyKey, StoredHistory) ?? []), run.timeMs].slice(-MAX_HISTORY);
    this.write(historyKey, JSON.stringify(history));

    const rank = 1 + history.filter((t) => t < run.timeMs).length;
    return { isBest, rank, runs: history.length, previousBest };
  }

  /** Your row on this course's online leaderboard, once you've posted a run there. */
  boardRunId(courseKey: string): string | null {
    return this.readJson(`surfduel.board.v1.${courseKey}`, BoardRunId);
  }

  setBoardRunId(courseKey: string, id: string): void {
    this.write(`surfduel.board.v1.${courseKey}`, JSON.stringify(id));
  }

  private readJson<T>(key: string, schema: z.ZodType<T>): T | null {
    let raw: string | null;
    try {
      raw = this.storage?.getItem(key) ?? this.memory.get(key) ?? null;
    } catch {
      raw = this.memory.get(key) ?? null;
    }
    if (raw === null) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Storage full or blocked; the in-memory copy keeps this session working.
    }
  }
}
