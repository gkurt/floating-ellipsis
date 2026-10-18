import { Elided } from 'floating-ellipsis/react';
import { Avatar } from '@/components/avatar';
import { FileIcon } from '@/components/file-icon';
import { Path } from '@/components/tipped';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { File } from '@/lib/files';

/**
 * A shadcn Table of paths cut in the middle, names kept, each grown back over
 * its row on hover. A cell in an auto table grows with its content, so the
 * table is `table-fixed`, with its columns sized in the header; the narrower
 * the table, the fewer columns it shows.
 */
export function FilesTable({ files, selected }: { files: File[]; selected: string }) {
  return (
    <Table className="table-fixed" data-testid="files-table">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead className="hidden w-44 @xl/main:table-cell">Owner</TableHead>
          <TableHead className="hidden w-24 @lg/main:table-cell">Modified</TableHead>
          <TableHead className="w-16 text-right">Size</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => (
          <TableRow
            key={file.path}
            data-tip-row
            tabIndex={0}
            data-state={file.path === selected ? 'selected' : undefined}
            className="outline-none focus-visible:bg-muted/50"
          >
            <TableCell>
              <div className="flex items-center gap-2.5">
                <FileIcon path={file.path} />
                <Path tip="grow" text={file.path} className="min-w-0 flex-1 font-mono text-xs" />
              </div>
            </TableCell>
            <TableCell className="hidden @xl/main:table-cell">
              <div className="flex items-center gap-2">
                <Avatar person={file.owner} className="size-5 text-[9px]" />
                <Elided text={file.owner.name} className="min-w-0 flex-1 text-muted-foreground" />
              </div>
            </TableCell>
            <TableCell className="hidden text-muted-foreground @lg/main:table-cell">{file.modified}</TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">{file.size}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
