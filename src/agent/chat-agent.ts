import { answerText } from './agent.js';

/** Public web-chat entry point. WhatsApp continues to use the same pipeline directly. */
export async function answerChat(message: string, sessionId = 'web') {
  const text = message.trim();
  if (!text) throw new Error('message is required');
  const safeSession = sessionId.trim().slice(0, 120) || 'web';
  return answerText(text, `web:${safeSession}`);
}
