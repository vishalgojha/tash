import { exec } from 'node:child_process';
import { env, hasWaha, log } from '../config.js';

export interface WaMessage {
  id: string;
  chatId: string;
  phone: string;
  contactName?: string;
  text?: string;
  fromMe?: boolean;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.wahaApiKey) h['X-Api-Key'] = env.wahaApiKey;
  return h;
}

async function wa<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.wahaApiUrl}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && path.startsWith('/api/sessions/')) return null as T;
    throw new Error(`WAHA ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function sessions(): Promise<string[]> {
  const s = await wa<any[]>('/api/sessions');
  const names: string[] = Array.isArray(s) ? s.map((x) => x.name ?? x.session) : [];
  return names.filter(Boolean);
}

export async function ensureSession() {
  if (!hasWaha()) return;
  const existing: string[] = await sessions().catch(() => []);
  if (existing.includes(env.wahaSession)) return;
  await fetch(`${env.wahaApiUrl}/api/sessions/${env.wahaSession}?start=true`, { method: 'POST', headers: headers() });
  log(`WAHA session ${env.wahaSession} requested (scan QR if requested by WAHA)`);
}

export async function sendText(chatId: string, text: string) {
  if (!hasWaha()) return false;
  await wa(`/api/${encodeURIComponent(env.wahaSession)}/send/text`, {
    method: 'POST',
    body: JSON.stringify({ chatId, text }),
  });
  return true;
}

export async function scanQr(chatId: string) {
  if (!hasWaha()) return;
  const path = `/api/${encodeURIComponent(env.wahaSession)}/auth/qr?format=image&fields=qrcode`;
  const res = await fetch(`${env.wahaApiUrl}${path}`, { headers: headers() });
  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    await sendText(chatId, 'compose message with image');
  }
}

function chatIdToPhone(chatId: string): string {
  return (chatId ?? '').replace(/[@].*$/, '').replace(/\D/g, '');
}

export function parseWebhook(body: any): WaMessage | null {
  const payload = body?.payload ?? body;
  if (!payload) return null;
  const chatId = payload.chatId ?? payload.chat?.id;
  const phone = chatIdToPhone(chatId);
  const text =
    typeof payload.text === 'string'
      ? payload.text
      : payload.text?.text ?? payload.message?.text ?? payload.body ?? '';
  return {
    id: payload.id ?? `${Date.now()}`,
    chatId: chatId ?? phone,
    phone,
    contactName: payload.contactName ?? payload.pushName ?? '',
    text: text || undefined,
    fromMe: Boolean(payload.fromMe ?? payload.from_me ?? false),
  };
}

/** Bridge to the laptop: desktop notification + optional spoken alert via the aurora assistant. */
export function notifyLaptop(title: string, message: string, speakIfAlert = env.agentLaptopAlert) {
  try {
    exec(`notify-send --app-name="Tash Bags" --urgency=normal "${title}" "${message}"`, (err) => {
      if (err) log('notify-send failed (headless?)', err.message);
    });
  } catch {
    /* ignore */
  }
  if (speakIfAlert && env.agentLaptopAlert) {
    try {
      exec(`~/aurora/run.sh say "${title}. ${message}" >/dev/null 2>&1 &`, (err) => {
        if (err) log('aurora say failed', err.message);
      });
    } catch {
      /* ignore */
    }
  }
}