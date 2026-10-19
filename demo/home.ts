import { glyphs } from '#src/glyphs.ts';
import { elide } from '#src/index.ts';
import { suffix } from '#src/suffix.ts';
import { tooltip } from '#src/tooltip.ts';
import { transitions } from '#src/transitions.ts';
import {
  calm,
  fading,
  fast,
  fileIcon,
  hero,
  issues,
  keepRows,
  lantern,
  lanternPosition,
  lineSteps,
  post as postText,
  river,
  sharedColumns,
  siblings,
  snapRows,
  toggleSmoothly,
  tooltipOptions,
  tooltipPaths,
} from './examples.ts';
import { calmMotion, el, room, setCode, stage } from './scenes.ts';
import { $, resizable } from './ui.ts';

/**
 * The home page: the video's scenes, live. Each box sweeps its width once
 * when it first comes into view, as in the video, and then it's the
 * reader's to resize.
 */

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
  for (const { label, text, mono, baseline, options } of snapRows) {
    const row = el('div', `labeled-row${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
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
  for (const { label, baseline, options } of sharedColumns) {
    const column = el('div', `column${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
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
