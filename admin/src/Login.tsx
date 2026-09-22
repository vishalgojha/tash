import { FormEvent, useState } from 'react';
import { authorizedEmails, ownerEmail, supabase, supabaseConfigured } from './supabase';

const passwordResetUrl = 'https://app.tashbags.com/reset-password';

type LoginMode = 'password' | 'magic' | 'forgot' | 'signup';

export default function Login() {
  const [mode, setMode] = useState<LoginMode>('password');
  const [email, setEmail] = useState(ownerEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Set VITE_SUPABASE_PUBLISHABLE_KEY in the admin build environment.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    const address = email.trim();
    if (mode === 'signup' && !authorizedEmails.includes(address.toLowerCase())) {
      setError('Test access is restricted to the approved email address.');
      setBusy(false);
      return;
    }
    const result = mode === 'password'
      ? await supabase.auth.signInWithPassword({ email: address, password })
      : mode === 'magic'
        ? await supabase.auth.signInWithOtp({ email: address, options: { emailRedirectTo: window.location.origin } })
        : mode === 'forgot'
          ? await supabase.auth.resetPasswordForEmail(address, { redirectTo: passwordResetUrl })
          : await supabase.auth.signUp({ email: address, password, options: { emailRedirectTo: window.location.origin } });

    if (result.error) setError(result.error.message);
    else if (mode === 'magic') setSuccess('Magic link sent. Check your email to sign in.');
    else if (mode === 'signup') setSuccess('Test account created. Check your email if confirmation is required, then sign in.');
    else if (mode === 'forgot') setSuccess('Password reset link sent. Check your email to continue.');
    setBusy(false);
  }

  const title = mode === 'password' ? 'Business OS' : mode === 'magic' ? 'Magic link sign in' : mode === 'signup' ? 'Create test access' : 'Reset password';
  const action = mode === 'password' ? 'Sign in' : mode === 'magic' ? 'Send magic link' : mode === 'signup' ? 'Create account' : 'Send reset link';

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">TB</div>
        <div className="login-kicker">TASH BAGS</div>
        <h1>{title}</h1>
        <p className="muted">{mode === 'password' ? 'Sign in to manage your store, operations and AI agents.' : 'Owner access for Tash Bags Business OS.'}</p>
        {!supabaseConfigured && <div className="login-warning">Authentication is not configured for this build.</div>}
        <form className="form" onSubmit={submit}>
          <label>Email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {(mode === 'password' || mode === 'signup') && <label>Password<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>}
          {error && <div className="err">{error}</div>}
          {success && <div className="login-success">{success}</div>}
          <button className="btn login-button" disabled={busy}>{busy ? 'Sending…' : action}</button>
        </form>
        <div className="login-links">
          {mode !== 'password' && <button className="link-button" onClick={() => { setMode('password'); setError(''); setSuccess(''); }}>Back to password sign in</button>}
          {mode === 'password' && <><button className="link-button" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}>Forgot password?</button><button className="link-button" onClick={() => { setMode('magic'); setError(''); setSuccess(''); }}>Use magic link instead</button><button className="link-button" onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}>Create test access</button></>}
        </div>
        <div className="login-foot">Owner access · {ownerEmail}</div>
      </section>
    </main>
  );
}

export function PasswordReset({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmation) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    const result = await supabase.auth.updateUser({ password });
    if (result.error) setError(result.error.message);
    else onComplete();
    setBusy(false);
  }

  return (
    <main className="login-shell"><section className="login-card">
      <div className="brand-mark">TB</div><div className="login-kicker">TASH BAGS</div><h1>Set new password</h1>
      <p className="muted">Choose a new password for your Business OS account.</p>
      <form className="form" onSubmit={submit}>
        <label>New password<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
        <label>Confirm password<input className="input" type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} minLength={8} required /></label>
        {error && <div className="err">{error}</div>}
        <button className="btn login-button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </section></main>
  );
}
