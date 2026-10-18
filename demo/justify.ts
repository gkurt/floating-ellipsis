import { type ElideOptions, elide, separators, words } from '#src/index.ts';
import { $ } from './ui.ts';

const MODES: [ElideOptions['justify'], string][] = [
  ['dots', 'Every gap evens out, growing up to maxGap. With repeat, a dot goes in wherever one fits with every gap as wide as it was.'],
  ['ellipsis', 'The two gaps around the dots take the room. With repeat, dots spaced like the others go in first.'],
  ['spread', 'Letter-spacing takes the room. With repeat, dots go in first and the letters spread only by what is left.'],
  [false, 'The room stays at the end. With repeat, dots go in wherever they fit, leaving less than one.'],
];

const PROSE = 'Internationalization and accessibility considerations for a globally distributed design system';
const PATH = '/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md';

const EXAMPLES: [string, string, ElideOptions, string?][] = [
  ['words, end', PROSE, { snap: words() }],
  ['path segments, middle', PATH, { snap: separators('/'), position: 'middle' }, 'path'],
  ['words, 2 lines', PROSE, { snap: words(), lines: 2 }],
  ['bullets, words', PROSE, { snap: words(), ellipsis: { shape: 'bullet' } }],
  ['graphemes, middle', PROSE, { position: 'middle' }],
];

const modes = $('#modes');
const rooms: HTMLElement[] = [];

const line = (text: string, cls: string) => {
  const el = document.createElement('p');
  el.className = cls;
  el.textContent = text;
  return el;
};

for (const [justify, about] of MODES) {
  const card = document.createElement('section');
  card.className = 'mode';
  card.append(line(`justify: ${justify === false ? 'false' : `'${justify}'`}`, 'name'), line(about, 'about'));
  for (const [label, content, options, cls] of EXAMPLES) {
    card.append(line(label, 'label'));
    for (const repeat of [false, true]) {
      const el = document.createElement('div');
      el.className = `room ${cls ?? ''}`;
      el.dataset.repeat = String(repeat);
      el.textContent = content;
      rooms.push(el);
      card.append(el);
      elide(el, { ...options, justify, repeat });
    }
  }
  modes.append(card);
}

const input = $<HTMLInputElement>('#width');
const output = $('#width-out');
const apply = () => {
  for (const r of rooms) r.style.width = `${input.value}px`;
  output.textContent = `${input.value}px`;
};
input.addEventListener('input', apply);
apply();
