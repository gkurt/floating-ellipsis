import { Showcase } from '@/components/showcase';
import { FILES } from '@/lib/files';

// Generated at build time (SSG).
export const dynamic = 'error';

export default function Page() {
  return <Showcase mode="static" files={FILES} />;
}
