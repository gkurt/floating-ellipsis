import { Examples } from '@/components/examples';
import { FILES, PATH, SHORT } from '@/lib/files';

// Generated at build time (SSG).
export const dynamic = 'error';

export default function Page() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold">Static</h1>
      <Examples path={PATH} short={SHORT} files={FILES} />
    </>
  );
}
