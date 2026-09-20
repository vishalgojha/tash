let geminiKey = process.env.GEMINI_API_KEY ?? '';
let groqKey = process.env.GROQ_API_KEY ?? '';

export function hasLlm() {
  return Boolean(geminiKey || groqKey);
}

/** Lightweight LLM call for the agent. Returns null when no key is configured or on failure. */
export async function chat(system: string, user: string, history: { role: string; content: string }[] = []): Promise<string | null> {
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: system }, ...history.slice(-8), { role: 'user', content: user }],
        }),
      });
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content ?? null;
    } catch {
      /* fall through to gemini */
    }
  }
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
        }),
      });
      const data: any = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch {
      return null;
    }
  }
  return null;
}