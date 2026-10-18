import { Examples } from '@/components/examples';
import { FILES, PATH, SHORT } from '@/lib/files';

// Rendered on each request (SSR), with the path from the query: `/ssr?path=…`.
export default async function Page({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const { path = PATH } = await searchParams;
  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold">Dynamic</h1>
      <Examples path={path} short={SHORT} files={[{ path, owner: 'Request', size: '—' }, ...FILES.filter((f) => f.path !== path)]} />
    </>
  );
}
