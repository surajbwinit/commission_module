import type { Metadata } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import Explorer from '@/components/layout/Explorer';
import Header from '@/components/layout/Header';
import { ThemeProvider, themeBootstrapScript } from '@/components/theme/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Commission · WINIT',
  description: 'Commission management — design, simulate, approve.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="antialiased font-sans bg-background text-foreground">
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
          <div className="flex flex-col h-screen overflow-hidden">
            <Header />
            <div className="flex-1 flex overflow-hidden">
              <Explorer />
              <main className="flex-1 overflow-y-auto bg-muted/20">
                <div className="max-w-6xl mx-auto p-6 lg:p-8">
                  {children}
                </div>
              </main>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
