import { BookOpen, FileCode, FileImage, FileTerminal, FileText, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const KINDS: Record<string, { icon: LucideIcon; hue: number }> = {
  md: { icon: FileText, hue: 285 },
  svg: { icon: FileImage, hue: 220 },
  pdf: { icon: BookOpen, hue: 20 },
  txt: { icon: FileTerminal, hue: 60 },
  ipynb: { icon: FileCode, hue: 160 },
};

const kindOf = (path: string) => KINDS[path.slice(path.lastIndexOf('.') + 1)] ?? KINDS.md;

/** A file's icon, tinted by its kind. */
export function FileIcon({ path, className }: { path: string; className?: string }) {
  const { icon: Icon, hue } = kindOf(path);
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} style={{ color: `oklch(0.62 0.16 ${hue})` }} />;
}

/** A preview tile: the kind's colour as a soft gradient, its icon on top. */
export function FileTile({ path, className }: { path: string; className?: string }) {
  const { icon: Icon, hue } = kindOf(path);
  return (
    <div
      aria-hidden
      className={cn('relative grid place-items-center overflow-hidden rounded-md border', className)}
      style={{
        background: `radial-gradient(120% 90% at 0% 0%, oklch(0.75 0.14 ${hue} / 0.35), transparent 60%), radial-gradient(100% 100% at 100% 100%, oklch(0.7 0.16 ${hue + 40} / 0.3), transparent 55%)`,
      }}
    >
      <div className="absolute top-4 left-5 w-2/5 space-y-1.5 opacity-50" style={{ color: `oklch(0.6 0.1 ${hue})` }}>
        <div className="h-1 w-full rounded-full bg-current" />
        <div className="h-1 w-4/5 rounded-full bg-current" />
        <div className="h-1 w-3/5 rounded-full bg-current" />
      </div>
      <span className="relative grid size-11 place-items-center rounded-xl bg-background/85 shadow-sm ring-1 ring-black/5 backdrop-blur dark:ring-white/10">
        <Icon className="size-5" style={{ color: `oklch(0.58 0.18 ${hue})` }} />
      </span>
    </div>
  );
}
