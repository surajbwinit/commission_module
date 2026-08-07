'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Explorer from '@/components/layout/Explorer';
import Header from '@/components/layout/Header';
import { useAppStore } from '@/lib/store';

// Wraps every page: the login screen renders bare, everything else requires
// an authenticated session and gets the Explorer + Header chrome.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const isLogin = pathname === '/login';

  // Auth state lives in localStorage, so wait for the client mount before
  // deciding anything — the server render knows nothing about the session.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated && !isLogin) router.replace('/login');
    if (isAuthenticated && isLogin) router.replace('/dashboard');
  }, [ready, isAuthenticated, isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!ready || !isAuthenticated) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Explorer />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
