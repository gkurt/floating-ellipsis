import { ArrowUpRight, Layers, MousePointer2, MoveHorizontal, ScanEye, ServerCog, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { AppWindow } from '@/components/app-window';
import { Workspace } from '@/components/workspace';
import type { File } from '@/lib/files';
import { cn } from '@/lib/utils';

const FEATURES = [
  {
    icon: MousePointer2,
    title: 'Grows in place',
    text: 'Rest on a row: its path grows back over the line, every letter moving from where it was.',
  },
  {
    icon: ScanEye,
    title: 'Peeks at what’s hidden',
    text: 'Rest on the dots in the folder path above the files, and see only the folders they stand for.',
  },
  {
    icon: ServerCog,
    title: 'Cut before it hydrates',
    text: 'The server sends the whole text. fallback.css cuts it at the end until React takes over.',
  },
  {
    icon: Layers,
    title: 'Radix and Base UI',
    text: 'In the details panel, shadcn’s own tooltips open only while a value is cut.',
  },
];

const PAGES = [
  { href: '/', label: 'Prerendered', mode: 'static' },
  { href: '/ssr', label: 'Rendered per request', mode: 'dynamic' },
] as const;

/** The page both routes render: what this is, the app in its window, and what to try. */
export function Showcase({ mode, files }: { mode: 'static' | 'dynamic'; files: File[] }) {
  return (
    <div className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(50%_60%_at_50%_0%,color-mix(in_oklab,var(--brand)_24%,transparent),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] mask-[radial-gradient(60%_70%_at_50%_0%,black,transparent)] bg-size-[56px_56px]"
      />

      <header className="mx-auto max-w-3xl px-6 pt-16 pb-12 text-center sm:pt-24">
        <p className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium shadow-xs backdrop-blur">
          <Sparkles className="size-3.5 text-brand" />
          floating-ellipsis <span className="text-muted-foreground">×</span> shadcn/ui
        </p>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Long names, <span className="bg-linear-to-r from-brand to-[oklch(0.62_0.2_330)] bg-clip-text text-transparent">kept whole.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-balance text-muted-foreground sm:text-lg">
          A file browser built from shadcn/ui. Paths are cut in the middle, at slashes, and keep their file names. Rest on one and it grows
          back, right where it is.
        </p>
        <nav className="mt-8 inline-flex rounded-lg border bg-background/70 p-1 text-xs shadow-xs backdrop-blur" aria-label="Rendering">
          {PAGES.map((page) => (
            <Link
              key={page.mode}
              href={page.href}
              aria-current={page.mode === mode ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
                page.mode === mode && 'bg-primary text-primary-foreground hover:text-primary-foreground',
              )}
            >
              {page.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-[80rem] px-4 sm:px-8">
        <AppWindow title="Files — The Analytical Engine Society">
          <Workspace files={files} />
        </AppWindow>
        <p className="mt-4 hidden items-center justify-center gap-2 text-xs text-muted-foreground sm:flex">
          <MoveHorizontal className="size-3.5" />
          Drag either edge of the window. Double-click one to reset it.
        </p>
      </div>

      <section className="mx-auto grid max-w-[80rem] gap-4 px-4 py-20 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="space-y-3 rounded-xl border bg-background/60 p-5 shadow-xs backdrop-blur">
            <span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/20">
              <Icon className="size-4" />
            </span>
            <h2 className="font-medium">{title}</h2>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        Next.js, shadcn/ui and{' '}
        <a
          href="https://gkurt.com/floating-ellipsis/"
          className="inline-flex items-center gap-0.5 font-medium text-foreground hover:underline"
        >
          floating-ellipsis
          <ArrowUpRight className="size-3" />
        </a>
      </footer>
    </div>
  );
}
