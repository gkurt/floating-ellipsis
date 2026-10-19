// A consumer in the browser, bundled by Vite: the core, the custom element,
// the React binding, the tooltip and fallback.css, as an app imports them.

import { elide } from 'floating-ellipsis';
import { define } from 'floating-ellipsis/element';
import { Elided } from 'floating-ellipsis/react';
import 'floating-ellipsis/fallback.css';
import { tooltip } from 'floating-ellipsis/tooltip';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

const PATH = '/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md';
const tip = tooltip();

tip.attach(elide(document.querySelector<HTMLElement>('#core')!, { position: 'middle', keep: /\.md$/ }));
define();
createRoot(document.querySelector('#react')!).render(createElement(Elided, { text: PATH, position: 'end' }));
