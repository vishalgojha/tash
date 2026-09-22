import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Card, Page } from './Orders';
import RichText from '../components/RichText';

type AgentKind = 'ops' | 'chat';
type Message = { role: 'user' | 'agent'; content: string };

const starters: Record<AgentKind, string[]> = {
  ops: ['What needs attention today?', 'What should we reorder?', 'Why are we behind profit target?'],
  chat: ['What bags are in stock?', 'I want to track my order', 'Tell me about wholesale orders'],
};

export default function Agents() {
  const [kind, setKind] = useState<AgentKind>('ops');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<Record<AgentKind, Message[]>>({ ops: [], chat: [] });

  useEffect(() => {
    if (kind !== 'ops') return;
    api<{ messages: Message[] }>('/agent/ops/history?session_id=admin')
      .then((result) => setMessages((current) => ({ ...current, ops: result.messages })))
      .catch(() => undefined);
  }, [kind]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    setInput('');
    setError('');
    setMessages((current) => ({ ...current, [kind]: [...current[kind], { role: 'user', content }] }));
    setBusy(true);
    try {
      const result = await api<{ message: string }>(`/agent/${kind}`, {
        method: 'POST',
        body: JSON.stringify({ message: content, session_id: 'admin' }),
      });
      setMessages((current) => ({ ...current, [kind]: [...current[kind], { role: 'agent', content: result.message }] }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="AI workspace">
      <div className="agent-layout">
        <Card title="Your AI team">
          <div className="agent-switcher">
            <button className={`agent-choice ${kind === 'ops' ? 'active' : ''}`} onClick={() => setKind('ops')}>
              <b>Ops AI</b><span>Business decisions, stock, profit and margins</span>
            </button>
            <button className={`agent-choice ${kind === 'chat' ? 'active' : ''}`} onClick={() => setKind('chat')}>
              <b>Chat AI</b><span>Customer questions, orders and product discovery</span>
            </button>
          </div>
          <div className="agent-note">
            {kind === 'ops' ? 'Ops AI is read-only and uses live Business OS data.' : 'Chat AI uses the same customer conversation memory as WhatsApp.'}
          </div>
        </Card>

        <Card title={kind === 'ops' ? 'Ops AI workspace' : 'Chat AI workspace'} className="agent-chat-card">
          <div className="chat-log">
            {messages[kind].length === 0 && <div className="empty-agent"><b>What should we focus on?</b><span>Ask about profit, inventory, orders, margins, or customers.</span></div>}
            {messages[kind].map((message, index) => (
              <div key={index} className={`chat-message ${message.role}`}>
                <div className="chat-author">{message.role === 'agent' ? 'Ops AI' : 'You'}</div>
                <div className="chat-bubble">{message.role === 'agent' ? <RichText text={message.content} /> : message.content}</div>
              </div>
            ))}
            {busy && <div className="chat-message agent"><span className="muted">Thinking…</span></div>}
          </div>
          <div className="starter-row">
            {starters[kind].map((starter) => <button key={starter} className="btn subtle" onClick={() => setInput(starter)}>{starter}</button>)}
          </div>
          {error && <div className="err">{error}</div>}
          <form className="agent-form" onSubmit={send}>
            <input className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={kind === 'ops' ? 'Ask about the business...' : 'Ask the customer assistant...'} />
            <button className="btn" disabled={busy || !input.trim()}>Send</button>
          </form>
        </Card>
      </div>
    </Page>
  );
}
