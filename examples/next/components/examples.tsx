import { BasePathTooltip } from '@/components/base-path-tooltip';
import { FileButton } from '@/components/file-button';
import { type File, FilesTable } from '@/components/files-table';
import { PathTooltip } from '@/components/path-tooltip';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Every example, rendered by both the static and the dynamic page. */
export function Examples({ path, short, files }: { path: string; short: string; files: File[] }) {
  return (
    <div className="flex flex-col gap-10">
      <Section title="Button">
        <FileButton path={path} />
      </Section>
      <Section title="Tooltip (Radix), only while cut">
        <PathTooltip path={path} />
        <PathTooltip path={short} />
      </Section>
      <Section title="Tooltip (Base UI), only while cut">
        <BasePathTooltip path={path} />
        <BasePathTooltip path={short} />
      </Section>
      <Section title="Table">
        <FilesTable files={files} />
      </Section>
    </div>
  );
}
