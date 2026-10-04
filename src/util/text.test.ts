import { describe, expect, it } from 'vitest';
import { cleanText } from './text';

describe('cleanText', () => {
  it('collapses whitespace and strips control and zero-width characters', () => {
    expect(cleanText('  Lava​\tRun \n\u0007 Deluxe ', 40)).toBe('Lava Run Deluxe');
  });

  it('masks blocked words, case-insensitively', () => {
    expect(cleanText('Shit Canyon', 40)).toBe('**** Canyon');
  });

  it('caps the length in characters, not UTF-16 units', () => {
    expect(cleanText('🌊🌊🌊🌊', 3)).toBe('🌊🌊🌊');
  });

  it('trims what is left after cutting', () => {
    expect(cleanText('abc def', 4)).toBe('abc');
  });
});
