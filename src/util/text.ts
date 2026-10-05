/**
 * Cleaning and checks for text that other players will see: player names,
 * AI course names, the prompts saved with shared courses, leaderboard names.
 * It's always rendered with textContent, so this is about decency and
 * honesty (no hidden, disguised or reordered text, no links, no slurs), not
 * HTML safety.
 */

/** Most accents one character may carry (stops "zalgo" text spilling over the UI). */
const MAX_MARKS = 2;
const STACKED_MARKS = new RegExp(`(\\p{M}{${MAX_MARKS}})\\p{M}+`, 'gu');

/**
 * Fold look-alike forms (full-width letters...) to plain ones; strip control,
 * format and invisible characters (zero-width, direction overrides, tag
 * characters), private-use and unassigned code points; limit stacked accents;
 * collapse whitespace; and cap the length at `maxChars` characters (code
 * points, so emoji aren't cut in half).
 */
export function cleanText(raw: string, maxChars: number): string {
  const text = raw
    .normalize('NFKC')
    .replace(/[\t\n\v\f\r]+/g, ' ') // whitespace controls become spaces
    .replace(/\p{C}/gu, '') // every other control, format, private-use or unassigned character goes
    .replace(STACKED_MARKS, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, maxChars).join('').trim();
}

// --- blocked words -------------------------------------------------------------

/** Blocked anywhere inside a word: long or distinctive enough not to hide in ordinary words. */
const BLOCKED_INSIDE = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'bitch', 'bastard', 'rapist', 'retard',
  'wank', 'twat', 'asshole', 'pussy', 'penis', 'vagina', 'porn', 'hentai', 'dildo', 'jizz', 'molest', 'pedophil',
  'hitler', 'nazi', 'kike',
];

/** Blocked only as whole words: they hide inside ordinary ones (grape, cocktail, spicy, cucumber). */
const BLOCKED_WORDS = [
  'rape', 'raped', 'rapes', 'raping', 'cum', 'cock', 'cocks', 'dick', 'dicks', 'spic', 'chink', 'fag', 'fags',
  'tit', 'tits', 'boob', 'boobs', 'sex', 'sexy', 'anal', 'ass', 'piss', 'coon', 'gook', 'kkk', 'heil', 'dyke',
  'tranny', 'pedo', 'kys', 'xxx', 'milf', 'nude', 'nudes',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

/**
 * A word as a pattern that lets every letter repeat ("fuuuck") but never
 * drop a doubled one, so "as" and "Bob" don't become "ass" and "boob".
 */
const stretchy = (word: string): string => word.replace(/(.)\1*/g, (run) => `${run}+`);

const INSIDE = new RegExp(BLOCKED_INSIDE.map(stretchy).join('|'));
const WHOLE = new RegExp(`^(?:${BLOCKED_WORDS.map(stretchy).join('|')})$`);

/**
 * The words in `text` as a filter should read them: lower case, accents
 * off, look-alikes folded, leetspeak decoded ("sh1t"), plus letters spelled
 * out one at a time ("f u c k", "f.u.c.k") joined into one word.
 */
function wordsOf(text: string): string[] {
  const plain = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[013457@$!|]/g, (c) => LEET[c]!);
  const tokens = plain.split(/[^a-z]+/).filter(Boolean);
  const words = [...tokens];
  let spelled = '';
  for (const t of [...tokens, '']) {
    if (t.length === 1) spelled += t;
    else {
      if (spelled.length > 1) words.push(spelled);
      spelled = '';
    }
  }
  return words;
}

/** Does `text` contain a blocked word, even disguised? */
export function containsBlocked(text: string): boolean {
  return wordsOf(text).some((word) => WHOLE.test(word) || INSIDE.test(word));
}

// --- links ----------------------------------------------------------------------

const TLDS = 'com|net|org|io|gg|co|xyz|ru|me|tv|ly|app|dev|link|site|shop|info|biz|online|live|store|club|top|fun|uk|us|de|cc|tk|ml|ga|cf|gq';
const LINK = new RegExp(
  [
    'https?:', 'ftp:', '://', 'www\\.',
    `\\b[a-z0-9-]+\\.(?:${TLDS})\\b`, // evil.com, robux-gift.xyz, discord.gg/...
    '\\b[a-z0-9-]+\\s+\\.\\s*(?:com|net|org|gg|xyz)\\b', // "evil . com"
    '\\S@\\S+\\.\\S', // emails
    '(?:^|\\s)@[a-z0-9_]{3,}', // @handles
  ].join('|'),
  'i',
);

/** Does `text` contain a link, domain, email address or @handle? */
export function containsLink(text: string): boolean {
  return LINK.test(text);
}

/** A name other players will see: cleaned, or `fallback` if nothing acceptable is left. */
export function cleanName(raw: unknown, maxChars: number, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const name = cleanText(raw, maxChars);
  return name.length > 0 && !containsBlocked(name) && !containsLink(name) ? name : fallback;
}
