import { describe, expect, it } from 'vitest';
import { words } from '#src/cut.ts';
import type { Elide } from '#src/elide.ts';
import { graphemes } from '#src/graphemes.ts';
import { type ElideOptions, isVisible } from '#src/options.ts';
import { box, expectConsistent, expectFits, make, sweep, visible } from './helpers.ts';

/** Left-to-right scripts and the many kinds of emoji. (Right-to-left text isn't supported yet.) */
const SAMPLES: Record<string, string> = {
  emoji: 'Family 👨‍👩‍👧‍👦 trip ✈️ to 🇯🇵 and 🇹🇷, thumbs 👍🏽👍🏿, keycaps 1️⃣ #️⃣, hearts ❤️‍🔥 and 🧑🏻‍💻 coding all night',
  combining: 'Ångström café naïve é̂ Z̵̡͓a̶̤l̷̚g̸̦o résumé fiancée Øresund',
  devanagari: 'नमस्ते दुनिया क्षत्रिय श्री हिन्दी भाषा में लिखा गया एक लंबा वाक्य है',
  thai: 'ภาษาไทยเขียนโดยไม่มีช่องว่างระหว่างคำ ซึ่งทำให้การตัดคำยากมาก',
  hangul: '한국어 문장은 띄어쓰기를 합니다 그리고 이것은 꽤 긴 문장입니다 각 자모',
  cjk: '日本語の文章はスペースを使わずに書かれるので単語の境界が分かりにくい中文也一样',
  astral: 'Bold 𝐀𝐁𝐂 script 𝒜𝒷𝒸 fraktur 𝔄𝔅ℭ, mahjong 🀄 and hieroglyphs 𓀀𓀁 in a row',
};

/** A run of three graphemes from the middle of `text`, to keep and highlight. */
const middleOf = (text: string) => {
  const g = graphemes(text);
  const at = Math.floor(g.length / 2);
  return g.slice(at, at + 3).join('');
};

const COMBOS: [string, (text: string) => ElideOptions][] = [
  ['middle', () => ({ position: 'middle' })],
  ['start, two lines', () => ({ position: 'start', lines: 2 })],
  ["two ellipses, '...'", () => ({ position: [0.3, 0.7], ellipsis: '...' })],
  ['end, glyph mode', () => ({ position: 'end', glyphs: true })],
  ['bullets, justify ellipsis', () => ({ position: 'middle', ellipsis: { shape: 'bullet' }, justify: 'ellipsis' })],
  ['a highlighted keep', (text) => ({ position: 'middle', keep: { match: middleOf(text), class: 'hit' } })],
  ['words', () => ({ position: 'middle', snap: words() })],
  ['no justify, no trim', () => ({ position: 'end', justify: false, trim: false })],
];

/** Every text node in the rendered line ends on a grapheme boundary: no cluster is split across elements. */
function expectWholeGraphemes(t: Elide) {
  const shown = visible(t);
  const bounds = new Set([0]);
  let at = 0;
  for (const g of graphemes(shown)) bounds.add((at += g.length));
  const line = t.element.querySelector('[data-fp-text]')!;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let end = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[data-fp-ellipsis], [data-fp-ghosts], [data-fp-found]')) continue;
    end += (node as Text).data.length;
    expect(bounds.has(end), `split at ${end} in ${JSON.stringify(shown)}`).toBe(true);
  }
}

/** Every grapheme showing has a box. */
function expectBoxes(t: Elide) {
  const state = t.state;
  for (let i = 0; i < state.length; i++) if (isVisible(state, i)) expect(t.graphemeRect(i), `grapheme ${i}`).not.toBeNull();
}

describe.each(Object.entries(SAMPLES))('%s', (_, text) => {
  it.each(COMBOS)('%s', (__, options) => {
    const t = make(box(text, 'font:16px/22px sans-serif'), options(text));
    const keep = options(text).keep;
    for (const _w of sweep(t, 40, 560, 31)) {
      expectFits(t);
      expectConsistent(t);
      expectWholeGraphemes(t);
      expectBoxes(t);
      if (keep !== undefined && keep !== null && typeof keep === 'object' && 'match' in keep && t.truncated && t.state.kept.length > 0) {
        expect(visible(t)).toContain(keep.match);
        expect(t.element.querySelector('[data-fp-text] .hit')).not.toBeNull();
      }
    }
  });

  it('copies the full text across an ellipsis', () => {
    const t = make(box(text, 'font:16px/22px sans-serif;width:160px'), { position: [0.3, 0.7] });
    expect(t.truncated).toBe(true);
    const range = document.createRange();
    range.selectNodeContents(t.element.querySelector('[data-fp-text]')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const data = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } });
    document.dispatchEvent(event);
    getSelection()!.removeAllRanges();
    expect(data.get('text/plain')).toBe(text);
  });
});
