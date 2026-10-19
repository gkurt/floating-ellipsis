import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commands, server, userEvent } from 'vitest/browser';
import type { Elide } from '#src/elide.ts';
import { ellipsisArea, ellipsisInk, graphemeRect } from '#src/geometry.ts';
import { type Tooltip, type TooltipOptions, tooltip } from '#src/tooltip.ts';
import { PATH, PROSE, box, frames, make, spacer } from './helpers.ts';

// WebKit doesn't kern across element boundaries, and the tip sets every
// grapheme in a span of its own: its glyphs land up to a pixel off the
// original's kerned text.
const slack = server.browser === 'webkit' ? 1 : 0.5;
const expectNear = (actual: number, expected: number, what = '') => expect(Math.abs(actual - expected), what).toBeLessThan(slack);

const tips: Tooltip[] = [];
const make_tip = (options: TooltipOptions): Tooltip => {
  const tip = tooltip(options);
  tips.push(tip);
  return tip;
};

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = `
    [data-fp-tip] { padding: 4px 10px; color: white }
    [data-fp-tip-bg] { background: #222 }
    [data-fp-tip='peek'] { font: 13px/18px monospace; max-width: 300px }
  `;
  document.head.append(style);
});

// The page's one mouse: other files' tests wait while these use it.
beforeEach(() => commands.pointer('take'));

afterEach(async () => {
  for (const tip of tips.splice(0)) tip.destroy();
  getSelection()?.removeAllRanges();
  await commands.mouse('move', 0, innerHeight - 1);
  await commands.pointer('give');
});

/** The tip's graphemes, one span each, in order. */
function graphemeSpans(tip: Tooltip): HTMLElement[] {
  return [...tip.element.querySelectorAll<HTMLElement>('span:not([data-fp-mark])')].filter((s) => s.childElementCount === 0);
}

/** The tip's text, without the marks a growing tip fades out. */
const tipText = (tip: Tooltip): string =>
  graphemeSpans(tip)
    .map((s) => s.textContent)
    .join('');

const finish = (tip: Tooltip) => tip.element.getAnimations({ subtree: true }).forEach((a) => a.finish());

const center = (r: DOMRect): [number, number] => [r.left + r.width / 2, r.top + r.height / 2];

/** Every grapheme showing in the line is under its copy in the tip, as far as the tip's first line goes. */
function expectOnLine(tip: Tooltip, t: Elide) {
  const spans = graphemeSpans(tip);
  const top = spans[0]!.getBoundingClientRect().top;
  const part = t.state.hidden[0]!;
  for (let i = 0; i < part.start; i++) {
    const r = spans[i]!.getBoundingClientRect();
    if (Math.abs(r.top - top) > 1) break;
    const original = graphemeRect(t, i)!;
    expectNear(r.left, original.left, `grapheme ${i} '${t.graphemes[i]}'`);
    expectNear(r.top, original.top, `grapheme ${i} '${t.graphemes[i]}'`);
  }
}

function expectInWindow(tip: Tooltip, edge = 8) {
  const r = tip.element.getBoundingClientRect();
  expect(r.left).toBeGreaterThanOrEqual(edge - 0.5);
  expect(r.right).toBeLessThanOrEqual(document.documentElement.clientWidth - edge + 0.5);
  expect(r.bottom).toBeLessThanOrEqual(innerHeight - edge + 0.5);
}

describe('tooltip', () => {
  it('lays the full text over the line, glyph on glyph', () => {
    const t = make(box(PROSE, 'width:260px;margin-left:40px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'expand' });
    tip.attach(t);
    expect(tip.show(t)).toBe(true);
    expect(tip.element.hidden).toBe(false);
    expect(tip.element.dataset.fpTip).toBe('expand');
    expect(tipText(tip)).toBe(PROSE);
    expectOnLine(tip, t);
    expectInWindow(tip);
    expect(t.element.hasAttribute('data-fp-tip-open')).toBe(true);
  });

  /** A 'grow' tip for PROSE cut in the middle, just opened. */
  function growing() {
    const t = make(box(PROSE, 'width:260px;margin-left:40px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'grow' });
    tip.attach(t);
    expect(tip.show(t)).toBe(true);
    expect(tip.element.getAnimations({ subtree: true }).length).toBeGreaterThan(0);
    return { t, tip };
  }

  it('grows from the line: every grapheme showing starts where it is', () => {
    const { t, tip } = growing();
    for (const a of tip.element.getAnimations({ subtree: true })) {
      a.pause();
      a.currentTime = 0;
    }
    const spans = graphemeSpans(tip);
    const part = t.state.hidden[0]!;
    for (let i = 0; i < t.state.length; i++) {
      // Hidden graphemes start in their ellipsis, and a space has no ink to place.
      if ((i >= part.start && i < part.end) || t.graphemes[i] === ' ') continue;
      const r = spans[i]!.getBoundingClientRect();
      const original = graphemeRect(t, i)!;
      expectNear(r.left, original.left, `grapheme ${i} '${t.graphemes[i]}'`);
      expectNear(r.top, original.top, `grapheme ${i} '${t.graphemes[i]}'`);
    }
  });

  it('grows from the line and lands as the full text', async () => {
    const { t, tip } = growing();
    expect(tip.element.querySelector('[data-fp-mark]')).not.toBeNull();
    finish(tip);
    // It lands, back in the flow, when the animation reports it finished.
    await frames();
    expect(tipText(tip)).toBe(PROSE);
    expectOnLine(tip, t);
  });

  it('grows the room first, then shows the hidden text where it lands', () => {
    const { t, tip } = growing();
    const part = t.state.hidden[0]!;
    const hidden = graphemeSpans(tip)[part.start]!.parentElement!;
    const opacity = (k: number) => {
      for (const a of tip.element.getAnimations({ subtree: true })) {
        a.pause();
        a.currentTime = k * 460;
      }
      return Number(getComputedStyle(hidden).opacity);
    };
    expect(opacity(0)).toBe(0);
    expect(opacity(0.4)).toBe(0);
    expect(opacity(0.9)).toBeGreaterThan(0.5);
  });

  it('stays in the window, and wraps long text no narrower than its aspect', () => {
    const long = Array.from({ length: 6 }, () => PATH).join('');
    const t = make(box(long, 'width:300px;margin-left:600px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'expand', breaks: '/' });
    tip.attach(t);
    tip.show(t);
    expectInWindow(tip);
    const r = tip.element.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    expect(r.height).toBeGreaterThan(30);
    expect(r.width).toBeLessThanOrEqual(view * 0.5 + 0.5);
    expect(r.width / r.height).toBeGreaterThanOrEqual(2 - 0.05);
  });

  it('moves up rather than run off the bottom', () => {
    spacer(innerHeight - 60);
    const t = make(box(Array.from({ length: 4 }, () => PROSE).join(' '), 'width:300px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'expand' });
    tip.attach(t);
    tip.show(t);
    expectInWindow(tip);
  });

  it('peeks at what one ellipsis hides, above it, pointing at it', () => {
    spacer(120);
    const t = make(box(PATH, 'width:220px;margin-left:200px'), { position: [0.33, 0.67] });
    const tip = make_tip({ reveal: 'peek' });
    tip.attach(t);
    for (const j of [0, 1]) {
      expect(tip.show(t, j)).toBe(true);
      expect(tip.element.textContent).toBe(t.state.hidden[j]!.text);
      expect(tip.element.dataset.side).toBe('top');
      const ink = ellipsisInk(t, j)!;
      const r = tip.element.getBoundingClientRect();
      expect(r.bottom).toBeCloseTo(ink.top - 8, 0);
      const anchor = parseFloat(tip.element.style.getPropertyValue('--fp-tip-anchor'));
      expect(r.left + anchor).toBeCloseTo(center(ink)[0], 0);
      expect(t.ellipses[j]!.hasAttribute('data-fp-tip-open')).toBe(true);
    }
  });

  it('shows images and icons in the text as themselves', () => {
    spacer(120);
    const el = box('', 'width:160px;margin-left:200px');
    el.innerHTML = 'Report for <img alt="Q3" width="20" height="12" class="chart"> the analytical engine, final draft';
    const t = make(el, { position: 'middle' });
    expect(t.state.hidden[0]!.text).toContain('Q3');
    for (const reveal of ['peek', 'expand'] as const) {
      const tip = make_tip({ reveal });
      tip.attach(t);
      expect(tip.show(t, 0)).toBe(true);
      expect(tip.element.querySelectorAll('img.chart')).toHaveLength(1);
      expect(tip.element.textContent).not.toContain('Q3');
      tip.hide();
    }
  });

  it('peeks below an ellipsis with no room above it', () => {
    const t = make(box(PATH, 'width:220px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'peek' });
    tip.attach(t);
    tip.show(t);
    expect(tip.element.dataset.side).toBe('bottom');
    expect(tip.element.getBoundingClientRect().top).toBeCloseTo(ellipsisInk(t, 0)!.bottom + 8, 0);
  });

  it('has nothing to show for text that fits', () => {
    const t = make(box('Short'));
    const tip = make_tip({});
    tip.attach(t);
    expect(tip.show(t)).toBe(false);
    expect(tip.element.hidden).toBe(true);
  });

  it('shows on hover after the delay, and closes when the pointer leaves', async () => {
    const t = make(box(PROSE, 'width:260px'), { position: 'middle' });
    const shown: unknown[] = [];
    const hidden: unknown[] = [];
    const tip = make_tip({ reveal: 'expand', delay: 120, onShow: (x) => shown.push(x), onHide: (x) => hidden.push(x) });
    tip.attach(t);
    const r = t.element.getBoundingClientRect();
    await commands.mouse('move', r.left + 20, r.top + r.height / 2);
    await frames(1);
    expect(tip.target).toBeNull();
    await expect.poll(() => tip.target?.instance).toBe(t);
    expect(shown).toHaveLength(1);
    await commands.mouse('move', r.left + 20, r.bottom + 100);
    await expect.poll(() => tip.target).toBeNull();
    expect(hidden).toHaveLength(1);
  });

  it('peeks on hovering an ellipsis, gaps included, and not the text', async () => {
    const t = make(box(PATH, 'width:220px;margin-top:100px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'peek', delay: 0 });
    tip.attach(t);
    const area = ellipsisArea(t, 0)!;
    await commands.mouse('move', area.left + 1, area.top + area.height / 2);
    await expect.poll(() => tip.target?.ellipsis).toBe(0);
    const text = graphemeRect(t, 0)!;
    await commands.mouse('move', ...center(text));
    await expect.poll(() => tip.target).toBeNull();
  });

  it('shows on focus at once, and closes on blur and on Escape', async () => {
    const el = box(PROSE, 'width:260px');
    el.tabIndex = 0;
    const t = make(el, { position: 'middle' });
    const tip = make_tip({ reveal: 'expand', delay: 5000 });
    tip.attach(t);
    el.focus();
    expect(tip.target?.instance).toBe(t);
    el.blur();
    expect(tip.target).toBeNull();
    el.focus();
    expect(tip.target?.instance).toBe(t);
    await userEvent.keyboard('{Escape}');
    expect(tip.target).toBeNull();
  });

  it('closes when the text is laid out again', async () => {
    const t = make(box(PROSE, 'width:260px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'expand' });
    tip.attach(t);
    tip.show(t);
    t.element.style.width = '200px';
    await frames();
    expect(tip.target).toBeNull();
    expect(t.element.hasAttribute('data-fp-tip-open')).toBe(false);
  });

  it('stays open through a pass that leaves the text as it was', async () => {
    const t = make(box(PROSE, 'width:260px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'expand' });
    tip.attach(t);
    tip.show(t);
    // As when a font the text doesn't use finishes loading.
    t.refresh('fonts');
    void t.state;
    await frames();
    expect(tip.target?.instance).toBe(t);
    expect(t.element.hasAttribute('data-fp-tip-open')).toBe(true);
  });

  it('lines up inside a container that holds fixed elements', () => {
    const container = box('', 'position:fixed;inset:0;width:auto;transform:translate(0);pointer-events:none');
    const t = make(box(PROSE, 'width:260px;margin:50px 0 0 70px'), { position: 'middle' });
    const tip = make_tip({ reveal: 'expand', container });
    tip.attach(t);
    tip.show(t);
    expectOnLine(tip, t);
  });

  describe('selecting', () => {
    async function press(x: number, y: number, times = 1) {
      for (let i = 0; i < times; i++) {
        await commands.mouse('down', x, y);
        await commands.mouse('up', x, y);
      }
    }

    /** A full-text tip for PATH, opened by hovering, and the centre of a grapheme of "Projects" in it. */
    async function hovered() {
      const t = make(box(PATH, 'width:220px;margin-left:40px'), { position: 'middle' });
      const tip = make_tip({ reveal: 'expand', delay: 0, breaks: '/' });
      tip.attach(t);
      const line = t.element.getBoundingClientRect();
      await commands.mouse('move', line.left + 5, line.top + line.height / 2);
      await expect.poll(() => tip.target?.instance).toBe(t);
      const at = center(graphemeSpans(tip)[PATH.indexOf('Projects') + 2]!.getBoundingClientRect());
      return { tip, line, at };
    }

    it('holds the tip after a press, until a press elsewhere', async () => {
      const { tip, line, at } = await hovered();
      await press(...at);
      expect(tip.held).toBe(true);
      expect(tip.element.hasAttribute('data-held')).toBe(true);
      await press(line.left + 5, line.bottom + 150);
      expect(tip.target).toBeNull();
    });

    it('selects a run between breaks on two presses, and all of it on three', async () => {
      const { tip, line, at } = await hovered();
      await press(...at, 2);
      expect(getSelection()!.toString()).toBe('Projects');
      await press(...at);
      expect(getSelection()!.toString()).toBe(PATH);
      // It holds a selection: moving away leaves it open.
      await commands.mouse('move', line.left + 5, line.bottom + 150);
      await frames(1);
      expect(tip.target).not.toBeNull();
      // A press elsewhere lets go, dropping the selection.
      await press(line.left + 5, line.bottom + 150);
      expect(tip.target).toBeNull();
      expect(getSelection()!.toString()).toBe('');
    });

    it('drags a selection across the tip', async () => {
      const t = make(box(PROSE, 'width:260px'), { position: 'middle' });
      const tip = make_tip({ reveal: 'expand' });
      tip.attach(t);
      tip.show(t);
      const spans = graphemeSpans(tip);
      const from = spans[4]!.getBoundingClientRect();
      const to = spans[15]!.getBoundingClientRect();
      await commands.mouse('down', from.left + 1, from.top + from.height / 2);
      await commands.mouse('move', to.left + 1, to.top + to.height / 2);
      await commands.mouse('up', to.left + 1, to.top + to.height / 2);
      expect(getSelection()!.toString()).toBe(PROSE.slice(4, 15));
    });

    it('carries a selection in the text over to the tip, all of what an ellipsis hides', () => {
      const t = make(box(PROSE, 'width:260px'), { position: 'middle' });
      const tip = make_tip({ reveal: 'expand' });
      tip.attach(t);
      expect(t.truncated).toBe(true);
      const range = document.createRange();
      range.selectNodeContents(t.element.querySelector('[data-fp-text]')!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      tip.show(t);
      expect(getSelection()!.toString()).toBe(PROSE);
      tip.hide();
      expect(t.element.contains(getSelection()!.anchorNode)).toBe(true);
    });
  });
});
