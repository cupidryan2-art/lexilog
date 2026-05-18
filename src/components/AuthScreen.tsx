import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Eye, EyeOff } from 'lucide-react';

type Mode = 'login' | 'register' | 'forgot';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function reset() {
    setError('');
    setSuccess('');
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else setSuccess('Check your email to confirm your account, then sign in.');
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/lexilog/',
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSuccess('Password reset email sent. Check your inbox.');
  }

  const isLogin = mode === 'login';
  const isForgot = mode === 'forgot';

  return (
    <div className="min-h-screen bg-[#F8F5EE] flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-9 h-9 bg-[#1C1917] rounded-sm flex items-center justify-center">
          <span className="text-white text-sm font-bold font-['Playfair_Display']">L</span>
        </div>
        <div>
          <h1
            className="font-['Playfair_Display'] text-xl text-[#1C1917] leading-none"
            style={{ fontWeight: 900 }}
          >
            LexiLog
          </h1>
          <p className="text-[10px] text-stone-400 tracking-widest uppercase leading-none mt-0.5">
            Vocabulary Companion
          </p>
        </div>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm bg-white rounded-2xl px-8 py-8"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}
      >
        <h2
          className="font-['Playfair_Display'] text-[22px] text-[#1C1917] mb-1"
          style={{ fontWeight: 700 }}
        >
          {isForgot ? 'Reset password' : isLogin ? 'Welcome back' : 'Create account'}
        </h2>
        <p className="text-[13px] text-stone-400 mb-6">
          {isForgot
            ? "We'll email you a reset link."
            : isLogin
            ? 'Sign in to your vocabulary notebook.'
            : /* register */ 'Start building your personal word collection.'}
        </p>

        {success ? (
          <div className="text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-4">
            {success}
          </div>
        ) : null}

        {error ? (
          <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        ) : null}

        <form onSubmit={isForgot ? handleForgot : isLogin ? handleLogin : handleRegister}>
          {/* Email */}
          <div className="mb-4">
            <label className="block text-[12px] font-semibold text-stone-500 uppercase tracking-wide mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-lg bg-[#FDFCFA] focus:outline-none focus:border-[#D4883A] focus:ring-1 focus:ring-[#D4883A]/30 transition-colors"
            />
          </div>

          {/* Password */}
          {!isForgot && (
            <div className="mb-5">
              <label className="block text-[12px] font-semibold text-stone-500 uppercase tracking-wide mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-stone-200 rounded-lg bg-[#FDFCFA] focus:outline-none focus:border-[#D4883A] focus:ring-1 focus:ring-[#D4883A]/30 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {isLogin && (
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); reset(); }}
                  className="mt-1.5 text-[12px] text-[#D4883A] hover:text-[#B06A20] transition-colors"
                >
                  Forgot password?
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !!success}
            className="w-full py-2.5 text-sm font-semibold bg-[#1C1917] text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            {loading
              ? 'Please wait…'
              : isForgot
              ? 'Send reset email'
              : isLogin
              ? 'Sign in'
              : 'Create account'}
          </button>
        </form>

        {/* Mode toggle */}
        <p className="text-center text-[13px] text-stone-400 mt-5">
          {isForgot ? (
            <>
              Remember it?{' '}
              <button
                onClick={() => { setMode('login'); reset(); }}
                className="text-[#1C1917] font-semibold hover:text-[#D4883A] transition-colors"
              >
                Sign in
              </button>
            </>
          ) : isLogin ? (
            <>
              No account?{' '}
              <button
                onClick={() => { setMode('register'); reset(); }}
                className="text-[#1C1917] font-semibold hover:text-[#D4883A] transition-colors"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have one?{' '}
              <button
                onClick={() => { setMode('login'); reset(); }}
                className="text-[#1C1917] font-semibold hover:text-[#D4883A] transition-colors"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
