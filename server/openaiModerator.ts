/**
 * OpenAI's moderation check (free of charge: it doesn't touch the prepaid
 * credit). Screens players' course descriptions before the course designer
 * sees them, and the course names it comes back with, because both are saved
 * with shared courses and shown to other players.
 */

export const MODERATION_MODEL = 'omni-moderation-latest';

/** The slice of the OpenAI client we use, so tests can pass a fake. */
export interface ModerationClient {
  moderations: {
    create(
      body: { model: string; input: string[] },
      options: { signal: AbortSignal; maxRetries: number },
    ): PromiseLike<{ results: readonly { categories: object }[] }>;
  };
}

/** One flag per text: true means don't use it. Must stop when `signal` aborts. */
export type Moderator = (texts: string[], signal: AbortSignal) => Promise<boolean[]>;

/**
 * Plain "violence" is allowed: cartoon action ("shoot zombies, blow it all
 * up") is normal for a game, and a course is only ramps anyway. Everything
 * else the check flags refuses the text, graphic violence included.
 */
const ALLOWED = new Set(['violence']);

export function moderationFlagged(categories: object): boolean {
  return Object.entries(categories).some(([category, flagged]) => flagged === true && !ALLOWED.has(category));
}

export function openAiModerator(client: ModerationClient): Moderator {
  return async (texts, signal) => {
    // No retries: a failure here refuses the request (fails closed).
    const response = await client.moderations.create({ model: MODERATION_MODEL, input: texts }, { signal, maxRetries: 0 });
    if (response.results.length !== texts.length) throw new Error('moderation: wrong number of results');
    return response.results.map((r) => moderationFlagged(r.categories));
  };
}
