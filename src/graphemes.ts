let segmenter: Intl.Segmenter | null | undefined;

/** Split text into user-perceived characters (grapheme clusters). */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  }
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const s of segmenter.segment(text)) out.push(s.segment);
  return out;
}

const WHITESPACE = /^\s+$/u;

export function isWhitespace(g: string | undefined): boolean {
  return g !== undefined && WHITESPACE.test(g);
}
