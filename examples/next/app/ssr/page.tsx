import { Showcase } from '@/components/showcase';
import { FILES } from '@/lib/files';

// Rendered on each request (SSR), with the open file's path from the query: `/ssr?path=…`.
export default async function Page({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const { path } = await searchParams;
  const files = path ? [{ ...FILES[0], path, modified: 'Just now' }, ...FILES.filter((f) => f.path !== path)] : FILES;
  return <Showcase mode="dynamic" files={files} />;
}
