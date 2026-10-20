import { autoSize } from '#src/autosize.ts';
import { type ElideOptions, elide } from '#src/index.ts';
import { elideInput } from '#src/input.ts';
import { tooltip } from '#src/tooltip.ts';
import { transitions } from '#src/transitions.ts';
import {
  calm,
  inputFields,
  listRows,
  markRows,
  river,
  shortRows,
  snippetKeep,
  snippets,
  tightRows,
  unitRows,
  wholeRows,
} from './examples.ts';
import { el, setCode, stage } from './scenes.ts';
import { $ } from './ui.ts';

/** The advanced page: the features past the home page's, each in a box to resize, as there. */

// ---------------------------------------------------------------------------
// 01 Sized by content

{
  const box = $('#autosizeBox');
  const chips = ['feature/balanced-ellipsis-gaps', 'design-system/tokens/colors.json', 'release/2026-10-14-hotfix'];
  const rows: { label: string; baseline?: boolean; options: ElideOptions }[] = [
    { label: 'without', baseline: true, options: { position: 'middle' } },
    { label: 'autoSize()', options: { position: 'middle', autoSize: autoSize() } },
  ];
  for (const { label, baseline, options } of rows) {
    const row = el('div', `labeled-row${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
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
// 02 Icons, emoji and every script

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
// 03 Lists

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
// 04 Snippets around a match

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
    setCode('snippetCode', `keep: { match: /«${q}»/gi, class: «'hit'», context: «2» }`);
  };
  query.addEventListener('input', search);
  search();
  stage(box, [0.35, 0.8]);
}

// ---------------------------------------------------------------------------
// 05 Numbers stay whole

{
  const box = $('#wholeBox');
  for (const { label, text, baseline, options } of wholeRows) {
    const row = el('div', `labeled-row${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
    const line = el('p', 'line', text);
    row.append(line);
    box.insertBefore(row, $('.handle', box));
    transitions(elide(line, options), calm);
  }
  setCode('wholeCode', "elide(el, { position: «'middle'», whole: «/[$€£]?\\d[\\d,.:/-]*\\d%?/g» })");
  stage(box, [0.45, 0.9]);
}

// ---------------------------------------------------------------------------
// 06 Tighten before you cut

{
  const box = $('#tightenBox');
  for (const { label, text, baseline, options } of tightRows) {
    const row = el('div', `labeled-row${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
    const line = el('p', 'line', text);
    const readout = el('span', 'tightness');
    row.append(line, readout);
    box.insertBefore(row, $('.handle', box));
    elide(line, options).onRender(({ tightened, truncated }) => {
      const by = tightened > 0 ? `−${tightened.toFixed(2)}px` : '';
      readout.textContent = truncated ? `cut ${by}`.trim() : by;
    });
  }
  setCode('tightenCode', "elide(el, { tighten: «'0.05em'» }) // letters up to 0.05em closer, word spaces 0.1em");
  stage(box, [0.42, 0.62]);
}

// ---------------------------------------------------------------------------
// 07 Fields stay cut until you edit

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
  stage(box, [0.5, 0.75]);
}

// ---------------------------------------------------------------------------
// 08 Quotations, Chinese and Japanese

{
  const box = $('#marksBox');
  for (const { label, text, lang, baseline, options } of markRows) {
    const row = el('div', `labeled-row${baseline ? ' baseline' : ''}`, `<code>${label}</code>`);
    const line = el('p', 'line', text);
    if (lang) line.lang = lang;
    if (options.lines !== undefined) line.classList.add('wraps');
    row.append(line);
    box.insertBefore(row, $('.handle', box));
    elide(line, options);
  }
  setCode('marksCode', "elide(quote, { ellipsis: «'[…]'», snap: words() }); elide(chinese, { ellipsis: «'auto'» })");
  stage(box, [0.4, 0.75]);
}

// ---------------------------------------------------------------------------
// 09 Shorter before it's cut

{
  const box = $('#shortBox');
  const tips = tooltip({ reveal: 'grow' });
  for (const { label, text, options } of shortRows) {
    const row = el('div', 'labeled-row', `<code>${label}</code>`);
    const line = el('p', 'line', text);
    const readout = el('span', 'tightness');
    row.append(line, readout);
    box.insertBefore(row, $('.handle', box));
    const t = elide(line, options);
    t.onRender(({ short, truncated }) => {
      readout.textContent = truncated ? 'cut' : short.length > 0 ? `${short.length} short` : '';
    });
    tips.attach(t, row);
  }
  setCode('shortCode', "shorten: [{ match: «'Wednesday'», to: [«'Wed'», «'W'»] }, { match: «' 2026'», to: «''» }]");
  stage(box, [0.4, 0.85]);
}
