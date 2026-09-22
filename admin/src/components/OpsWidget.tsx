import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Message = { role: 'user' | 'agent'; content: string };

const starters = [
  'What needs attention today?',
  'What should we reorder?',
  'Why are we behind profit target?',
];

export default function OpsWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    setInput('');
    setError('');
    setMessages((current) => [...current, { role: 'user', content }]);
    setBusy(true);
    try {
      const result = await api<{ message: string }>('/agent/ops', {
        method: 'POST',
        body: JSON.stringify({ message: content }),
      });
      setMessages((current) => [...current, { role: 'agent', content: result.message }]);
    } catch (e: any) {
      setError(e.message || 'Ops AI could not respond.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`ops-widget${open ? ' is-open' : ''}`}>
      {open && (
        <section className="ops-panel" aria-label="Ops AI assistant">
          <header className="ops-panel-head">
            <div className="ops-avatar">✦</div>
            <div>
              <strong>Ops AI</strong>
              <span>Live Business OS analyst</span>
            </div>
            <button className="ops-close" onClick={() => setOpen(false)} aria-label="Close Ops AI">×</button>
          </header>
          <div className="ops-log" ref={logRef}>
            {messages.length === 0 && (
              <div className="ops-welcome">
                <b>What should we focus on?</b>
                <span>I can read your live sales, margin, inventory, and target data.</span>
              </div>
            )}
            {messages.map((message, index) => (
              <div className={`ops-message ${message.role}`} key={`${message.role}-${index}`}>
                {message.content}
              </div>
            ))}
            {busy && <div className="ops-message agent ops-thinking"><i /> <i /> <i /></div>}
          </div>
          <div className="ops-starters">
            {starters.map((starter) => (
              <button key={starter} onClick={() => setInput(starter)}>{starter}</button>
            ))}
          </div>
          {error && <div className="ops-error">{error}</div>}
          <form className="ops-compose" onSubmit={send}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about the business…" aria-label="Ask Ops AI" />
            <button disabled={busy || !input.trim()} aria-label="Send message">↑</button>
          </form>
        </section>
      )}
      <button className="ops-launcher" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Ops AI' : 'Open Ops AI'}>
        <span className="ops-launcher-icon">✦</span>
        {!open && <span><b>Ask Ops AI</b><small>Live business guidance</small></span>}
        <em className="ops-online" />
      </button>
    </div>
  );
}
