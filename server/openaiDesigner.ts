/**
 * The real CourseDesigner: one OpenAI Responses API call with Structured
 * Outputs (strict JSON schema), so the reply is always shaped like a course.
 */
import type OpenAI from 'openai';
import { COURSE_JSON_SCHEMA, COURSE_SCHEMA_NAME, COURSE_SYSTEM_PROMPT, courseUserMessage } from '../src/course/aiSchema.js';
import { BUDGET, type CourseDesigner } from './generateCourse.js';

/** The slice of the OpenAI client we use (lets tests pass a fake). */
export interface ResponsesClient {
  responses: {
    create(
      body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
      options?: { signal?: AbortSignal; maxRetries?: number },
    ): PromiseLike<{ output_text: string; usage?: { input_tokens: number; output_tokens: number } | null }>;
  };
}

export function openAiDesigner(client: ResponsesClient, model: string): CourseDesigner {
  return async (prompt, signal) => {
    const started = Date.now();
    const response = await client.responses.create(
      {
        model,
        instructions: COURSE_SYSTEM_PROMPT,
        input: courseUserMessage(prompt),
        text: { format: { type: 'json_schema', name: COURSE_SCHEMA_NAME, schema: COURSE_JSON_SCHEMA, strict: true } },
        // Players' prompts don't need to live on OpenAI's side.
        store: false,
        // Caps what one call can cost (a course is ~400-800 tokens).
        max_output_tokens: BUDGET.maxOutputTokens,
      },
      // One attempt: the whole request has a 15 s budget, and the client falls back to a random course.
      { signal, maxRetries: 0 },
    );
    // Token counts and timing only (never the prompt): enough to check real costs against BUDGET.
    if (response.usage) {
      console.info(
        `[generate-course] ${model} ${Date.now() - started}ms in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );
    }
    const text = response.output_text;
    if (!text) throw new Error('The model returned no course (refused or empty).');
    return JSON.parse(text) as unknown;
  };
}
