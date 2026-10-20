import { describe, expect, it } from 'vitest';
import { words } from '#src/cut.ts';
import type { Position } from '#src/cut.ts';
import type { Elide } from '#src/elide.ts';
import { FONTS, box, expectConsistent, expectFits, expectFlush, make, sweep, visible } from './helpers.ts';

/** What shows, with '…' for each ellipsis, so text either side of one doesn't run together. */
function cut(t: Elide): string {
  let out = '';
  let at = 0;
  for (const { start, end } of t.state.hidden) {
    out += t.graphemes.slice(at, start).join('') + '…';
    at = end;
  }
  return out + t.graphemes.slice(at).join('');
}

const INVOICE = 'Invoice 2026-0412 for $12,345.67, due 14 Oct 2026, paid by transfer from account 4471';
const NUMBERS = /\$?\d[\d,.-]*\d/g;
const ALL = new Set(INVOICE.match(NUMBERS));

const RIVER =
  'The river was higher than anyone remembered, brown and fast, carrying whole branches past the old mill and the lantern by the gate. We waited on the bridge until the light went.';

describe.each(FONTS)('whole, in %s', (font) => {
  it.each<[string, Position | Position[]]>([
    ['the end', 'end'],
    ['the middle', 'middle'],
    ['two places', [0.3, 0.7]],
  ])('never shows part of one, cut at %s', (_, position) => {
    // A whole dropped at the end leaves more room than `maxGap` spreads: unlimited, every cut ends flush.
    const t = make(box(INVOICE, `font:${font}`), { position, whole: NUMBERS, maxGap: null });
    let cuts = 0;
    for (const _ of sweep(t, 60, 600, 3)) {
      expectFits(t);
      expectConsistent(t);
      if (!t.truncated) continue;
      cuts++;
      expectFlush(t);
      for (const [n] of cut(t).matchAll(NUMBERS)) expect(ALL.has(n)).toBe(true);
    }
    expect(cuts).toBeGreaterThan(50);
  });

  it('keeps to words and wholes at once', () => {
    const t = make(box(INVOICE, `font:${font}`), { position: 'middle', snap: words(), whole: NUMBERS });
    for (const _ of sweep(t, 80, 600, 4)) {
      expectFits(t);
      expectConsistent(t);
      for (const [n] of cut(t).matchAll(NUMBERS)) expect(ALL.has(n)).toBe(true);
    }
  });
});

describe.each(FONTS)('context, in %s', (font) => {
  it('shows words around the match first, then the rest', () => {
    const keep = { match: 'lantern', class: 'hit', context: Infinity };
    const t = make(box(RIVER, `font:${font}`), { keep });
    let snippets = 0;
    // From where the match fits with an ellipsis either side, in any font `serif` maps to.
    for (const _ of sweep(t, 120, 900, 6)) {
      expectFits(t);
      expectConsistent(t);
      const shown = visible(t);
      expect(shown).toContain('lantern');
      if (!t.truncated) continue;
      expectFlush(t);
      // Until the context reaches it, the start of the text stays hidden.
      if (!shown.startsWith('The')) snippets++;
      else expect(t.state.hidden).toHaveLength(1);
    }
    expect(snippets).toBeGreaterThan(20);
  });

  // (With several matches, one coming back as the box widens takes its
  // share of the context from the others: matches go before context.)
  it('never shows less as it widens', () => {
    const t = make(box(RIVER, `font:${font}`), { keep: { match: 'lantern', context: 3 }, lines: 2 });
    let before = 0;
    for (const _ of sweep(t, 120, 700, 5)) {
      expectFits(t);
      expectConsistent(t);
      const now = visible(t).length;
      expect(now).toBeGreaterThanOrEqual(before - 1);
      before = now;
    }
  });
});
