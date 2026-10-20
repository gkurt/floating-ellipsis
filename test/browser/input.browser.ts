import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { ellipsisRect, graphemeRect } from '#src/geometry.ts';
import { type ElidedInput, type InputOptions, elideInput } from '#src/input.ts';
import { FONTS, PATH, frames, track } from './helpers.ts';

const fields: ElidedInput[] = [];

// The page's one mouse and focus: other files' tests wait while these use them.
beforeEach(() => commands.pointer('take'));

afterEach(async () => {
  for (const f of fields.splice(0)) f.destroy();
  (document.activeElement as HTMLElement | null)?.blur();
  await commands.mouse('move', 0, innerHeight - 1);
  await commands.pointer('give');
});

/** A text field holding `value`, cut by `elideInput` until the test ends. */
function field(value: string, font: string, options: InputOptions = {}, css = '') {
  const input = track(document.createElement('input'));
  input.value = value;
  input.style.cssText = `font:${font};width:240px;padding:4px 8px;border:1px solid #888;margin:20px;${css}`;
  document.body.append(input);
  const f = elideInput(input, options);
  fields.push(f);
  const copy = input.nextElementSibling as HTMLElement;
  return { input, f, t: f.instance, copy };
}

const fill = (input: HTMLInputElement) => input.style.getPropertyValue('-webkit-text-fill-color');

/** Press and release the real mouse at `x`, `y`. */
async function press(x: number, y: number) {
  await commands.mouse('down', x, y);
  await commands.mouse('up', x, y);
}

describe.each(FONTS)('elideInput, in %s', (font) => {
  it('shows the value cut over the field, its own text hidden', () => {
    const { input, t, copy } = field(PATH, font, { position: 'middle' });
    expect(t.truncated).toBe(true);
    expect(t.state.text).toBe(PATH);
    expect(fill(input)).toBe('transparent');
    expect(copy.inert).toBe(true);
    const [a, b] = [input.getBoundingClientRect(), copy.getBoundingClientRect()];
    for (const side of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(a[side] - b[side])).toBeLessThan(0.5);
    // Its text starts where the field's would.
    const cs = getComputedStyle(input);
    const start = a.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    expect(Math.abs(graphemeRect(t, 0)!.left - start)).toBeLessThan(0.5);
  });

  it('puts the caret where the cut text was pressed', async () => {
    const { input, t } = field(PATH, font, { position: 'middle' });
    const n = PATH.length;
    const cut = t.state.hidden[0]!;
    for (const i of [2, cut.start - 2, cut.end + 1, n - 3]) {
      const r = graphemeRect(t, i)!;
      await press(r.left + r.width * 0.25, r.top + r.height / 2);
      expect(document.activeElement).toBe(input);
      // The glyph pressed stayed under the pointer: the caret is beside it.
      expect(input.selectionStart).toBe(i);
      expect(fill(input)).toBe('');
      input.blur();
      expect(fill(input)).toBe('transparent');
    }
  });

  it('puts it either side of what a pressed ellipsis hides', async () => {
    const { input, t } = field(PATH, font, { position: 'middle' });
    const { start, end } = t.state.hidden[0]!;
    const r = ellipsisRect(t, 0)!;
    const y = r.top + r.height / 2;
    await press(r.left + r.width * 0.2, y);
    expect(input.selectionStart).toBe(start);
    input.blur();
    await press(r.right - r.width * 0.2, y);
    expect(input.selectionStart).toBe(end);
  });

  it('selects by dragging, as any field', async () => {
    const { input, t } = field(PATH, font, { position: 'end' });
    const r = graphemeRect(t, 3)!;
    const y = r.top + r.height / 2;
    await commands.mouse('down', r.left + 1, y);
    await commands.mouse('move', r.left + 60, y);
    await commands.mouse('up', r.left + 60, y);
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd!).toBeGreaterThan(6);
  });

  it('shows all of it while focused from the keyboard', () => {
    const { input, copy } = field(PATH, font);
    input.focus();
    expect(copy.style.visibility).toBe('hidden');
    expect(fill(input)).toBe('');
    input.blur();
    expect(copy.style.visibility).toBe('');
  });

  it('follows a value set by script', () => {
    const { input, t } = field(PATH, font, { position: 'start' });
    input.value = 'C:\\Users\\grace\\AppData\\Local\\Packages\\settings.json';
    expect(t.state.text).toBe(input.value);
    expect(t.truncated).toBe(true);
    input.value = 'short';
    expect(t.truncated).toBe(false);
  });

  it('cuts the placeholder while empty, in its colour', () => {
    const { input, t, copy } = field('', font, { position: 'middle' });
    input.placeholder = 'Search every note, file and folder in the difference engine project';
    input.dispatchEvent(new Event('input'));
    expect(t.state.text).toBe(input.placeholder);
    expect(t.truncated).toBe(true);
    const placeholder = getComputedStyle(input, '::placeholder');
    expect(copy.style.color).toBe(placeholder.color);
    // Focused and still empty, it stays.
    input.focus();
    expect(copy.style.visibility).toBe('');
  });

  it('settles in once a field made outside the page is put in it', async () => {
    // A shadow root: the document has the sheet hiding placeholders from the other tests already.
    const host = track(document.createElement('div'));
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.placeholder = 'Search every note, file and folder in the difference engine project';
    input.style.cssText = `font:${font};width:240px;padding:4px 8px;border:1px solid #888;`;
    const f = elideInput(input, { position: 'middle' });
    fields.push(f);
    root.append(input);
    await frames();
    expect(input.nextElementSibling).toBe(f.instance.element);
    expect(f.instance.truncated).toBe(true);
    expect(getComputedStyle(input, '::placeholder').getPropertyValue('-webkit-text-fill-color')).toBe('rgba(0, 0, 0, 0)');
  });

  it('never shows a password', async () => {
    const { input, t, copy } = field('correct horse battery staple, and then some', font, {}, '');
    input.type = 'password';
    await frames(1);
    expect(t.state.text).toBe('');
    expect(copy.style.visibility).toBe('hidden');
    expect(fill(input)).toBe('');
    input.type = 'text';
    await frames(1);
    expect(t.state.text).toBe(input.value);
    expect(fill(input)).toBe('transparent');
  });

  it('gives the field back', () => {
    const { input, f } = field(PATH, font);
    f.destroy();
    expect(input.nextElementSibling).toBeNull();
    expect(fill(input)).toBe('');
    expect(input.hasAttribute('data-fp-input')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(input, 'value')).toBeUndefined();
    input.value = 'still works';
    expect(input.value).toBe('still works');
  });
});
