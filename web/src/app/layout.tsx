import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import AppShell from '@/components/layout/AppShell';
import { ThemeProvider, themeBootstrapScript } from '@/components/theme/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Commission · WINIT',
  description: 'Commission management — design, simulate, approve.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="antialiased font-sans bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
        <ThemeProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3500,
              style: {
                borderRadius: '8px',
                background: 'hsl(var(--popover))',
                color: 'hsl(var(--popover-foreground))',
                border: '1px solid hsl(var(--border))',
                fontSize: '13px',
                padding: '10px 14px',
              },
              success: { iconTheme: { primary: '#10b981', secondary: '#f0fdf4' } },
              error:   { iconTheme: { primary: '#ef4444', secondary: '#fef2f2' } },
            }}
          />
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
