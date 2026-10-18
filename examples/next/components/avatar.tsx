import type { Person } from '@/lib/files';
import { cn } from '@/lib/utils';

export function Avatar({ person, className }: { person: Person; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background',
        className,
      )}
      style={{ background: `linear-gradient(135deg, oklch(0.68 0.16 ${person.hue}), oklch(0.52 0.19 ${person.hue + 30}))` }}
    >
      {person.initials}
    </span>
  );
}
