import { autoSize } from '#src/autosize.ts';
import { type AutoSize, elide } from '#src/index.ts';
import { $ } from './ui.ts';

const MODES: [AutoSize | null, string, string][] = [
  [null, 'Without autoSize', 'The width comes from what shows: the element shrinks with the room, but never grows back.'],
  [autoSize(), 'autoSize()', 'An invisible copy of the full text sizes the element, as the text would, up to the room it has.'],
];

const TEXT = 'The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly';

const modes = $('#modes');
const rooms: HTMLElement[] = [];

function room(label: string, content: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  const caption = document.createElement('p');
  caption.className = 'label';
  caption.textContent = label;
  const el = document.createElement('div');
  el.className = 'room';
  el.append(content);
  rooms.push(el);
  wrap.append(caption, el);
  return wrap;
}

for (const [sizing, name, about] of MODES) {
  const card = document.createElement('section');
  card.className = 'mode';
  const title = document.createElement('h2');
  title.textContent = name;
  const text = document.createElement('p');
  text.textContent = about;

  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = 'design-system/tokens/colors.json';

  const row = document.createElement('div');
  row.className = 'row';
  const item = document.createElement('span');
  item.className = 'item';
  item.textContent = TEXT;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'new';
  row.append(item, badge);

  const two = document.createElement('span');
  two.className = 'two';
  two.textContent = TEXT;

  card.append(
    title,
    text,
    room('chip, max-width: 100%', chip),
    room('flex item, min-width: 0', row),
    room('inline-block, 2 lines, uncapped', two),
  );
  modes.append(card);

  elide(chip, { position: 'middle', autoSize: sizing });
  elide(item, { autoSize: sizing });
  elide(two, { lines: 2, autoSize: sizing });
}

const input = $<HTMLInputElement>('#width');
const output = $('#width-out');
const apply = () => {
  for (const r of rooms) r.style.width = `${input.value}px`;
  output.textContent = `${input.value}px`;
};
input.addEventListener('input', apply);
apply();
