import { type Elide, type Keep, elide, separators } from '#src/index.ts';
import { tooltip } from '#src/tooltip.ts';
import { $, resizable, segmented } from './ui.ts';

// ---------------------------------------------------------------------------
// Timing. ResizeObservers are called in the order they were created, all in
// the same frame: one created before any instance runs just before the
// library's (created with the first instance), and one created after it runs
// just after. Between the two is the time spent truncating. Both watch the
// column headers, which change size with any resize.

let resizeStart = 0;
// (A header's first report is only its initial size.)
const seen = new WeakSet<Element>();
const before = new ResizeObserver((entries) => {
  if (entries.some((e) => seen.has(e.target))) resizeStart = performance.now();
  for (const e of entries) seen.add(e.target);
});
let after: ResizeObserver | null = null;

// ---------------------------------------------------------------------------
// Data: seeded, so every visit shows the same table.

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const words = (s: string) => s.split(' ');
const NAMES = words(
  'quarterly revenue forecast draft final review notes meeting design spec roadmap budget invoice contract summary report backup export migration onboarding interview retro launch pricing analytics dashboard survey proposal brief checklist',
);
const EXTENSIONS = words('pdf docx xlsx png md ts json csv fig mov zip sql');
const FOLDERS = words(
  'src components docs assets archive 2026 q3 reports shared team design legacy old tmp exports marketing finance engineering platform web mobile vendor fixtures snapshots screenshots',
);
const VERBS = [
  'Fix',
  'Add',
  'Remove',
  'Refactor',
  'Rename',
  'Speed up',
  'Document',
  'Revert',
  'Simplify',
  'Handle',
  'Guard against',
  'Cache',
];
const OBJECTS = [
  'upload retry',
  'the date picker',
  'table virtualization',
  'font loading',
  'the export queue',
  'pagination',
  'dark mode tokens',
  'the search index',
  'session refresh',
  'image thumbnails',
  'the billing webhook',
  'keyboard shortcuts',
];
const TAILS = [
  'when the network drops mid-chunk',
  'for right-to-left locales',
  'behind a feature flag',
  'on slow devices',
  'after the schema migration',
  'so the tests stop flaking',
  'in the settings panel',
  'for very long file names',
  'without blocking the main thread',
  'and add regression tests',
  '(follow-up to the last release)',
  '',
];

/** A row's cells: four truncated, then the size. */
type Row = [file: string, folder: string, message: string, hash: string, size: string];

function makeRows(count: number): Row[] {
  const r = random(42);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const many = <T>(list: readonly T[], min: number, max: number) =>
    Array.from({ length: min + Math.floor(r() * (max - min + 1)) }, () => pick(list));
  return Array.from({ length: count }, (): Row => {
    const bytes = Math.floor(2 ** (8 + r() * 22));
    return [
      `${many(NAMES, 2, 6).join('-')}.${pick(EXTENSIONS)}`,
      `/${many(FOLDERS, 3, 9).join('/')}/`,
      `${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}`.trim(),
      Array.from({ length: 40 }, () => Math.floor(r() * 16).toString(16)).join(''),
      bytes < 1 << 20 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1 << 20)).toFixed(1)} MB`,
    ];
  });
}

// ---------------------------------------------------------------------------
// The table: a <table>, or rows of CSS grid that `content-visibility: auto`
// lets the browser skip while they are off screen. Same cells either way.

const COLUMNS = ['File', 'Folder', 'Last commit', 'Hash', 'Size'];
const CELL_CLASS = ['cell', 'cell mono', 'cell', 'cell mono'];
/** Column widths in % of the table. */
const widths = [20, 25, 31, 13, 11];

const host = $('#grid');
const bySlash = separators('/');
let markup: 'table' | 'grid' = 'grid';
let count = 1000;
let lines = 1;
let instances: Elide[] = [];
let messages: Elide[] = [];
/** Each truncated cell: its instance, its text, what it always keeps, and its row. */
let cells: { instance: Elide; text: string; keep: Keep[]; row: Element }[] = [];
let headers: HTMLElement[] = [];
let built = 0;
let lastResize: { ms: number; passes: number } | null = null;
let passes = 0;
// The playground's tip grown from the line, on every cut-off cell, in the
// cell's own font. After the first one's delay, the next cell's shows at
// once; press on one to select its text.
const tips = tooltip({ delay: 400 });

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const handle = '<span class="col-handle" aria-hidden="true"></span>';

function render(rows: Row[]) {
  const table = markup === 'table';
  const [cell, head] = table ? ['td', 'th'] : ['div', 'div'];
  const [cellRole, headRole] = table ? ['', ''] : [' role="cell"', ' role="columnheader"'];
  const cells = (row: Row) =>
    row
      .map((text, i) =>
        i < 4
          ? `<${cell}${cellRole} class="c"><div class="${CELL_CLASS[i]}">${escape(text)}</div></${cell}>`
          : `<${cell}${cellRole} class="c num">${text}</${cell}>`,
      )
      .join('');
  const heads = COLUMNS.map(
    (name, i) => `<${head}${headRole} class="h${i === 4 ? ' num' : ''}">${name}${i < 4 ? handle : ''}</${head}>`,
  ).join('');
  host.innerHTML = table
    ? `<table class="grid"><colgroup>${widths.map(() => '<col />').join('')}</colgroup>` +
      `<thead><tr>${heads}</tr></thead><tbody>${rows.map((row) => `<tr>${cells(row)}</tr>`).join('')}</tbody></table>`
    : `<div class="grid rows" role="table" aria-label="Files"><div class="row head" role="row">${heads}</div>` +
      `<div role="rowgroup">${rows.map((row) => `<div class="row" role="row">${cells(row)}</div>`).join('')}</div></div>`;
  headers = [...host.querySelectorAll<HTMLElement>('.h')];
  setWidths();
}

function setWidths() {
  host.style.setProperty('--cols', widths.map((w) => `${w}%`).join(' '));
  host.querySelectorAll('col').forEach((col, i) => (col.style.width = `${widths[i]}%`));
}

function build() {
  for (const instance of instances) instance.destroy();
  const rows = makeRows(count);
  render(rows);
  const start = performance.now();
  tips.hide();
  instances = [];
  messages = [];
  cells = [];
  [...host.querySelectorAll('tbody tr, [role="rowgroup"] > .row')].forEach((row, r) => {
    const [file, folder, message, hash] = [...row.querySelectorAll<HTMLElement>('.cell')];
    const m = elide(message!, { lines });
    messages.push(m);
    const extension = [/\.[^.]+$/];
    const made: [Elide, Keep[]][] = [
      [elide(file!, { position: 0.5, keep: extension }), extension],
      [elide(folder!, { position: 0.5, snap: bySlash }), []],
      [m, []],
      [elide(hash!, { position: 0.5 }), []],
    ];
    made.forEach(([instance, keep], i) => {
      tips.attach(instance);
      instances.push(instance);
      cells.push({ instance, text: rows[r]![i]!, keep, row });
    });
  });
  query = '';
  search();
  for (const instance of instances) instance.onRender(() => passes++);

  // Reading an instance runs the passes waiting for it: here, every row
  // near the screen. The rest wait until they come near.
  void instances[0]?.truncated;
  built = performance.now() - start;
  passes = 0;

  after ??= new ResizeObserver(() => {
    if (resizeStart === 0) return;
    lastResize = { ms: performance.now() - resizeStart, passes };
    resizeStart = 0;
    passes = 0;
    showStats();
  });
  for (const h of headers) {
    before.observe(h);
    after.observe(h);
  }
  lastResize = null;
  showStats(true);
}

// ---------------------------------------------------------------------------
// Stats

const stats = $('#stats');
let frames: number[] = [];
let shown = 0;

function showStats(now = false) {
  const t = performance.now();
  if (!now && t - shown < 150) return;
  shown = t;
  const fps = frames.length > 1 ? (1000 * (frames.length - 1)) / (frames[frames.length - 1]! - frames[0]!) : null;
  const n = (v: number) => v.toLocaleString('en-US');
  const rows: [string, string][] = [
    ['truncated cells', n(instances.length)],
    ['first truncation', `${built.toFixed(0)} ms`],
    ['last resize', lastResize ? `${lastResize.ms.toFixed(1)} ms` : '–'],
    ['cells it truncated', lastResize ? n(lastResize.passes) : '–'],
    ['frame rate', fps !== null ? `${fps.toFixed(0)} fps` : '–'],
  ];
  stats.replaceChildren(
    ...rows.map(([k, v]) => {
      const div = document.createElement('div');
      div.innerHTML = '<dt></dt><dd></dd>';
      div.firstElementChild!.textContent = k;
      div.lastElementChild!.textContent = v;
      return div;
    }),
  );
}

// Frame rate over the last second, while something moves.
const box = $('#tableBox');
const sweep = $<HTMLInputElement>('#sweep');
let phase = 0;
let dragging = false;
let frame = 0;
function tick(now: number) {
  frame = 0;
  frames.push(now);
  while (frames.length > 0 && now - frames[0]! > 1000) frames.shift();
  if (sweep.checked) {
    phase += 1 / 240;
    const t = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    box.style.width = `${box.parentElement!.clientWidth * (0.55 + 0.45 * t)}px`;
  }
  showStats();
  if (sweep.checked || dragging) frame = requestAnimationFrame(tick);
  else frames = [];
}
const animate = () => (frame ||= requestAnimationFrame(tick));
const startDrag = () => {
  tips.hide();
  dragging = true;
  animate();
  addEventListener('pointerup', () => (dragging = false), { once: true });
};

// ---------------------------------------------------------------------------
// Search: matches stay visible and are highlighted (a class on `keep`), and
// rows without one fade. Only cells whose matches change are updated.

const searchBox = $<HTMLInputElement>('#search');
let query = '';

function search() {
  const previous = query;
  query = searchBox.value.trim();
  const escaped = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = query ? new RegExp(escaped(query), 'giu') : null;
  const lower = query.toLocaleLowerCase();
  const was = previous.toLocaleLowerCase();
  const hits = new Set<Element>();
  for (const { instance, text, keep, row } of cells) {
    const folded = text.toLocaleLowerCase();
    const hit = lower !== '' && folded.includes(lower);
    if (hit) hits.add(row);
    if (!hit && !(was !== '' && folded.includes(was))) continue;
    instance.update({ keep: hit && pattern ? [{ match: pattern, class: 'hit' }, ...keep] : keep });
  }
  host.classList.toggle('searching', query !== '');
  for (const row of new Set(cells.map((c) => c.row))) row.classList.toggle('miss', !hits.has(row));
}

let typing = 0;
searchBox.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(search, 120);
});

// ---------------------------------------------------------------------------
// Controls

sweep.addEventListener('change', animate);
resizable(box, () => {
  sweep.checked = false;
  startDrag();
});
segmented('rows', (v) => {
  count = Number(v);
  build();
});
segmented('markup', (v) => {
  markup = v === 'grid' ? 'grid' : 'table';
  build();
});
segmented('lines', (v) => {
  lines = Number(v);
  for (const m of messages) m.update({ lines });
});

// Drag a column's right edge: it and the next column trade width.
host.addEventListener('pointerdown', (e) => {
  const grip = e.target instanceof Element ? e.target.closest<HTMLElement>('.col-handle') : null;
  if (!grip) return;
  const i = headers.findIndex((h) => h.contains(grip));
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  sweep.checked = false;
  startDrag();
  grip.classList.add('dragging');
  const total = host.getBoundingClientRect().width;
  const pair = widths[i]! + widths[i + 1]!;
  const first = widths[i]!;
  const startX = e.clientX;
  const min = (48 / total) * 100;
  const move = (ev: PointerEvent) => {
    widths[i] = Math.max(min, Math.min(pair - min, first + ((ev.clientX - startX) / total) * 100));
    widths[i + 1] = pair - widths[i];
    setWidths();
  };
  const up = () => {
    grip.classList.remove('dragging');
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});

build();
