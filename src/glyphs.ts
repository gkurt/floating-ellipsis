/**
 * Glyph mode (`floating-ellipsis/glyphs`): every grapheme in its own element,
 * to style or animate one at a time. `elide(el, { glyphs })` turns it on.
 */
import type { Range } from './cut.ts';
import type { Elide } from './elide.ts';
import { chainId, filled } from './highlight.ts';
import { inside } from './inside.ts';
import { type Chain, type Placed, nest } from './markup.ts';
import { inkOf } from './metrics.ts';
import type { GlyphMode } from './options.ts';

/** Glyph mode, for the `glyphs` option: `elide(el, { glyphs })`. */
export const glyphs: GlyphMode = {
  create: (graphemes) =>
    graphemes.map((s, i) => {
      const el = document.createElement('span');
      el.setAttribute('data-fp-glyph', String(i));
      el.textContent = s;
      return el;
    }),
  fill: fillGlyphs,
  mark: (glyphs, attribute, ranges) =>
    glyphs.forEach((el, i) =>
      el.toggleAttribute(
        attribute,
        ranges.some(([s, e]) => i >= s && i < e),
      ),
    ),
};

/** Put the glyph elements of `[from, to)` in `el`, inside copies of their elements. */
function fillGlyphs(el: HTMLElement, glyphs: readonly HTMLElement[], chains: readonly (Chain | null)[], [from, to]: Range): void {
  const want = glyphs.slice(from, to);
  if (chains.length === 0) {
    const have = el.childNodes;
    if (have.length !== want.length || want.some((g, i) => have[i] !== g)) el.replaceChildren(...want);
    return;
  }
  const key = `${from}:${chains.slice(from, to).map(chainId).join(',')}`;
  if (filled.get(el) === key && want.every((g) => el.contains(g))) return;
  filled.set(el, key);
  const placed: Placed[] = [];
  for (let i = from; i < to; i++) {
    const chain = chains[i] ?? null;
    const last = placed.at(-1);
    if (last && last.chain === chain) {
      last.nodes.push(glyphs[i]!);
      last.end = i + 1;
    } else {
      placed.push({ chain, nodes: [glyphs[i]!], start: i, end: i + 1 });
    }
  }
  el.replaceChildren(...nest(placed, false));
}

/** The element of grapheme `index` in glyph mode, or null (out of range, or not in glyph mode). */
export function glyph(instance: Elide, index: number): HTMLSpanElement | null {
  return inside(instance).glyphs[index] ?? null;
}

/** Ink box of grapheme `index` in glyph mode, or null when it isn't showing. */
export function glyphInk(instance: Elide, index: number): DOMRect | null {
  const s = inside(instance);
  s.sync();
  const el = s.glyphs[index];
  if (!el?.isConnected || !s.run) return null;
  return inkOf(s.run, instance.graphemes[index], el.getBoundingClientRect());
}
