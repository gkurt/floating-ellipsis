/**
 * Glyph mode (`floating-ellipsis/glyphs`): every grapheme in its own element,
 * to style or animate one at a time. `elide(el, { glyphs })` turns it on.
 */
import type { Range } from './cut.ts';
import type { Elide } from './elide.ts';
import { chainId, filled } from './highlight.ts';
import { inside } from './inside.ts';
import { type Chain, type Placed, nest, unitCopy } from './markup.ts';
import { inkOf } from './metrics.ts';
import type { GlyphMode } from './options.ts';
import type { ShortPart } from './shorten.ts';

/** Glyph mode, for the `glyphs` option: `elide(el, { glyphs })`. */
export const glyphs: GlyphMode = {
  create: (graphemes, units) =>
    graphemes.map((s, i) => {
      const el = document.createElement('span');
      el.setAttribute('data-fp-glyph', String(i));
      const unit = units[i];
      if (unit) el.append(unitCopy(unit, i));
      else el.textContent = s;
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

/**
 * Put the glyph elements of `[from, to)` in `el`, inside copies of their
 * elements, and for a part of `short` the element `shortEl` makes for it.
 */
function fillGlyphs(
  el: HTMLElement,
  glyphs: readonly HTMLElement[],
  chains: readonly (Chain | null)[],
  [from, to]: Range,
  short: readonly ShortPart[],
  shortEl: (part: ShortPart) => Element,
): void {
  // Each grapheme's node: its glyph, or the first of a part's its short form (null for the rest).
  const nodes: (Element | null)[] = glyphs.slice(from, to);
  for (const part of short) {
    if (part.end <= from || part.start >= to) continue;
    nodes.fill(null, Math.max(0, part.start - from), part.end - from);
    nodes[Math.max(0, part.start - from)] = shortEl(part);
  }
  const want = nodes.filter((node) => node !== null);
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
    const node = nodes[i - from];
    if (!node) continue;
    const chain = chains[i] ?? null;
    const last = placed.at(-1);
    if (last && last.chain === chain) {
      last.nodes.push(node);
      last.end = i + 1;
    } else {
      placed.push({ chain, nodes: [node], start: i, end: i + 1 });
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
