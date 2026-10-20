let segmenter: Intl.Segmenter | null | undefined;

/**
 * Below U+0300 (where combining marks start) every code unit is a grapheme
 * of its own, but for CR LF: no segmenter needed.
 */
const SIMPLE = /^[\0-˿]*$/;

/** Split text into user-perceived characters (grapheme clusters). */
export function graphemes(text: string): string[] {
  if (SIMPLE.test(text) && !text.includes('\r\n')) return text.split('');
  if (segmenter === undefined)
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const s of segmenter.segment(text)) out.push(s.segment);
  return out;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u;
const LETTER = /\p{L}/u;

/** Whether `g` is an ideograph or kana: Chinese and Japanese text breaks around each. */
export function isIdeograph(g: string): boolean {
  return g.charCodeAt(0) >= 0x2e80 && CJK.test(g);
}

/**
 * Whether text is Chinese or Japanese, for `ellipsis: 'auto'`: more of its
 * letters are ideographs or kana than not, or with no letters at all,
 * `lang` (the element's language) says so.
 */
export function isCJK(text: readonly string[], lang = ''): boolean {
  let cjk = 0;
  let other = 0;
  for (const g of text) {
    if (isIdeograph(g)) cjk++;
    else if (LETTER.test(g)) other++;
  }
  return cjk + other > 0 ? cjk > other : /^(zh|ja)\b/i.test(lang);
}

const WHITESPACE = /^\s+$/u;

export function isWhitespace(g: string | undefined): boolean {
  if (g === undefined) return false;
  if (g.length === 1) {
    const c = g.charCodeAt(0);
    if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  }
  return WHITESPACE.test(g);
}
