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

const WHITESPACE = /^\s+$/u;

export function isWhitespace(g: string | undefined): boolean {
  if (g === undefined) return false;
  if (g.length === 1) {
    const c = g.charCodeAt(0);
    if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  }
  return WHITESPACE.test(g);
}
