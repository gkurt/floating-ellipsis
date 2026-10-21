import { glyphs } from '#src/glyphs.ts';
import type { ElideOptions } from '#src/index.ts';
import { suffix } from '#src/suffix.ts';
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
import { Scene, at, box, click, el, film, lerp, moveTo, outro, pointer, rows, showCursor, tween, wait, widen } from './film.ts';

/** The first video: the features, a scene each. */

async function intro() {
  const s = new Scene(null, '<h1>Truncate text <em>anywhere.</em></h1>');
  const line = el('p', 'line', hero);
  const b = box(1080, line);
  b.classList.add('quiet');
  s.section.append(b);
  s.elide(line, { position: 0.5, glyphs }, fast);
  await s.enter();
  await wait(250);
  await widen(b, 560, 1500);
  await wait(450);
  await s.leave();
}

async function position() {
  const s = new Scene(1, 'Put the ellipsis <em>anywhere.</em>', 'elide(el, { position: «1.00» })');
  const line = el('p', 'line', hero);
  const knob = el('div', 'knob');
  const track = el('div', 'track');
  track.append(knob);
  s.stage.append(box(1000, line), track);
  track.style.width = '1000px';
  const t = s.elide(line, { position: 1, glyphs }, fading);
  const go = (v: number) => {
    t.update({ position: v });
    knob.style.left = `${v * 100}%`;
    s.code(`elide(el, { position: «${v.toFixed(2)}» })`);
  };
  go(1);
  await s.enter();
  for (const [from, to, ms] of [
    [1, 0.5, 950],
    [0.5, 0, 900],
    [0, 0.3, 700],
  ] as const) {
    await tween(ms, (k) => go(lerp(from, to, k)));
    await wait(260);
  }
  await wait(300);
  await s.leave();
}

/** Several lines, then several ellipses, then marks of other shapes: one change at a time. */
async function lines() {
  const [first, ...steps] = lineSteps;
  const s = new Scene(2, 'Any number of lines and <em>ellipses.</em>', `elide(el, { ${first!.src} })`);
  const para = el('p', 'para', river);
  const card = el('article', 'card box', '<h3>Field notes</h3>');
  card.append(para);
  card.style.width = '980px';
  s.stage.append(card);
  const t = s.elide(para, first!.options, calm);
  await s.enter();
  await wait(300);
  await widen(card, 720, 1100);
  for (const { options, src } of steps) {
    await wait(1000);
    t.update(options);
    s.code(`elide(el, { ${src} })`);
  }
  await wait(1100);
  await s.leave();
}

async function suffixes() {
  const s = new Scene(
    3,
    'Suffixes are never <em>truncated.</em>',
    "elide(el, { lines: «2», suffix: suffix(button, { show: «'truncated'» }) })",
  );
  const post = el('p', 'para', postText);
  const more = el('button', 'more', 'Read more');
  post.append(more);
  const list = el('div', 'issues');
  const issueLines = issues.map((html) => el('p', 'line', html));
  list.append(...issueLines);
  const b = box(1040, post, list);
  s.stage.append(b);
  s.pin();
  const t = s.elide(post, { lines: 2, suffix: suffix(more, { show: 'truncated' }) });
  t.onRender((state) => (more.textContent = state.expanded ? 'Show less' : 'Read more'));
  more.addEventListener('click', () => toggleSmoothly(t));
  for (const line of issueLines) {
    const badge = line.querySelector<HTMLElement>('.badge')!;
    s.elide(line, { suffix: suffix(badge) });
  }
  await s.enter();
  // It all fits: no button.
  await wait(700);
  await widen(b, 600, 1300);
  await wait(250);
  await showCursor(true);
  await moveTo(at(more), 600);
  await click(more);
  await wait(1200);
  await moveTo(at(more), 300);
  await click(more);
  await wait(800);
  await moveTo([pointer.x + 120, pointer.y + 160], 350);
  await showCursor(false);
  await s.leave();
}

async function snapping() {
  const s = new Scene(4, 'Truncate between words or path <em>segments.</em>', "snap: words()      snap: separators(«'/'»)");
  const { rows: list } = rows(s, snapRows);
  list.style.width = '1000px';
  s.stage.append(list);
  await s.enter();
  await wait(200);
  await widen(list, 600, 1700);
  await wait(250);
  await widen(list, 860, 1000);
  await wait(400);
  await s.leave();
}

/** A file list; `fits` adds a tag that follows `truncated`. */
function files(s: Scene, paths: string[], options: ElideOptions, fits = false) {
  const list = el('ul', 'files');
  const made = paths.map((path) => {
    const li = el('li', '', fileIcon(22));
    const span = el('span', 'path', path);
    li.append(span);
    list.append(li);
    return { li, span };
  });
  s.stage.append(list);
  return made.map(({ li, span }) => {
    const t = s.elide(span, options, calm);
    if (fits) {
      const tag = el('span', 'fits');
      li.append(tag);
      const show = () => {
        tag.textContent = t.truncated ? 'truncated' : 'fits';
        tag.classList.toggle('cut', t.truncated);
      };
      t.onRender(show);
      show();
    }
    return { li, t };
  });
}

/** Rows that fit show no tooltip; truncated ones grow theirs out of the line. */
async function tooltips() {
  const s = new Scene(5, 'Tooltips only where text is <em>truncated.</em>', "tooltip({ reveal: «'grow'» }).attach(instance)");
  const items = files(s, tooltipPaths, tooltipOptions, true);
  s.stage.querySelector<HTMLElement>('.files')!.style.width = '860px';
  // Wide enough for the second row's tip to stay on one line; the last one wraps.
  const tips = s.tooltip({ reveal: 'grow', delay: 250, grace: 0, breaks: '/\\', duration: 700 });
  for (const { li, t } of items) tips.attach(t, li);
  await s.enter();
  pointer.x = 1000;
  pointer.y = 640;
  await showCursor(true);
  for (const [i, rest] of [
    [0, 550],
    [1, 1400],
    [2, 550],
    [3, 1600],
  ] as const) {
    await moveTo(at(items[i]!.li, 0.42, 0.55), 380);
    await wait(rest);
  }
  await moveTo([pointer.x + 200, 700], 400);
  await showCursor(false);
  await s.leave();
}

async function keeping() {
  const s = new Scene(
    6,
    'Pin the parts that <em>matter.</em>',
    "keep: [/\\.pdf$/, { match: /fox|porch/, class: «'hit'» }, { match: /lamp/, context: «2» }]",
  );
  const list = el('div', 'rows');
  const b = box(1000, list);
  s.stage.append(b);
  for (const { text, mono, options } of keepRows) {
    const line = el('p', mono ? 'line mono' : 'line', text);
    list.append(line);
    s.elide(line, options);
  }
  await s.enter();
  await wait(200);
  await widen(b, 480, 2000);
  await wait(700);
  await widen(b, 800, 900);
  await wait(600);
  await s.leave();
}

async function find() {
  const s = new Scene(7, 'Find in page <em>finds it.</em>', "elide(el, { find: «'keep'» }) // the default");
  const bar = el('div', 'findbar', '<span class="query"></span><span class="count"></span><kbd>Enter</kbd>');
  const query = bar.querySelector<HTMLElement>('.query')!;
  const count = bar.querySelector<HTMLElement>('.count')!;
  const lines = lantern.map((text) => el('p', 'line', text));
  const list = el('div', 'rows find-rows');
  list.append(...lines);
  const b = box(1000, list);
  s.stage.append(bar, b);
  for (const [i, line] of lines.entries()) s.elide(line, { position: lanternPosition(lantern[i]!) }, calm);
  await s.enter();
  await wait(300);
  for (const ch of 'lantern') {
    query.textContent += ch;
    await wait(65);
  }
  for (const [i, line] of lines.entries()) {
    count.textContent = `${i + 1}/${lines.length}`;
    // What find in page fires on the hidden word it found.
    const found = lantern[i]!.indexOf('lantern');
    const word = line.querySelector(`[data-fp-word="${found}:${found + 7}"]`);
    word?.dispatchEvent(new Event('beforematch', { bubbles: true }));
    await wait(1100);
  }
  await wait(200);
  await s.leave();
}

/** Sibling paths truncated in the middle all look alike; keeping what differs tells them apart. */
async function shared() {
  const s = new Scene(8, 'Customize: truncate what’s <em>shared.</em>', "keep: differing(path, siblings), snap: separators(«'/'»)");
  const split = el('div', 'split box');
  for (const { label, baseline, options } of sharedColumns) {
    const column = el('div', `rows${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
    split.append(column);
    for (const path of siblings) {
      const line = el('p', 'line mono', path);
      column.append(line);
      s.elide(line, options(path), calm);
    }
  }
  split.style.width = '1060px';
  s.stage.append(split);
  await s.enter();
  await wait(500);
  await widen(split, 780, 1600);
  await wait(1800);
  await s.leave();
}

await film([intro, position, lines, suffixes, snapping, tooltips, keeping, find, shared, outro], 8);
