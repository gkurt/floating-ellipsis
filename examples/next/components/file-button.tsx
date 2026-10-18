import { Elided } from 'floating-ellipsis/react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nameOf } from '@/lib/files';

/**
 * A shadcn Button with a path cut in the middle, the file name kept. A Server
 * Component: `Elided` is a Client Component, and its props here serialize (a
 * string `keep`, not a RegExp). The button is a flex row, so the text takes
 * the room left (`flex-1`) and may shrink below its content (`min-w-0`).
 */
export function FileButton({ path }: { path: string }) {
  return (
    <Button variant="outline" className="w-full justify-start font-mono text-xs" data-testid="file-button">
      <ExternalLink className="text-muted-foreground" />
      <Elided as="span" text={path} position="middle" keep={nameOf(path)} className="min-w-0 flex-1 text-left" />
    </Button>
  );
}
