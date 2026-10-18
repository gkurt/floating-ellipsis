import 'floating-ellipsis/fallback.css';
import './globals.css';
import type { Metadata } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';

export const metadata: Metadata = { title: 'floating-ellipsis with Next.js and shadcn/ui' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <TooltipProvider>
          <main className="mx-auto max-w-2xl p-10">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
