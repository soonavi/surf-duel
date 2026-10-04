/**
 * Share codes for AI-generated courses: six characters from an alphabet with
 * no look-alikes (no I, O, 0, 1), so they survive being read aloud. Room codes
 * are four letters, so the two never get mixed up. The database enforces the
 * same rule (supabase/migrations/*_courses.sql).
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SHARE_CODE_LENGTH = 6;
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export function generateShareCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) code += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return code;
}

/** Accepts a bare code (any case, spaces or dashes) or a share link; null unless it's a valid code. */
export function normalizeShareCode(input: string): string | null {
  const fromLink = /[?&]course=([^&#\s]+)/i.exec(input);
  const code = (fromLink ? fromLink[1]! : input).toUpperCase().replace(/[\s\-_.]/g, '');
  return CODE_RE.test(code) ? code : null;
}
