import { describe, expect, it } from 'vitest';
import { openAiDesigner, type ResponsesClient } from './openaiDesigner.js';
import { COURSE_JSON_SCHEMA, COURSE_SYSTEM_PROMPT } from '../src/course/aiSchema.js';
import { BUDGET } from './generateCourse.js';

function fakeClient(outputText: string) {
  const calls: { body: Record<string, unknown>; options: Record<string, unknown> | undefined }[] = [];
  const client: ResponsesClient = {
    responses: {
      create: async (body, options) => {
        calls.push({ body: body as unknown as Record<string, unknown>, options: options as Record<string, unknown> | undefined });
        return { output_text: outputText };
      },
    },
  };
  return { client, calls };
}

describe('openAiDesigner', () => {
  it('asks the configured model for a strict structured course and parses the reply', async () => {
    const { client, calls } = fakeClient('{"name":"X","theme":"ice","difficulty":"easy","segments":[]}');
    const signal = new AbortController().signal;
    const out = await openAiDesigner(client, 'some-model')('icy canyon', signal);

    expect(out).toEqual({ name: 'X', theme: 'ice', difficulty: 'easy', segments: [] });
    const { body, options } = calls[0]!;
    expect(body.model).toBe('some-model');
    expect(body.instructions).toBe(COURSE_SYSTEM_PROMPT);
    expect(body.input).toContain('icy canyon');
    expect(body.text).toEqual({ format: { type: 'json_schema', name: 'surf_course', schema: COURSE_JSON_SCHEMA, strict: true } });
    expect(body.store).toBe(false); // players' prompts aren't kept on OpenAI's side
    expect(body.max_output_tokens).toBe(BUDGET.maxOutputTokens); // bounds what one call can cost
    expect(options?.signal).toBe(signal);
  });

  it('throws on an empty reply (e.g. a refusal), so the caller can fall back', async () => {
    const { client } = fakeClient('');
    await expect(openAiDesigner(client, 'm')('x', new AbortController().signal)).rejects.toThrow();
  });
});
