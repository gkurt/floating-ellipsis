'use client';

import { GripVertical } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react';

const MIN = 340;

/**
 * A window around the app, centred, that its handles resize from both sides
 * at once. Its layout answers to its own width (it's a size container), so
 * dragging shows what a narrower screen would.
 */
export function AppWindow({ title, children }: { title: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  // Null: as wide as the page lets it be.
  const [width, setWidth] = useState<number | null>(null);

  const widest = () => frame.current?.parentElement?.clientWidth ?? Infinity;
  const resize = (to: number) => setWidth(Math.round(Math.min(Math.max(to, MIN), widest())));

  const drag = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.buttons !== 1 || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    resize(2 * Math.abs(e.clientX - (r.left + r.width / 2)));
  };
  const nudge = (e: KeyboardEvent<HTMLButtonElement>, side: 1 | -1) => {
    const step = { ArrowLeft: -side, ArrowRight: side }[e.key];
    if (step === undefined || !frame.current) return;
    e.preventDefault();
    resize(frame.current.offsetWidth + step * 2 * (e.shiftKey ? 64 : 16));
  };

  const handle = (side: 1 | -1) => (
    <button
      type="button"
      aria-label="Resize the window (left and right arrow keys)"
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={drag}
      onKeyDown={(e) => nudge(e, side)}
      onDoubleClick={() => setWidth(null)}
      className={`group absolute inset-y-0 z-10 hidden w-5 cursor-ew-resize touch-none items-start justify-center outline-none sm:flex ${side === 1 ? '-right-5' : '-left-5'}`}
    >
      <span className="sticky top-[calc(50vh-1.5rem)] mt-40 grid h-12 w-2 place-items-center rounded-full bg-border text-muted-foreground transition-colors group-hover:bg-brand/60 group-hover:text-white group-focus-visible:bg-brand group-focus-visible:text-white group-active:bg-brand group-active:text-white">
        <GripVertical className="size-3" />
      </span>
    </button>
  );

  return (
    <div
      ref={frame}
      data-testid="app-window"
      className="@container relative mx-auto w-full rounded-xl border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_64px_-24px_rgb(0_0_0/0.35)] ring-1 ring-black/5 dark:ring-white/5"
      style={width === null ? undefined : { width }}
    >
      {handle(-1)}
      {handle(1)}
      <div className="flex h-10 items-center gap-2 border-b px-4">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="mx-auto pr-12 text-xs font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="overflow-hidden rounded-b-xl">{children}</div>
    </div>
  );
}
