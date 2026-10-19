import { autoSize } from '#src/autosize.ts';
import { glyphs } from '#src/glyphs.ts';
import { type Elide, type ElideOptions, elide } from '#src/index.ts';
import { elideInput } from '#src/input.ts';
import { suffix } from '#src/suffix.ts';
import { tooltip } from '#src/tooltip.ts';
import { transitions } from '#src/transitions.ts';
import {
  calm,
  code,
  fading,
  fast,
  fileIcon,
  hero,
  inputFields,
  issues,
  keepRows,
  lantern,
  lanternPosition,
  lensAt,
  lineSteps,
  listRows,
  post as postText,
  quote,
  river,
  sharedColumns,
  siblings,
  snapRows,
  snippetKeep,
  snippets,
  tightRows,
  toggleSmoothly,
  tooltipOptions,
  tooltipPaths,
  unitRows,
  wholeRows,
} from './examples.ts';
import { $, resizable } from './ui.ts';

/**
 * The home page: the video's scenes, live. Each box sweeps its width once
 * when it first comes into view, as in the video, and then it's the
 * reader's to resize.
 */

const calmMotion = !matchMedia('(prefers-reduced-motion: reduce)').matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  node.innerHTML = html;
  return node;
}

function setCode(id: string, src: string) {
  $(`#${id}`).innerHTML = code(src);
}

/** The widest a box may be: its parent's content width. */
function room(box: HTMLElement) {
  const parent = box.parentElement!;
  const cs = getComputedStyle(parent);
  return parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

const smooth = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/**
 * Resizable by its handle; the first time it's well in view, its width
 * sweeps through `widths` (fractions of the room it has), unless the handle
 * is taken first.
 */
function stage(box: HTMLElement, widths: number[]) {
  let taken = false;
  resizable(box, () => (taken = true));
  if (!calmMotion) return;
  const seen = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      seen.disconnect();
      void sweep();
    },
    { threshold: 0.6 },
  );
  seen.observe(box);
  async function sweep() {
    for (const to of widths) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const from = box.getBoundingClientRect().width;
      const target = to * room(box);
      const ms = Math.min(1700, Math.max(700, Math.abs(target - from) * 2.6));
      const start = performance.now();
      const done = await new Promise<boolean>((resolve) => {
        const frame = (now: number) => {
          if (taken) return resolve(false);
          const k = Math.min(1, (now - start) / ms);
          box.style.width = `${from + (target - from) * smooth(k)}px`;
          if (k < 1) requestAnimationFrame(frame);
          else resolve(true);
        };
        requestAnimationFrame(frame);
      });
      if (!done) return;
    }
    // Back to a share of the room, so it follows the window from here.
    box.style.width = `${widths.at(-1)! * 100}%`;
  }
}

// ---------------------------------------------------------------------------
// Hero: the line breathes while it's on screen, until its handle is taken.

const heroBox = $('#heroBox');
const heroLine = $('#hero');
heroLine.textContent = hero;
transitions(elide(heroLine, { position: 0.5, glyphs }), fast);
{
  let breathing = calmMotion;
  let visible = true;
  let phase = 0;
  let last = 0;
  const tick = (now: number) => {
    if (!breathing || !visible) return void (last = 0);
    phase += (last !== 0 ? Math.min(64, now - last) : 16) / 9000;
    last = now;
    const max = room(heroBox);
    const min = Math.min(300, max);
    heroBox.style.width = `${max - (max - min) * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2))}px`;
    requestAnimationFrame(tick);
  };
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    if (visible) requestAnimationFrame(tick);
  }).observe(heroBox);
  resizable(heroBox, () => (breathing = false));
}

// ---------------------------------------------------------------------------
// 01 Position

{
  const line = $('#positionLine');
  line.textContent = hero;
  const t = elide(line, { position: 1, glyphs });
  transitions(t, fading);
  const track = $<HTMLInputElement>('#positionTrack');
  const go = () => {
    const v = Number(track.value);
    t.update({ position: v });
    track.style.setProperty('--at', `${v * 100}%`);
    setCode('positionCode', `elide(el, { position: «${v.toFixed(2)}» })`);
  };
  track.addEventListener('input', go);
  go();
  stage($('#positionBox'), [0.7, 1]);
}

// ---------------------------------------------------------------------------
// 02 Lines and ellipses

{
  const para = $('#river');
  para.textContent = river;
  const t = elide(para, lineSteps[0]!.options);
  transitions(t, calm);
  const steps = $('#lineSteps');
  const pick = (i: number) => {
    const { options, src } = lineSteps[i]!;
    // Each step whole: what it leaves out goes back to the default.
    t.update({ position: 'end', ellipsis: '…', ...options });
    setCode('linesCode', `elide(el, { ${src} })`);
    for (const [j, b] of [...steps.children].entries()) b.setAttribute('aria-pressed', String(j === i));
  };
  const labels = ['3 lines', 'position 0.6', 'two ellipses', 'bullets', 'rings', 'squares'];
  for (const [i, label] of labels.entries()) {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', () => pick(i));
    steps.append(b);
  }
  pick(0);
  stage($('#linesBox'), [0.72]);
}

// ---------------------------------------------------------------------------
// 03 Suffixes

{
  const post = $('#post');
  const more = $<HTMLButtonElement>('.more', post);
  post.prepend(`${postText} `);
  const t = elide(post, { lines: 2, suffix: suffix(more, { show: 'truncated' }) });
  t.onRender((state) => (more.textContent = state.expanded ? 'Show less' : 'Read more'));
  more.addEventListener('click', () => toggleSmoothly(t));
  const list = $('#issues');
  for (const html of issues) {
    const line = el('p', 'line', html);
    list.append(line);
    elide(line, { suffix: suffix($('.badge', line)) });
  }
  setCode('suffixCode', "elide(el, { lines: «2», suffix: suffix(button, { show: «'truncated'» }) })");
  stage($('#suffixBox'), [0.55]);
}

// ---------------------------------------------------------------------------
// 04 Snapping

{
  const box = $('#snapBox');
  for (const { label, text, mono, options } of snapRows) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const line = el('p', mono ? 'line mono' : 'line', text);
    row.append(line);
    box.insertBefore(row, $('.handle', box));
    elide(line, options);
  }
  setCode('snapCode', "snap: words()      snap: separators(«'/'»)");
  stage(box, [0.6, 0.86]);
}

// ---------------------------------------------------------------------------
// 05 Tooltips

{
  const list = $('#tipsList');
  const tips = tooltip({ reveal: 'grow', breaks: '/\\', maxWidth: 0.75 });
  for (const path of tooltipPaths) {
    const li = el('li', '', fileIcon(16));
    li.tabIndex = 0;
    const span = el('span', 'path', path);
    const tag = el('span', 'fits');
    li.append(span, tag);
    list.append(li);
    const t = elide(span, tooltipOptions);
    transitions(t, calm);
    const show = () => {
      tag.textContent = t.truncated ? 'truncated' : 'fits';
      tag.classList.toggle('cut', t.truncated);
    };
    t.onRender(show);
    show();
    tips.attach(t, li);
  }
  setCode('tipsCode', "tooltip({ reveal: «'grow'» }).attach(instance)");
  stage($('#tipsBox'), [0.8]);
}

// ---------------------------------------------------------------------------
// 06 Keep

{
  const box = $('#keepBox');
  for (const { text, mono, options } of keepRows) {
    const line = el('p', mono ? 'line mono' : 'line', text);
    box.insertBefore(line, $('.handle', box));
    elide(line, options);
  }
  setCode('keepCode', "keep: [/\\.pdf$/, { match: /fox|porch/, class: «'hit'» }]");
  stage(box, [0.45, 0.8]);
}

// ---------------------------------------------------------------------------
// 07 Find in page: the real thing.

{
  const box = $('#findBox');
  for (const text of lantern) {
    const line = el('p', 'line', text);
    box.insertBefore(line, $('.handle', box));
    transitions(elide(line, { position: lanternPosition(text) }), calm);
  }
  setCode('findCode', "elide(el, { find: «'keep'» }) // the default");
  stage(box, [0.85]);
}

// ---------------------------------------------------------------------------
// 08 Cut what's shared

{
  const box = $('#sharedBox');
  for (const [label, options] of sharedColumns) {
    const column = el('div', 'column', `<code>${label}</code>`);
    box.insertBefore(column, $('.handle', box));
    for (const path of siblings) {
      const line = el('p', 'line mono', path);
      column.append(line);
      transitions(elide(line, options(path)), calm);
    }
  }
  setCode('sharedCode', "keep: differing(path, siblings), snap: separators(«'/'»)");
  stage(box, [0.72]);
}

// ---------------------------------------------------------------------------
// 09 A lens, following the pointer

{
  const lensStage = $('#lensStage');
  const line = $('#lensLine');
  line.textContent = quote;
  const n = [...new Intl.Segmenter().segment(quote)].length;
  const t: Elide = elide(line, { position: 0.5, glyphs });
  setCode('lensCode', 'keep: { start: «0», end: «0» }, position: «0.50»');
  lensStage.addEventListener('pointermove', (e) => {
    const r = line.getBoundingClientRect();
    const { options, src } = lensAt(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), n);
    t.update(options);
    setCode('lensCode', src);
  });
}

// ---------------------------------------------------------------------------
// 10 Sized by content

{
  const box = $('#autosizeBox');
  const chips = ['feature/balanced-ellipsis-gaps', 'design-system/tokens/colors.json', 'release/2026-10-14-hotfix'];
  const rows: [string, ElideOptions][] = [
    ['without', { position: 'middle' }],
    ['autoSize()', { position: 'middle', autoSize: autoSize() }],
  ];
  for (const [label, options] of rows) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const strip = el('div', 'chips');
    for (const text of chips) {
      const chip = el('span', 'chip', text);
      strip.append(chip);
      elide(chip, options);
    }
    row.append(strip);
    box.insertBefore(row, $('.handle', box));
  }
  const row = el('div', 'labeled-row', "<code>lines: 'fit'</code>");
  const card = el('div', 'fit-card');
  const para = el('p', '', river);
  card.append(para);
  row.append(card);
  box.insertBefore(row, $('.handle', box));
  transitions(elide(para, { lines: 'fit', position: 0.6 }), calm);
  setCode('autosizeCode', "elide(chip, { autoSize: autoSize() })   elide(p, { lines: «'fit'» })");
  stage(box, [0.4, 1]);
}

// ---------------------------------------------------------------------------
// 11 Icons, emoji and every script

{
  const box = $('#unitsBox');
  for (const { label, text, options } of unitRows) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const line = el('p', 'line', text);
    row.append(line);
    box.insertBefore(row, $('.handle', box));
    transitions(elide(line, options), calm);
  }
  setCode('unitsCode', "elide(el, { position: «'middle'» }) // <img>, <svg> and [data-elide-unit] stay whole");
  stage(box, [0.4, 0.9]);
}

// ---------------------------------------------------------------------------
// 12 Lists

{
  const box = $('#listBox');
  for (const { label, text, options } of listRows) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const line = el('p', 'line', text);
    row.append(line);
    box.insertBefore(row, $('.handle', box));
    elide(line, options);
  }
  setCode('listCode', 'elide(el, { ...list(names, { label: (n) => `${n} others` }) })');
  stage(box, [0.3, 0.75]);
}

// ---------------------------------------------------------------------------
// 13 Snippets around a match

{
  const box = $('#snippetBox');
  const query = $<HTMLInputElement>('#snippetQuery');
  const rows = snippets.map((text) => {
    const line = el('p', 'line', text);
    box.insertBefore(line, $('.handle', box));
    return elide(line, { keep: snippetKeep(query.value) });
  });
  const search = () => {
    const keep = snippetKeep(query.value);
    for (const t of rows) t.update({ keep });
    const q = query.value.trim().replace(/[<&]/g, '') || '…';
    setCode('snippetCode', `keep: { match: /«${q}»/gi, class: «'hit'», context: «Infinity» }`);
  };
  query.addEventListener('input', search);
  search();
  stage(box, [0.35, 0.8]);
}

// ---------------------------------------------------------------------------
// 14 Numbers stay whole

{
  const box = $('#wholeBox');
  for (const { label, text, options } of wholeRows) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const line = el('p', 'line', text);
    row.append(line);
    box.insertBefore(row, $('.handle', box));
    transitions(elide(line, options), calm);
  }
  setCode('wholeCode', "elide(el, { position: «'middle'», whole: «/[$€£]?\\d[\\d,.:/-]*\\d%?/g» })");
  stage(box, [0.45, 0.9]);
}

// ---------------------------------------------------------------------------
// 15 Tighten before you cut

{
  const box = $('#tightenBox');
  for (const { label, text, options } of tightRows) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const line = el('p', 'line', text);
    const readout = el('span', 'tightness');
    row.append(line, readout);
    box.insertBefore(row, $('.handle', box));
    elide(line, options).onRender(({ tightened, truncated }) => {
      readout.textContent = truncated ? 'cut' : tightened > 0 ? `−${tightened.toFixed(2)}px` : '';
    });
  }
  setCode('tightenCode', "elide(el, { tighten: «'0.05em'» }) // letters up to 0.05em closer, word spaces 0.1em");
  stage(box, [0.42, 0.62]);
}

// ---------------------------------------------------------------------------
// 16 Fields, cut until you edit

{
  const box = $('#inputBox');
  for (const { label, value, placeholder, options } of inputFields) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const input = el('input', 'field');
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    row.append(input);
    box.insertBefore(row, $('.handle', box));
    elideInput(input, options);
  }
  setCode('inputCode', "elideInput(input, { position: «'middle'», keep: «/[^/]+$/» })");
  stage(box, [0.5, 1]);
}
