let geminiKey = process.env.GEMINI_API_KEY ?? '';
let groqKey = process.env.GROQ_API_KEY ?? '';
let openRouterKey = process.env.OPENROUTER_API_KEY ?? '';

export function hasLlm() {
  return Boolean(openRouterKey || geminiKey || groqKey);
}

/** Lightweight LLM call for the agent. Returns null when no key is configured or on failure. */
export async function chat(system: string, user: string, history: { role: string; content: string }[] = []): Promise<string | null> {
  if (openRouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.SHOPIFY_STOREFRONT_URL ?? 'https://tashbags.com',
          'X-Title': 'Tash Bags Business OS',
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'system', content: system }, ...history.slice(-8), { role: 'user', content: user }],
        }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.trim()) return content.trim();
      }
    } catch {
      return null;
    }
    return null;
  }
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
