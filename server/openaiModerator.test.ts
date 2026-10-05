import { describe, expect, it } from 'vitest';
import { MODERATION_MODEL, moderationFlagged, openAiModerator, type ModerationClient } from './openaiModerator.js';

const CLEAN = { harassment: false, hate: false, sexual: false, 'self-harm': false, violence: false, 'violence/graphic': false, illicit: false };

function fakeClient(results: { categories: Record<string, boolean> }[]) {
  const calls: { body: { model: string; input: string[] }; options: { signal: AbortSignal; maxRetries: number } }[] = [];
  const client: ModerationClient = {
    moderations: {
      create: async (body, options) => {
        calls.push({ body, options });
        return { results };
      },
    },
  };
  return { client, calls };
}

describe('moderationFlagged', () => {
  it('refuses hate, harassment, sexual, self-harm, graphic violence and illicit content', () => {
    for (const category of ['harassment', 'hate', 'sexual', 'self-harm', 'violence/graphic', 'illicit']) {
      expect(moderationFlagged({ ...CLEAN, [category]: true }), category).toBe(true);
    }
  });

  it('allows plain cartoon action ("shoot zombies"): a course is only ramps anyway', () => {
    expect(moderationFlagged({ ...CLEAN, violence: true })).toBe(false);
    expect(moderationFlagged(CLEAN)).toBe(false);
  });
});

describe('openAiModerator', () => {
  it('asks the free moderation model about every text in one call, without retries', async () => {
    const { client, calls } = fakeClient([{ categories: CLEAN }, { categories: { ...CLEAN, hate: true } }]);
    const signal = new AbortController().signal;
    expect(await openAiModerator(client)(['ice', 'bad'], signal)).toEqual([false, true]);
    expect(calls[0]!.body).toEqual({ model: MODERATION_MODEL, input: ['ice', 'bad'] });
    expect(calls[0]!.options).toEqual({ signal, maxRetries: 0 });
  });

  it('throws when the answer does not match the question (so the caller fails closed)', async () => {
    const { client } = fakeClient([]);
    await expect(openAiModerator(client)(['ice'], new AbortController().signal)).rejects.toThrow();
  });
});
