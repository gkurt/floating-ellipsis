'use client';

import { Elided } from 'floating-ellipsis/react';
import { useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/base/tooltip';

/**
 * The same with shadcn's Base UI Tooltip: `Elided` is the trigger's `render`
 * element, which Base UI hands its ref and props.
 */
export function BasePathTooltip({ path }: { path: string }) {
  const trigger = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && trigger.current?.hasAttribute('data-truncated') === true)}>
      <TooltipTrigger
        render={<Elided ref={trigger} text={path} position="middle" tabIndex={0} className="w-60 rounded-sm" data-testid="base-trigger" />}
      />
      <TooltipContent className="break-all">{path}</TooltipContent>
    </Tooltip>
  );
}
