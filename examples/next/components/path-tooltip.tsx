'use client';

import { Elided } from 'floating-ellipsis/react';
import { useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TRIGGER } from '@/lib/utils';

/**
 * The full text in a shadcn Tooltip (Radix), opened only while the text is
 * cut. `Elided` takes the trigger's ref and props through `asChild`, and still
 * renders its text on the server.
 */
export function PathTooltip({ path }: { path: string }) {
  const trigger = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && trigger.current?.hasAttribute('data-truncated') === true)}>
      <TooltipTrigger asChild>
        <Elided ref={trigger} text={path} position="middle" tabIndex={0} className={TRIGGER} data-testid="radix-trigger" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm font-mono break-all">{path}</TooltipContent>
    </Tooltip>
  );
}
