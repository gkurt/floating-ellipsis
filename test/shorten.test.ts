import { describe, expect, it } from 'bun:test';
import { dateForms } from '#src/dates.ts';
import { graphemes } from '#src/graphemes.ts';
import { formsOf, shortAt, shownText, stepsOf, totals } from '#src/shorten.ts';
import { elideText } from '#src/text.ts';

const TEXT = 'Lunch with Christopher Robin on Wednesday, 14 October';
const g = graphemes(TEXT);
const offsets = [0];
for (const s of g) offsets.push(offsets.at(-1)! + s.length);

/** Every grapheme 10 wide, like a monospace font. */
const mono = (text: string) => graphemes(text).length * 10;

describe('formsOf', () => {
  it('finds parts as keep does, in the order given', () => {
    const forms = formsOf(TEXT, offsets, [
      { match: 'Wednesday', to: 'Wed' },
      { match: /\bO\w+/, to: ['Oct', '10'] },
      { start: 11, end: 28, to: 'C. Robin' },
    ]);
    expect(forms).toEqual([
      { start: 32, end: 41, to: ['Wed'] },
      { start: 46, end: 53, to: ['Oct', '10'] },
      { start: 11, end: 28, to: ['C. Robin'] },
    ]);
  });

  it('leaves out a part that overlaps one found before it, and one with no forms', () => {
    const forms = formsOf(TEXT, offsets, [
      { match: 'Christopher Robin', to: 'C. Robin' },
      { match: 'Robin', to: 'R.' },
      { match: 'Lunch', to: [] },
    ]);
    expect(forms).toEqual([{ start: 11, end: 28, to: ['C. Robin'] }]);
  });

  it('finds every match of a global RegExp', () => {
    expect(formsOf('Mon, Tue', [0, 1, 2, 3, 4, 5, 6, 7, 8], [{ match: /\w+/g, to: '·' }]).map((f) => f.start)).toEqual([0, 5]);
  });
});

describe('stepsOf', () => {
  const forms = formsOf(TEXT, offsets, [
    { match: 'Christopher Robin', to: ['C. Robin', 'C. R.'] },
    { match: 'Wednesday', to: ['Wed', 'W'] },
    { match: 'October', to: 'Oct' },
  ]);

  it('takes every first form before any second, the last given first', () => {
    expect(stepsOf(forms)).toEqual([2, 1, 0, 1, 0]);
  });

  it('skips forms that stay long', () => {
    expect(stepsOf(forms, (f) => f.start === 32)).toEqual([2, 0, 0]);
  });

  it('shows the forms of the steps taken, in order through the text', () => {
    const steps = stepsOf(forms);
    expect(shortAt(TEXT, offsets, forms, steps, 0)).toEqual([]);
    expect(shortAt(TEXT, offsets, forms, steps, 2).map((p) => p.form)).toEqual(['Wed', 'Oct']);
    expect(shortAt(TEXT, offsets, forms, steps, 4).map((p) => [p.text, p.form])).toEqual([
      ['Christopher Robin', 'C. Robin'],
      ['Wednesday', 'W'],
      ['October', 'Oct'],
    ]);
    const short = shortAt(TEXT, offsets, forms, steps, steps.length);
    expect(shownText(g, short, 0, g.length)).toBe('Lunch with C. R. on W, 14 Oct');
    expect(shownText(g, short, 6, 35)).toBe('with C. R. on W');
  });

  it('sums a short form on its first grapheme', () => {
    const short = shortAt(TEXT, offsets, forms, stepsOf(forms), 1);
    const sums = totals(
      g.length,
      () => 10,
      short,
      (p) => mono(p.form),
    );
    expect(sums[g.length]).toBe(mono('Lunch with Christopher Robin on Wednesday, 14 Oct'));
    expect(sums[47]! - sums[46]!).toBe(30);
    expect(sums[53]! - sums[47]!).toBe(0);
  });
});

describe('dateForms', () => {
  const date = new Date(Date.UTC(2026, 9, 14, 15, 30));

  it('writes a date from long to short, as the locale does', () => {
    expect(dateForms(date, { locale: 'en-US', timeZone: 'UTC' })).toEqual({
      text: 'Wednesday, October 14, 2026',
      shorten: { match: 'Wednesday, October 14, 2026', to: ['Wed, October 14, 2026', 'Wed, Oct 14, 2026', 'Oct 14, 2026', '10/14/26'] },
    });
    const { text, shorten } = dateForms(date, { locale: 'de-DE', timeZone: 'UTC' });
    expect(text).toBe('Mittwoch, 14. Oktober 2026');
    expect(shorten).toMatchObject({ to: expect.arrayContaining(['14.10.26']) });
  });

  it('leaves out the year or the weekday, and adds the time', () => {
    const forms = (o: object) => {
      const { text, shorten } = dateForms(date, { locale: 'en-US', timeZone: 'UTC', ...o });
      return [text, ...shorten.to];
    };
    expect(forms({ year: false })).toEqual(['Wednesday, October 14', 'Wed, October 14', 'Wed, Oct 14', 'Oct 14', '10/14']);
    expect(forms({ weekday: false })[0]).toBe('October 14, 2026');
    expect(forms({ time: true }).at(-1)).toMatch(/^10\/14\/26, 3:30\sPM$/);
  });

  it('only gets shorter', () => {
    for (const locale of ['en-US', 'en-GB', 'fr-FR', 'ja-JP', 'ar-EG', 'tr-TR']) {
      const { text, shorten } = dateForms(date, { locale });
      const all = [text, ...shorten.to];
      all.slice(1).forEach((form, i) => expect(form.length).toBeLessThan(all[i]!.length));
    }
  });
});

describe('elideText, shortened', () => {
  const shorten = [
    { match: 'Christopher Robin', to: ['C. Robin', 'C. R.'] },
    { match: 'Wednesday', to: ['Wed', 'W'] },
    { match: 'October', to: 'Oct' },
  ];

  it('takes the fewest steps that fit before cutting', () => {
    expect(elideText(TEXT, { width: 530, measure: mono, shorten })).toMatchObject({ text: TEXT, truncated: false, short: [] });
    expect(elideText(TEXT, { width: 490, measure: mono, shorten })).toMatchObject({
      text: 'Lunch with Christopher Robin on Wednesday, 14 Oct',
      truncated: false,
      short: [{ start: 46, end: 53, text: 'October', form: 'Oct' }],
    });
    const r = elideText(TEXT, { width: 290, measure: mono, shorten });
    expect(r.text).toBe('Lunch with C. R. on W, 14 Oct');
    expect(r.truncated).toBe(false);
    expect(r.short.map((p) => p.form)).toEqual(['C. R.', 'W', 'Oct']);
  });

  it('cuts with every part at its shortest, never inside one', () => {
    for (let width = 30; width < 290; width += 10) {
      const r = elideText(TEXT, { width, measure: mono, shorten, position: 'middle' });
      expect(r.truncated).toBe(true);
      expect(r.width).toBeLessThanOrEqual(width);
      for (const p of r.short) for (const h of r.hidden) expect(h.end <= p.start || h.start >= p.end).toBe(true);
      expect(r.text).not.toMatch(/Christopher|Wednesday|October/);
    }
  });
});
