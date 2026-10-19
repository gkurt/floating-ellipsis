import { describe, expect, it } from 'bun:test';
import type { Snap } from '#src/cut.ts';
import { graphemes } from '#src/graphemes.ts';
import { list, split } from '#src/list.ts';

const en = new Intl.ListFormat('en', { type: 'conjunction' });

/** Where `snap` moves a cut of `text` from grapheme `start` to the end. */
function cutAt(snap: Snap, text: string, start: number): [number, number] {
  const g = graphemes(text);
  const { start: s, end } = snap({ graphemes: g, start, end: g.length, position: 1, min: 0, max: g.length });
  return [s, end];
}

describe('split', () => {
  it('splits at a string, all of it, leaving out white space and empty items', () => {
    expect(split(', ')('Ada, Grace, Linus')).toEqual(['Ada', 'Grace', 'Linus']);
    expect(split(',')(' Ada ,Grace,, Linus ')).toEqual(['Ada', 'Grace', 'Linus']);
    expect(split(', ')('Ada Lovelace')).toEqual(['Ada Lovelace']);
    expect(split('')('Ada')).toEqual(['Ada']);
  });

  it('splits at every match of a RegExp, groups or not', () => {
    expect(split(/, | and /)('Ada, Grace and Linus')).toEqual(['Ada', 'Grace', 'Linus']);
    expect(split(/(,) /)('Ada, Grace')).toEqual(['Ada', 'Grace']);
    expect(split(/;\s*/g)('a;b; c')).toEqual(['a', 'b', 'c']);
  });
});

describe('list', () => {
  it('joins an array into the text, and sets the options a list needs', () => {
    const options = list(['Ada', 'Grace', 'Linus'], { format: en });
    expect(options.text).toBe('Ada, Grace, and Linus');
    expect(options).toMatchObject({ position: 'end', ellipsis: '', gap: 'none', justify: false, repeat: false, find: 'expand' });
    expect(options.suffix?.show).toBe('truncated');
    expect(options.snap).toBeFunction();
  });

  it('leaves the text to the element with a function', () => {
    expect('text' in list(split(', '))).toBe(false);
  });

  it('cuts whole items from the end', () => {
    const { text, snap } = list(['Ada', 'Grace', 'Linus'], { format: en });
    if (typeof text !== 'string') throw new Error('no text');
    // 'Ada, Grace, and Linus': Ada ends at 3, Grace at 10.
    expect(cutAt(snap!, text, 12)).toEqual([10, 21]);
    expect(cutAt(snap!, text, 10)).toEqual([10, 21]);
    expect(cutAt(snap!, text, 9)).toEqual([3, 21]);
    expect(cutAt(snap!, text, 4)).toEqual([3, 21]);
  });

  it('cuts inside the first item when it does not fit whole', () => {
    const { snap } = list(split(', '));
    expect(cutAt(snap!, 'Ada Lovelace, Grace', 5)).toEqual([5, 19]);
    // Fewer than three of its graphemes aren't worth showing.
    expect(cutAt(snap!, 'Ada Lovelace, Grace', 3)).toEqual([3, 19]);
    expect(cutAt(snap!, 'Ada Lovelace, Grace', 2)).toEqual([0, 19]);
    expect(cutAt(snap!, 'Ada Lovelace, Grace', 0)).toEqual([0, 19]);
  });

  it('finds items as graphemes, emoji and all', () => {
    const { snap } = list(split(', '));
    // '👩🏽‍💻 Ada' is two graphemes and four characters long.
    expect(cutAt(snap!, '👩🏽‍💻 Ada, Grace', 7)).toEqual([5, 12]);
  });

  it('leaves a cut that is not at the end as it is', () => {
    const { snap } = list(split(', '));
    const g = graphemes('Ada, Grace, Linus');
    expect(snap!({ graphemes: g, start: 2, end: 8, position: 0.5, min: 0, max: g.length })).toEqual({ start: 2, end: 8 });
  });

  it('says which item a function found that is not in the text', () => {
    const { snap } = list(() => ['Ada', 'Charles']);
    expect(() => cutAt(snap!, 'Ada, Grace', 4)).toThrow('"Charles"');
  });
});
