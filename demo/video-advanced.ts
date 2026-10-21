import { autoSize } from '#src/autosize.ts';
import { glyphs } from '#src/glyphs.ts';
import { type Elide, type ElideOptions, type Keep, separators } from '#src/index.ts';
import { elideInput } from '#src/input.ts';
import {
  calm,
  fast,
  fewDots,
  fileRows,
  inputFields,
  inputNote,
  listRows,
  markRows,
  river,
  shortRows,
  unitRows,
  wholeRows,
} from './examples.ts';
import { Scene, at, box, el, film, moveTo, outro, pointer, press, rows, showCursor, tween, wait, widen } from './film.ts';

/** The second video: a crowded table, then the features past the first video's. Harder to take in, so each stays longer. */

async function intro() {
  const s = new Scene(null, '<h1>Past the <em>basics.</em></h1>');
  const line = el('p', 'line', 'Tables, short forms, lists, numbers, emoji and every script, inputs and more.');
  const b = box(1080, line);
  b.classList.add('quiet');
  s.section.append(b);
  s.elide(line, { position: 0.5, glyphs }, fast);
  await s.enter();
  await wait(250);
  await widen(b, 560, 1500);
  await wait(500);
  await s.leave();
}

/** Type `text` into `el`, a key at a time. */
async function type(el: HTMLElement, text: string) {
  for (const ch of text) {
    el.textContent += ch;
    await wait(70);
  }
}

const COLUMNS = ['File', 'Folder', 'Last commit', 'Hash', 'Size'];
/** How each column is truncated, as on the table page: what it always keeps, and the rest of its options. */
const columns: { keep: Keep[]; options: ElideOptions }[] = [
  { keep: [/\.[^.]+$/], options: { position: 0.5 } },
  { keep: [], options: { position: 0.5, snap: separators('/'), ...fewDots } },
  { keep: [], options: {} },
  { keep: [], options: { position: 0.5 } },
];

/** A table truncated four ways, narrowed, searched (matches kept, other rows faded), and hovered for a tooltip. */
async function table() {
  const s = new Scene(
    1,
    'Truncate each column its <em>own way.</em>',
    "keep: «/\\.[^.]+$/»      snap: separators(«'/'»)      position: «0.5»",
  );
  s.stage.classList.add('roomy');
  const search = el(
    'div',
    'searchbar',
    '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg><span class="query"></span>',
  );
  const query = search.querySelector<HTMLElement>('.query')!;
  const grid = el('div', 'table box');
  grid.append(el('div', 'tr head', COLUMNS.map((name) => `<span class="th">${name}</span>`).join('')));
  const all = fileRows(7);
  // Rows a search for "report" finds in their names and their folders, and two it doesn't.
  const picked = [0, 1, 2, 5, 6].map((i) => all[i]!);
  const cells: { t: Elide; text: string; keep: Keep[]; tr: HTMLElement }[] = [];
  for (const row of picked) {
    const tr = el('div', 'tr');
    grid.append(tr);
    for (const [i, text] of row.entries()) {
      const td = el('div', i === 4 ? 'td num' : 'td');
      const cell = el('div', i === 1 || i === 3 ? 'cell mono' : 'cell');
      cell.textContent = text;
      td.append(cell);
      tr.append(td);
      if (i === 4) continue;
      const { keep, options } = columns[i]!;
      cells.push({ t: s.elide(cell, { ...options, keep }, calm), text, keep, tr });
    }
  }
  s.stage.append(search, grid);
  const tips = s.tooltip({ delay: 300, grace: 0, duration: 600, breaks: '/' });
  for (const { t } of cells) tips.attach(t);
  await s.enter();
  await wait(500);
  await widen(grid, 780, 2400);
  await wait(1000);
  await widen(grid, 1000, 1100);
  await wait(500);

  await type(query, 'report');
  s.code("keep: [{ match: «/report/gi», class: «'hit'» }, ...keep]");
  const hits = new Set<HTMLElement>();
  for (const { t, text, keep, tr } of cells) {
    if (!/report/i.test(text)) continue;
    hits.add(tr);
    t.update({ keep: [{ match: /report/gi, class: 'hit' }, ...keep] });
  }
  grid.classList.add('searching');
  for (const tr of grid.querySelectorAll<HTMLElement>('.tr:not(.head)')) tr.classList.toggle('miss', !hits.has(tr));
  await wait(2000);

  s.code('tooltip().attach(instance)');
  const folder = cells.find(({ text }) => text.includes('/reports/'))!.t.element;
  pointer.x = 1100;
  pointer.y = 700;
  await showCursor(true);
  await moveTo(at(folder, 0.35, 0.55), 600);
  await wait(1900);
  await moveTo([pointer.x + 160, 720], 400);
  await showCursor(false);
  await s.leave();
}

/** Labeled rows, narrowed slowly enough to follow, held there, then widened again. */
async function sweep(s: Scene, list: HTMLElement, narrow: number, wide: number) {
  list.style.width = '1070px';
  s.stage.append(list);
  await s.enter();
  await wait(400);
  await widen(list, narrow, 2600);
  await wait(1300);
  await widen(list, wide, 1200);
  await wait(900);
  await s.leave();
}

async function shortening() {
  const s = new Scene(
    2,
    'Shorten before <em>truncating.</em>',
    "shorten: [{ match: «'Wednesday'», to: [«'Wed'», «'W'»] }, { match: «' 2026'», to: «''» }]",
  );
  const { rows: list, lines } = rows(s, shortRows);
  const clipboard = el('p', 'clipboard', '<span class="label">Copied</span><span class="text">&nbsp;</span>');
  list.style.width = '1070px';
  s.stage.append(list, clipboard);
  await s.enter();
  await wait(400);
  await widen(list, 700, 2600);
  await wait(1000);

  // Select the first row as a drag would, copy it, and show what the clipboard got.
  s.code("elide(el, { copy: «'full'» }) // the default");
  const line = lines[0]!;
  const [x0, y] = at(line, 0, 0.5);
  pointer.x = x0 + 120;
  pointer.y = y + 160;
  await showCursor(true);
  await moveTo([x0 + 1, y], 500);
  const start = document.caretPositionFromPoint(x0 + 1, y)!;
  const selection = getSelection()!;
  // The pointer moves first in each frame, then the selection follows it.
  await Promise.all([
    moveTo([x0 + line.getBoundingClientRect().width - 1, y], 800),
    tween(800, () => {
      const end = document.caretPositionFromPoint(pointer.x, y);
      if (end) selection.setBaseAndExtent(start.offsetNode, start.offset, end.offsetNode, end.offset);
    }),
  ]);
  await wait(400);
  const data = new DataTransfer();
  line.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
  clipboard.querySelector('.text')!.textContent = data.getData('text/plain');
  clipboard.animate({ opacity: [0, 1], translate: ['0 8px', '0 0'] }, { duration: 400, easing: 'ease-out', fill: 'forwards' });
  await wait(2600);
  selection.removeAllRanges();
  await moveTo([pointer.x + 120, pointer.y + 160], 350);
  await showCursor(false);
  await s.leave();
}

async function lists() {
  const s = new Scene(3, 'Count what a list <em>hides.</em>', 'elide(el, { ...list(names, { label: (n) => `${n} others` }) })');
  await sweep(s, rows(s, listRows).rows, 620, 900);
}

async function wholes() {
  const s = new Scene(4, 'Numbers stay <em>whole.</em>', "elide(el, { position: «'middle'», whole: «/[$€£]?\\d[\\d,.:/-]*\\d%?/g» })");
  await sweep(s, rows(s, wholeRows, calm).rows, 660, 920);
}

async function units() {
  const s = new Scene(
    5,
    'Icons, emoji and every <em>script.</em>',
    "elide(el, { position: «'middle'» }) // <svg> and [data-elide-unit] stay whole",
  );
  await sweep(s, rows(s, unitRows, calm).rows, 640, 940);
}

/** Inputs: truncated until pressed, when the whole value shows with the caret where the pointer is; truncated again on blur. */
async function inputs() {
  const s = new Scene(6, 'Inputs stay truncated until <em>focused.</em>', "elideInput(input, { position: «'middle'», keep: «/[^/]+$/» })");
  const list = el('div', 'rows box dense');
  list.style.width = '1070px';
  s.stage.append(list);
  const made = inputFields.map(({ label, value, placeholder, options }) => {
    const row = el('div', 'row', `<code>${label}</code>`);
    const input = el('input', 'field');
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.tabIndex = -1;
    row.append(input);
    list.append(row);
    const elided = elideInput(input, options);
    s.cleanup(() => elided.destroy());
    return { input, elided };
  });
  const row = el('div', 'row', `<code>${inputNote.label}</code>`);
  const area = el('textarea', 'field');
  area.value = inputNote.value;
  area.spellcheck = false;
  area.tabIndex = -1;
  row.append(area);
  list.append(row);
  const note = elideInput(area, inputNote.options);
  s.cleanup(() => note.destroy());
  // The textarea shrinks later: what's above it stays put.
  s.pin();
  await s.enter();
  await wait(400);
  await widen(list, 700, 1600);
  await wait(500);
  const { input, elided } = made[0]!;
  const ellipsis = elided.instance.element.querySelector('[data-fp-ellipsis]')!;
  pointer.x = 1000;
  pointer.y = 700;
  await showCursor(true);
  await moveTo(at(ellipsis, 0.7, 0.6), 700);
  await press(() => {
    const { x, y } = pointer;
    const init = { bubbles: true, button: 0, clientX: x, clientY: y, pointerType: 'mouse' };
    input.dispatchEvent(new PointerEvent('pointerdown', init));
    input.focus();
    // Where a real press would put the caret: the input is scrolled so the glyph pressed is under the pointer.
    const caret = document.caretPositionFromPoint(x, y);
    if (caret?.offsetNode === input) input.setSelectionRange(caret.offset, caret.offset);
    input.dispatchEvent(new PointerEvent('pointerup', init));
  });
  await wait(1900);
  await moveTo([list.getBoundingClientRect().right + 140, pointer.y + 40], 500);
  await press(() => input.blur());
  await wait(600);
  await showCursor(false);

  // A textarea: truncated on as many lines as its height holds.
  s.code("elideInput(textarea, { position: «'middle'», snap: words() })");
  const tall = area.getBoundingClientRect().height;
  const line = parseFloat(getComputedStyle(area).lineHeight);
  await tween(1000, (k) => (area.style.height = `${tall - line * k}px`));
  await wait(900);
  await tween(1000, (k) => (area.style.height = `${tall - line + line * k}px`));
  await wait(1200);
  await s.leave();
}

async function marks() {
  const s = new Scene(
    7,
    'Quotations, Chinese and <em>Japanese.</em>',
    "ellipsis: «'[…]'», snap: words()      ellipsis: «'auto'» // 中文, 日本語",
  );
  // (One quotation is enough.)
  const shown = markRows.filter(({ label }) => label !== "'(…)', 2 lines");
  const { rows: list, lines } = rows(s, shown);
  for (const [i, { lang, options }] of shown.entries()) {
    if (lang) lines[i]!.lang = lang;
    if (options.lines !== undefined) lines[i]!.classList.add('wraps');
  }
  await sweep(s, list, 660, 920);
}

/** Chips sized by their text: truncated, the plain ones stay narrow, and the ones with `autoSize()` grow back. Then a card shows as many lines as it's tall. */
async function sizing() {
  const s = new Scene(8, 'Sized by <em>content.</em>', "elide(chip, { autoSize: autoSize() })   elide(p, { lines: «'fit'» })");
  const chips = ['feature/balanced-gaps', 'tokens/colors.json', 'release/2026-10-14'];
  const list = el('div', 'rows box');
  for (const [label, baseline, options] of [
    ['without', true, { position: 'middle' }],
    ['autoSize()', false, { position: 'middle', autoSize: autoSize() }],
  ] as const) {
    const row = el('div', `row${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
    const strip = el('div', 'chips');
    for (const text of chips) {
      const chip = el('span', 'chip', text);
      strip.append(chip);
      s.elide(chip, options);
    }
    row.append(strip);
    list.append(row);
  }
  const row = el('div', 'row', "<code>lines: 'fit'</code>");
  const card = el('div', 'fit-card');
  const para = el('p', '', river);
  card.append(para);
  row.append(card);
  list.append(row);
  s.elide(para, { lines: 'fit', position: 0.6 }, calm);
  list.style.width = '1070px';
  s.stage.append(list);
  s.pin();
  await s.enter();
  await wait(400);
  await widen(list, 640, 2000);
  await wait(700);
  await widen(list, 1070, 1300);
  await wait(900);
  s.code("elide(p, { lines: «'fit'» }) // as many lines as it's tall");
  const tall = card.getBoundingClientRect().height;
  await tween(1100, (k) => (card.style.height = `${tall - (tall - 52) * k}px`));
  await wait(500);
  await tween(1100, (k) => (card.style.height = `${52 + (tall + 40 - 52) * k}px`));
  await wait(1000);
  await s.leave();
}

await film([intro, table, shortening, lists, wholes, units, inputs, marks, sizing, outro], 8);
