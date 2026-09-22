import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Login, { PasswordReset } from './Login';
import { isAuthorizedEmail, ownerEmail, supabase } from './supabase';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [recovery, setRecovery] = useState(() => {
    const url = new URL(window.location.href);
    return url.pathname === '/reset-password'
      || url.hash.includes('type=recovery')
      || url.searchParams.get('type') === 'recovery';
  });

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
       setDenied(!isAuthorizedEmail(data.session?.user.email));
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
       setDenied(!isAuthorizedEmail(nextSession?.user.email));
      if (event === 'PASSWORD_RECOVERY' || window.location.pathname === '/reset-password' || window.location.hash.includes('type=recovery')) setRecovery(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!ready) return <main className="login-shell"><div className="muted">Loading secure sign-in…</div></main>;
  if (!supabase) return <Login />;
  if (!session && recovery) return <main className="login-shell"><div className="muted">Preparing password reset…</div></main>;
  if (!session) return <Login />;
  if (recovery) return <PasswordReset onComplete={() => setRecovery(false)} />;
  if (denied) {
    return <main className="login-shell"><section className="login-card"><h1>Access denied</h1><p className="muted">This account is not an owner of Tash Bags.</p><button className="btn" onClick={() => supabase?.auth.signOut()}>Sign out</button></section></main>;
  }
  return <>{children}</>;
}
