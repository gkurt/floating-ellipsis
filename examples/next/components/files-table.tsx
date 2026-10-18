import { Elided } from 'floating-ellipsis/react';
import { Path } from '@/components/path';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface File {
  path: string;
  owner: string;
  size: string;
}

/**
 * A shadcn Table with paths cut in the middle and names at the end. A cell in
 * an auto table grows with its content, so the table is `table-fixed`, with
 * its columns sized in the header.
 */
export function FilesTable({ files }: { files: File[] }) {
  return (
    <Table className="table-fixed" data-testid="files-table">
      <TableHeader>
        <TableRow>
          <TableHead>Path</TableHead>
          <TableHead className="w-32">Owner</TableHead>
          <TableHead className="w-20 text-right">Size</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => (
          <TableRow key={file.path}>
            <TableCell>
              <Path text={file.path} className="font-mono text-xs" />
            </TableCell>
            <TableCell>
              <Elided text={file.owner} />
            </TableCell>
            <TableCell className="text-right">{file.size}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
