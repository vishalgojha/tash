import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Login, { PasswordReset } from './Login';
import { ownerEmail, supabase } from './supabase';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setDenied(data.session?.user.email?.toLowerCase() !== ownerEmail);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setDenied(nextSession?.user.email?.toLowerCase() !== ownerEmail);
      setRecovery(event === 'PASSWORD_RECOVERY');
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!ready) return <main className="login-shell"><div className="muted">Loading secure sign-in…</div></main>;
  if (!supabase || !session) return <Login />;
  if (recovery) return <PasswordReset onComplete={() => setRecovery(false)} />;
  if (denied) {
    return <main className="login-shell"><section className="login-card"><h1>Access denied</h1><p className="muted">This account is not an owner of Tash Bags.</p><button className="btn" onClick={() => supabase?.auth.signOut()}>Sign out</button></section></main>;
  }
  return <>{children}</>;
}
