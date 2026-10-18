import { Elided } from 'floating-ellipsis/react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A shadcn Button with a path cut in the middle, the file name kept. A Server
 * Component: `Elided` is a Client Component, and its props here serialize (a
 * string `keep`, not a RegExp). The button is a flex row, so the text takes
 * the room left (`flex-1`) and may shrink below its content (`min-w-0`).
 */
export function FileButton({ path }: { path: string }) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (
    <Button variant="outline" className="w-72 justify-start" data-testid="file-button">
      <FileText />
      <Elided as="span" text={path} position="middle" keep={name} className="min-w-0 flex-1 text-left" />
    </Button>
  );
}
