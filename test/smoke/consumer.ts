// A typed consumer: `tsc` checks it against the published .d.ts files, as
// Node resolves them (tsconfig.json) and as a bundler does (tsconfig.bundler.json).

import { type Elide, type ElideOptions, type ElideState, elide, separators, words } from 'floating-ellipsis';
import { autoSize } from 'floating-ellipsis/autosize';
import { type ElideChange, onChange } from 'floating-ellipsis/changes';
import { dateForms } from 'floating-ellipsis/dates';
import { define } from 'floating-ellipsis/element';
import { ellipsisRect, graphemeRect } from 'floating-ellipsis/geometry';
import { glyph, glyphs } from 'floating-ellipsis/glyphs';
import { type ElidedInput, elideInput } from 'floating-ellipsis/input';
import { list, split } from 'floating-ellipsis/list';
import { Elided, useElide } from 'floating-ellipsis/react';
import { suffix } from 'floating-ellipsis/suffix';
import { elide as elideAction } from 'floating-ellipsis/svelte';
import { type ElideTextResult, elideText } from 'floating-ellipsis/text';
import { type Tooltip, tooltip } from 'floating-ellipsis/tooltip';
import { transitions } from 'floating-ellipsis/transitions';
import { vElide } from 'floating-ellipsis/vue';
import { createElement, type ReactElement } from 'react';

const el = document.createElement('div');
const options: ElideOptions = { position: 'middle', keep: /\.[^.]+$/, snap: separators('/'), lines: 2, autoSize: autoSize() };
const t: Elide = elide(el, options);
const state: ElideState = t.state;
const shown: number = state.length;
t.update({ position: ['30%', '70%'], snap: words(), suffix: suffix('Read more', { show: 'truncated' }), glyphs });

const stop: () => void = onChange(t, (change: ElideChange) => void change);
const rect: DOMRect | null = ellipsisRect(t) ?? graphemeRect(t, 0);
const span: HTMLSpanElement | null = glyph(t, 0);
const field: ElidedInput = elideInput(document.createElement('input'), { position: 'middle' });
const people: ElideOptions = { ...list(['Ada', 'Grace', 'Linus']), lines: 1 };
const mentions: ElideOptions = list(split(', '));
const when: ElideOptions = { ...dateForms(new Date(), { locale: 'en-GB' }) };
const tip: Tooltip = tooltip({ reveal: 'grow', breaks: '/' });
tip.attach(t);
const untransition: () => void = transitions(t, { effect: 'fade' });
const cut: ElideTextResult = elideText('/Users/ada/notes.md', { width: 120, font: '13px sans-serif', position: 'middle' });
define('my-elide');

function Row({ path }: { path: string }): ReactElement {
  const [ref] = useElide<HTMLSpanElement>({ text: path, position: 'middle' });
  return createElement(
    'span',
    { ref },
    createElement(Elided, { text: path, as: 'code', keep: /\.md$/, instanceRef: (i: Elide) => tip.attach(i) }),
  );
}

const action = elideAction(el, { position: 'end' });
action.update({ lines: 3 });

export { Row, action, cut, field, mentions, people, rect, shown, span, stop, untransition, vElide, when };
