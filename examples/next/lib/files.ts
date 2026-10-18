import type { File } from '@/components/files-table';

export const PATH = '/Users/ada/Projects/analytical-engine/notes/2026/difference-tables.md';
export const SHORT = '/notes/todo.md';

export const FILES: File[] = [
  { path: PATH, owner: 'Ada Lovelace', size: '12 KB' },
  {
    path: '/Users/charles/Projects/analytical-engine/drawings/mill/plates/plate-07-anticipating-carriage.svg',
    owner: 'Charles Babbage',
    size: '1.4 MB',
  },
  {
    path: '/Users/mary/Archive/translations/menabrea-sketch-of-the-analytical-engine-annotated.pdf',
    owner: 'Mary Somerville',
    size: '880 KB',
  },
  { path: SHORT, owner: 'Ada', size: '1 KB' },
];
