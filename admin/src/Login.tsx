import { FormEvent, useState } from 'react';
import { ownerEmail, supabase, supabaseConfigured } from './supabase';

export default function Login() {
  const [email, setEmail] = useState(ownerEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Set VITE_SUPABASE_PUBLISHABLE_KEY in the admin build environment.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) setError(result.error.message);
    setBusy(false);
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">TB</div>
        <div className="login-kicker">TASH BAGS</div>
        <h1>Business OS</h1>
        <p className="muted">Sign in to manage your store, operations and AI agents.</p>
        {!supabaseConfigured && <div className="login-warning">Authentication is not configured for this build.</div>}
        <form className="form" onSubmit={submit}>
          <label>Email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Password<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="err">{error}</div>}
          <button className="btn login-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="login-foot">Owner access · {ownerEmail}</div>
      </section>
    </main>
  );
}
