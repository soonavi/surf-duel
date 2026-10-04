/**
 * Cleaning for text that other players will see: player names, AI course
 * names, the prompts saved with shared courses. Always rendered with
 * textContent, so this is about tidiness and decency, not HTML safety.
 */

// A short list is enough here; the leaderboard API filters again server-side.
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'bitch', 'whore', 'slut', 'rape'];

/**
 * Strip control and zero-width characters, collapse whitespace, mask blocked
 * words, and cap the length at `maxChars` characters (code points, so emoji
 * aren't cut in half).
 */
export function cleanText(raw: string, maxChars: number): string {
  let text = raw
    .replace(/[​-‏⁠﻿]/g, '') // zero-width and direction marks
    .replace(/[\t\n\v\f\r]+/g, ' ') // whitespace controls become spaces
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '') // other controls are dropped
    .replace(/\s+/g, ' ')
    .trim();
  for (const word of BLOCKED) {
    text = text.replace(new RegExp(word, 'gi'), (m) => '*'.repeat(m.length));
  }
  return Array.from(text).slice(0, maxChars).join('').trim();
}
