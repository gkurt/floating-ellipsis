import { Elided } from 'floating-ellipsis/react';
import { ChevronsUpDown, Clock, FolderOpen, House, MessageSquare, Plus, Search, Share2, Star, Trash2, Upload, Users } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { BasePathTooltip } from '@/components/base-path-tooltip';
import { FileButton } from '@/components/file-button';
import { FileIcon, FileTile } from '@/components/file-icon';
import { FilesTable } from '@/components/files-table';
import { PathTooltip } from '@/components/path-tooltip';
import { Path, Tipped } from '@/components/tipped';
import { Button } from '@/components/ui/button';
import { COMMENTS, type File, LINK, SHORT, SHORT_LINK, folderOf, nameOf } from '@/lib/files';
import { cn } from '@/lib/utils';

const NAV = [
  { icon: House, label: 'Home' },
  { icon: Clock, label: 'Recent', current: true },
  { icon: Star, label: 'Starred' },
  { icon: Users, label: 'Shared with me' },
  { icon: Trash2, label: 'Trash' },
];

/**
 * A file browser, as a Server Component throughout: only `Elided` and the
 * components that set function options (`Path`, `Tipped`, the tooltips) are
 * Client Components. `files[0]` is the open file.
 */
export function Workspace({ files }: { files: File[] }) {
  const open = files[0];
  return (
    <div className="flex text-sm">
      <Sidebar files={files} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar path={open.path} />
        <main className="@container/main min-w-0 flex-1 space-y-8 p-5">
          <Pinned files={files.slice(1, 4)} />
          <section className="space-y-2">
            <Heading title="All files" count={files.length} />
            <FilesTable files={files} selected={open.path} />
          </section>
          <div className="grid place-items-center gap-1 rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-muted-foreground">
            <Upload className="size-5" />
            <p>
              Drop files to upload, or <span className="font-medium text-foreground underline underline-offset-4">browse</span>
            </p>
          </div>
        </main>
      </div>
      <Details file={open} />
    </div>
  );
}

function Heading({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {title}
      {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
    </h2>
  );
}

function Sidebar({ files }: { files: File[] }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r bg-muted/40 p-3 @3xl:flex">
      <button type="button" className="flex items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-linear-to-br from-brand to-[oklch(0.55_0.2_320)] text-xs font-bold text-white shadow-sm">
          AE
        </span>
        <span className="min-w-0 flex-1">
          <Elided as="span" text="The Difference Engine Society" className="block font-medium" />
          <span className="block text-xs text-muted-foreground">Team · 4 members</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <nav className="space-y-0.5">
        {NAV.map(({ icon: Icon, label, current }) => (
          <a
            key={label}
            href="#"
            aria-current={current ? 'page' : undefined}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground aria-[current]:bg-accent aria-[current]:font-medium aria-[current]:text-foreground"
          >
            <Icon className="size-4" />
            {label}
          </a>
        ))}
      </nav>
      <section className="space-y-1">
        <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Recent</h2>
        <ul data-testid="recent">
          {files.slice(0, 5).map((file) => (
            <li
              key={file.path}
              data-tip-row
              tabIndex={0}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <FileIcon path={file.path} className="size-3.5" />
              <Path tip="grow" text={file.path} className="min-w-0 flex-1 text-[13px]" />
            </li>
          ))}
        </ul>
      </section>
      <div className="mt-auto space-y-2 rounded-lg border bg-background p-3">
        <div className="flex justify-between text-xs">
          <span className="font-medium">Storage</span>
          <span className="text-muted-foreground tabular-nums">12.4 of 20 GB</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[62%] rounded-full bg-linear-to-r from-brand to-[oklch(0.65_0.18_320)]" />
        </div>
      </div>
    </aside>
  );
}

function Toolbar({ path }: { path: string }) {
  const crumbs = folderOf(path).slice(1).split('/').join(' / ');
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
      <Path tip="peek" text={crumbs} tabIndex={0} className="min-w-0 flex-1 font-medium" data-testid="breadcrumb" />
      <div className="hidden h-8 w-48 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-muted-foreground @2xl:flex">
        <Search className="size-3.5" />
        <span className="flex-1">Search files</span>
        <kbd className="rounded border bg-background px-1 font-sans text-[10px]">⌘K</kbd>
      </div>
      <Button variant="outline" size="sm" className="hidden @lg:inline-flex">
        <Share2 />
        Share
      </Button>
      <Button size="sm">
        <Plus />
        New
      </Button>
    </header>
  );
}

function Pinned({ files }: { files: File[] }) {
  return (
    <section className="space-y-3">
      <Heading title="Pinned" />
      <div className="grid grid-cols-1 gap-3 @md/main:grid-cols-2 @2xl/main:grid-cols-3">
        {files.map((file, i) => (
          <article
            key={file.path}
            data-tip-row
            tabIndex={0}
            className={cn(
              'group rounded-lg border bg-card p-2 shadow-xs transition outline-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50',
              i === 1 && 'hidden @md/main:block',
              i === 2 && 'hidden @2xl/main:block',
            )}
          >
            <FileTile path={file.path} className="h-24 transition-transform duration-300 group-hover:scale-[1.02]" />
            <div className="space-y-2 px-1 pt-2.5 pb-1">
              <Elided as="h3" text={nameOf(file.path)} lines={2} className="leading-5 font-medium break-all" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Avatar person={file.owner} className="size-5 text-[9px]" />
                <Path tip="grow" text={folderOf(file.path)} className="min-w-0 flex-1 font-mono text-[11px]" />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Details({ file }: { file: File }) {
  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l @5xl:flex" data-testid="details">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-5 font-medium">
        Details
        <Star className="size-4 fill-amber-400 text-amber-400" />
      </div>
      <div className="space-y-6 p-5">
        <FileTile path={file.path} className="h-32" />
        <div className="space-y-1">
          <Elided as="h3" text={nameOf(file.path)} lines={2} className="text-base leading-6 font-semibold break-all" />
          <p className="text-xs text-muted-foreground">
            {file.size} · edited {file.modified}
          </p>
        </div>
        <FileButton path={file.path} />
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
          <dt className="text-muted-foreground">Location</dt>
          <dd className="min-w-0">
            <PathTooltip path={file.path} />
          </dd>
          <dt className="text-muted-foreground">Alias</dt>
          <dd className="min-w-0">
            <PathTooltip path={SHORT} />
          </dd>
          <dt className="text-muted-foreground">Link</dt>
          <dd className="min-w-0">
            <BasePathTooltip path={LINK} />
          </dd>
          <dt className="text-muted-foreground">Short link</dt>
          <dd className="min-w-0">
            <BasePathTooltip path={SHORT_LINK} />
          </dd>
        </dl>
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <MessageSquare className="size-3.5" />
            Activity
          </h2>
          <ul className="space-y-1" data-testid="activity">
            {COMMENTS.map((c) => (
              <li
                key={c.text}
                data-tip-row
                tabIndex={0}
                className="-mx-2 flex gap-3 rounded-md p-2 outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Avatar person={c.author} className="mt-0.5" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-baseline gap-2">
                    <Elided as="span" text={c.author.name} className="block min-w-0 flex-1 font-medium" />
                    <span className="text-xs text-muted-foreground">{c.when}</span>
                  </div>
                  <Tipped tip="grow" text={c.text} lines={2} className="leading-5 text-muted-foreground" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
