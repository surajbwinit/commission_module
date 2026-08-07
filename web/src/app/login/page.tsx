'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, Eye, EyeOff, LogIn } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import credentials from '@/data/credentials.json';

export default function LoginPage() {
  const router = useRouter();
  const login = useAppStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Username is case-insensitive; password must match exactly.
    const userOk = username.trim().toLowerCase() === credentials.username.toLowerCase();
    const passOk = password === credentials.password;

    if (userOk && passOk) {
      setError('');
      login();
      router.replace('/dashboard');
    } else {
      setError('Invalid username or password.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 bg-premium-mesh p-6">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary-600 text-white flex items-center justify-center mb-3">
            <Banknote className="w-6 h-6" />
          </div>
          <span className="text-[11px] font-semibold text-slate-500 tracking-[0.12em] uppercase">WINIT</span>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">CommissionIQ</h1>
        </div>

        <div className="card-elevated p-8">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-6">Sign in</h2>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate autoComplete="off">
            <div>
              <label htmlFor="username" className="label">Username</label>
              <input
                id="username"
                type="text"
                name="ciq-user"
                autoComplete="off"
                autoFocus
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                className="input w-full"
                placeholder="Username"
              />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="ciq-pass"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  className="input w-full pr-10"
                  placeholder="Password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full">
              <LogIn className="h-4 w-4" />
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
