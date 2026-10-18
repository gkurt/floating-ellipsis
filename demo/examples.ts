import { type Elide, type ElideOptions, type Keep, separators, words } from '#src/index.ts';
import type { TransitionOptions } from '#src/transitions.ts';

/** The examples the home page and the video share: their text, and the options that cut it. */

/** Glyphs merge into the dots, and the spacing between the dots glides: for one change at a time. */
export const calm: TransitionOptions = { effect: 'merge' };
/** For text that changes every frame: gliding spacing would trail behind it. */
export const fast: TransitionOptions = { effect: 'merge', glide: false };
/** For a cut that follows a pointer or a slider: glyphs merging behind it read as smears, so they fade in place. */
export const fading: TransitionOptions = { effect: 'fade', glide: false };

/** Markup for code: `f(…)` functions, `k:` keys, `«…»` values, `//` comments. */
export function code(src: string) {
  return src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/(\/\/.*)$/, '<span class="c">$1</span>')
    .replace(/«(.*?)»/g, '<span class="v">$1</span>')
    .replace(/\b([a-zA-Z]+)(?=\()/g, '<span class="f">$1</span>')
    .replace(/\b([a-zA-Z]+)(?=:)/g, '<span class="k">$1</span>');
}

export const fileIcon = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/></svg>`;

export const hero = 'The quiet art of leaving things out, gracefully and symmetrically, right where you asked.';

export const river =
  'The river was higher than anyone remembered, brown and fast, carrying whole branches past the old mill. We waited on the bridge until the light went, counting herons, arguing about whether the water would reach the second step by morning. It did not. By noon the next day it had fallen a full meter, leaving a line of silt on every stone like a tide mark, and the herons had gone somewhere quieter.';

/** Several lines, then several ellipses, then marks of other shapes: each step whole. */
export const lineSteps: { options: ElideOptions; src: string }[] = [
  { options: { lines: 3 }, src: 'lines: «3»' },
  { options: { lines: 3, position: 0.6 }, src: 'lines: «3», position: «0.6»' },
  { options: { lines: 3, position: [0.3, 0.8] }, src: 'lines: «3», position: «[0.3, 0.8]»' },
  {
    options: { lines: 3, position: [0.3, 0.8], ellipsis: { shape: 'bullet' } },
    src: "position: «[0.3, 0.8]», ellipsis: { shape: «'bullet'» }",
  },
  {
    options: { lines: 3, position: [0.3, 0.8], ellipsis: { shape: 'ring', count: 5 } },
    src: "position: «[0.3, 0.8]», ellipsis: { shape: «'ring'», count: «5» }",
  },
  {
    options: { lines: 3, position: [0.3, 0.8], ellipsis: { shape: 'square', size: '0.14em', spacing: 4 } },
    src: "position: «[0.3, 0.8]», ellipsis: { shape: «'square'» }",
  },
];

export const post =
  'We moved the kept parts into their own pass this week, so a search hit in the middle of a cell now gets an ellipsis on each side.';

/**
 * Expand or collapse `t`, the space it takes following: opening, the text is
 * all there and the box grows over it; closing, it's cut at once, its suffix
 * in place, and the room it leaves closes up below it.
 */
export function toggleSmoothly(t: Elide) {
  const el = t.element;
  // Collapsing, the button stays in reach: a click waits for the box to settle.
  if (el.getAnimations().length > 0) return;
  const from = el.getBoundingClientRect().height;
  const opening = !t.expanded;
  t[opening ? 'expand' : 'collapse']();
  // (Reading the state runs the pass the change put off.) The label changed
  // with it: fit that now too, or a pass during the animation would hold the
  // height the min-height below gives.
  void t.state;
  t.refresh();
  void t.state;
  const to = el.getBoundingClientRect().height;
  const motion = { duration: 480, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
  if (!opening) {
    // A cut element's height is held (`!important`, over any animation), but a min-height overrules it.
    const held = parseFloat(getComputedStyle(el).height);
    el.animate({ minHeight: [`${held + from - to}px`, `${held}px`] }, motion);
    return;
  }
  el.style.overflow = 'clip';
  const growing = el.animate({ height: [`${from}px`, `${to}px`] }, motion);
  void growing.finished.then(() => (el.style.overflow = ''));
}

export const issues = [
  'Tooltip grows from the wrong line when <code>lines: 2</code> and the text starts with a space <span class="badge">#512</span>',
  'Support <code>text-transform: capitalize</code> when measuring glyphs in balanced gaps <span class="badge new">new</span>',
];

const sentence = 'The quick brown fox jumps over the lazy dog by the old river mill';

export const snapRows: { label: string; text: string; mono?: boolean; options: ElideOptions }[] = [
  { label: 'any glyph', text: sentence, options: { position: 0.5 } },
  { label: 'words()', text: sentence, options: { position: 0.5, snap: words() } },
  {
    label: "separators('/')",
    text: '/Users/ada/Projects/analytical-engine/src/notes/bernoulli-numbers.md',
    mono: true,
    options: { position: 0.5, snap: separators('/', { fragment: false }) },
  },
];

export const tooltipPaths = [
  'README.md',
  '/Users/ada/Projects/analytical-engine/notes/bernoulli.md',
  'package.json',
  'C:\\Users\\grace\\AppData\\Local\\Packages\\Microsoft.WindowsTerminal\\LocalState\\settings\\backups\\2026-10-14\\campbell-powershell.json',
];
export const tooltipOptions: ElideOptions = { position: [0.3, 0.7], snap: separators('/\\') };

export const keepRows: { text: string; mono?: boolean; options: ElideOptions }[] = [
  {
    text: 'Quarterly revenue forecast, final final (2), reviewed by legal and finance.pdf',
    options: { keep: { match: /\.[^.]+$/, class: 'hit blue' } },
  },
  {
    text: 'The quick brown fox jumps over the lazy dog while the farmer watches from the porch',
    options: { keep: { match: /fox|porch/g, class: 'hit' }, position: 'middle' },
  },
  {
    text: '2026-10-14 09:41:07 worker-3 upstream request failed with ERR_CONN_RESET after 3 retries',
    mono: true,
    options: { keep: [/^\S+ \S+/, { match: /ERR_\w+/, class: 'hit' }], position: 'middle' },
  },
];

export const lantern = [
  'Ellipsis loses its colour after update() changes the font, and the lantern icon beside it flickers in Safari',
  'Thanks to everyone who sent traces, and to whoever found that a paper lantern emoji made the whole row wrap',
  'The lantern fixture still assumes the old metrics, so regenerate it before the release and pin the font',
];
/** A cut right where the word is, so all of it is hidden. */
export const lanternPosition = (text: string) => (text.indexOf('lantern') + 3.5) / text.length;

export const siblings = [
  'src/components/forms/Button/index.tsx',
  'src/components/forms/Checkbox/index.tsx',
  'src/components/layout/Dialog/index.tsx',
  'src/components/layout/Sidebar/index.tsx',
];

/**
 * What sets `path` apart from the rest: each segment no other path has in
 * its place, highlighted, then the file name. Kept parts that can't all fit
 * give way last first.
 */
export function differing(path: string, paths: string[]): Keep[] {
  const others = paths.filter((p) => p !== path).map((p) => p.split('/'));
  const parts = path.split('/');
  const keep: Keep[] = [];
  let at = 0;
  parts.forEach((part, i) => {
    const [start, end] = [at, at + part.length];
    at = end + 1;
    if (i === parts.length - 1) keep.push({ start, end });
    else if (others.every((o) => o[i] !== part)) keep.unshift({ start, end, class: 'hit' });
  });
  return keep;
}

/** A folder and a PDF, drawn: each is one grapheme that's shown whole or not at all. */
const folderIcon =
  '<svg class="icon" aria-label="Folder" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z"/></svg>';
const pdfIcon =
  '<svg class="icon" aria-label="PDF" width="28" height="16" viewBox="0 0 28 16"><rect width="28" height="16" rx="3" fill="currentColor"/><text x="14" y="11.5" text-anchor="middle" font-size="9" font-weight="700" font-family="system-ui, sans-serif" style="fill: var(--surface)">PDF</text></svg>';
const mention = (name: string) => `<span class="mention" data-elide-unit>@${name}</span>`;

export const unitRows: { label: string; text: string; options: ElideOptions }[] = [
  {
    label: '&lt;svg&gt;',
    text: `${folderIcon} Projects / ada / ${pdfIcon} Difference engine notes, final draft (2).pdf`,
    options: { position: 'middle' },
  },
  {
    label: 'data-elide-unit',
    text: `Waiting on ${mention('ada.lovelace')} and ${mention('charles.babbage')} before Thursday's release`,
    options: { position: 0.7 },
  },
  {
    label: 'emoji',
    text: 'Weekend: 🏔️ hike with the 👨‍👩‍👧‍👦, then 🍜 by 🧑🏽‍🍳 in Kyoto and ☕ with 👩🏻‍💻 in Istanbul 👍🏽',
    options: { position: 'middle' },
  },
  {
    label: 'scripts',
    text: 'Grüße · नमस्ते दुनिया · こんにちは世界 · 안녕하세요 · Γειά σου · สวัสดีชาวโลก',
    options: { position: 'middle' },
  },
];

export const sharedColumns: [string, (path: string) => ElideOptions][] = [
  ["position: 'middle'", () => ({ position: 'middle' })],
  ['keep: differing(…)', (path) => ({ position: 'middle', keep: differing(path, siblings), snap: separators('/', { fragment: false }) })],
];

export const quote =
  'We may say most aptly that the Analytical Engine weaves algebraical patterns just as the Jacquard loom weaves flowers and leaves.';

/** How far either side of the pointer the lens keeps, in graphemes. */
export const lensReach = 9;

/** The lens' `keep` and `position` for a pointer `p` of the way across a text of `n` graphemes. */
export function lensAt(p: number, n: number) {
  const i = Math.round(p * (n - 1));
  const [start, end] = [Math.max(0, i - lensReach), Math.min(n, i + lensReach)];
  return {
    options: { keep: { start, end, class: 'lensed' }, position: p },
    src: `keep: { start: «${start}», end: «${end}» }, position: «${p.toFixed(2)}»`,
  };
}
