export interface Person {
  name: string;
  initials: string;
  /** The avatar's hue. */
  hue: number;
}

export interface File {
  path: string;
  owner: Person;
  size: string;
  modified: string;
}

export interface Comment {
  author: Person;
  when: string;
  text: string;
}

const ADA: Person = { name: 'Augusta Ada King, Countess of Lovelace', initials: 'AL', hue: 285 };
const CHARLES: Person = { name: 'Charles Babbage', initials: 'CB', hue: 220 };
const MARY: Person = { name: 'Mary Somerville', initials: 'MS', hue: 160 };
const GRACE: Person = { name: 'Grace Hopper', initials: 'GH', hue: 40 };

export const PATH = '/Users/ada/Projects/difference-engine/notes/2026/difference-tables.md';
export const SHORT = '/notes/todo.md';
export const LINK = 'https://files.difference-engine.dev/s/7f3a9c2e/notes/2026/difference-tables.md?view=preview';
export const SHORT_LINK = 'ae.dev/s/7f3a';

export const FILES: File[] = [
  { path: PATH, owner: ADA, size: '12 KB', modified: '2 min ago' },
  {
    path: '/Users/charles/Projects/difference-engine/drawings/mill/plates/plate-07-anticipating-carriage.svg',
    owner: CHARLES,
    size: '1.4 MB',
    modified: '1 hour ago',
  },
  {
    path: '/Users/mary/Archive/translations/menabrea-sketch-translation-annotated.pdf',
    owner: MARY,
    size: '880 KB',
    modified: 'Yesterday',
  },
  {
    path: '/Users/grace/Projects/compilers/a-0/subroutines/library/tape-04-floating-point-routines.txt',
    owner: GRACE,
    size: '46 KB',
    modified: 'Monday',
  },
  {
    path: '/Users/ada/Projects/difference-engine/notes/note-g/bernoulli-numbers-program.ipynb',
    owner: ADA,
    size: '220 KB',
    modified: 'Oct 12',
  },
  { path: SHORT, owner: ADA, size: '1 KB', modified: 'Oct 9' },
];

export const COMMENTS: Comment[] = [
  {
    author: CHARLES,
    when: '1h',
    text: 'Plate 07 is redrawn: the anticipating carriage now carries every column in one step, so the mill never waits on the slowest digit. Have a look before Thursday.',
  },
  {
    author: MARY,
    when: '3h',
    text: "Menabrea's sketch is annotated beside the translation. The notes run three times longer than the original, which I suspect is the point.",
  },
  {
    author: GRACE,
    when: '1d',
    text: 'Tape 04 assembles cleanly now. Found the fault in the floating-point routine; it was, as ever, a moth.',
  },
];

export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
