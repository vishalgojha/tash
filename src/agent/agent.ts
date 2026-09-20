import { query } from '../db/pool.js';
import { env, log } from '../config.js';
import { notifyLaptop, sendText, type WaMessage } from './bridge.js';
import { chat, hasLlm } from './llm.js';
import { costAudit, round2 } from '../cost/audit.js';

export type Persona = 'D2C_CUSTOMER' | 'MARKETPLACE_REDIRECT' | 'WHOLESALE_BUYER' | 'INFLUENCER_COLLAB' | 'UNKNOWN';

interface ContactRow {
  id: number;
  phone: string;
  name: string | null;
  persona: Persona | null;
}

// --- CRM memory -----------------------------------------------------------

async function getOrCreateContact(m: WaMessage): Promise<ContactRow> {
  const { rows } = await query(
    `INSERT INTO wa_contacts (phone, name)
     VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET last_seen_at = now(), message_count = wa_contacts.message_count + 1
     RETURNING id, phone, name, persona`,
    [m.phone, m.contactName ?? null],
  );
  return rows[0];
}

async function history(contactId: number, limit = 10) {
  const { rows } = await query(
    `SELECT role, content FROM wa_conversations WHERE contact_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [contactId, limit],
  );
  return rows.reverse();
}

async function remember(contactId: number, role: string, content: string, skill?: string) {
  await query(
    `INSERT INTO wa_conversations (contact_id, role, content, skill_used) VALUES ($1,$2,$3,$4)`,
    [contactId, role, content, skill ?? null],
  );
}

async function setPersona(contactId: number, persona: Persona) {
  await query(`UPDATE wa_contacts SET persona=$1 WHERE id=$2`, [persona, contactId]);
}

// --- Persona classifier (mirrors legacy agent) ----------------------------

const PERSONA_RULES: [Persona, RegExp][] = [
  ['WHOLESALE_BUYER', /(bulk|resell|boutique|shop owner|retailer|50 pieces|50 pcs|wholesale|minimum order|dealer|distributor|for my store|for my shop)/i],
  ['INFLUENCER_COLLAB', /(collab|collaboration|content creator|influencer|review|gifting|partnership|sponsor|shoutout|unboxing)/i],
  ['MARKETPLACE_REDIRECT', /(amazon|myntra|nykaa|ajio|flipkart|meesho|saw it on|listed on|marketplace|other site)/i],
  ['D2C_CUSTOMER', /(buy|order|price|stock|bag|clutch|price|cost|delivery|cod|how much|want|gift|wedding|mini)/i],
];

function classifyPersona(text: string, fallback: Persona): Persona {
  for (const [persona, rule] of PERSONA_RULES) {
    if (rule.test(text)) return persona;
  }
  return fallback === 'UNKNOWN' ? 'D2C_CUSTOMER' : fallback;
}

// --- Unified data lookups ------------------------------------------------

async function productLookup(term: string) {
  const cleaned = (term ?? '').replace(/[^a-z0-9\s-]/gi, '').trim().split(/\s+/).slice(0, 4).join(' ');
  return query(
    `SELECT v.id, p.title, v.sku, v.price, v.compare_at_price, v.inventory_quantity, v.available
       FROM product_variants v JOIN products p ON p.id=v.product_id
      WHERE to_tsvector('simple', p.title || ' ' || COALESCE(v.sku,'')) @@ plainto_tsquery('simple', $1)
      ORDER BY v.available DESC, v.inventory_quantity DESC LIMIT 4`,
    [cleaned],
  );
}

function formatProduct(r: any) {
  const strike = r.compare_at_price ? ` (was Rs. ${Number(r.compare_at_price).toLocaleString('en-IN')})` : '';
  const stock =
    r.available && (r.inventory_quantity === null || r.inventory_quantity > 0)
      ? `in stock${r.inventory_quantity ? ` (${r.inventory_quantity} left)` : ''}`
      : 'currently unavailable';
  return `${r.title} — Rs. ${Number(r.price).toLocaleString('en-IN')}${strike} · ${stock}`;
}

// --- Skills (each answers from the unified catalog / orders / audit) ------

const d2cSkill = {
  name: 'd2cSkill',
  async execute(text: string): Promise<{ message: string; handoff?: boolean; reason?: string }> {
    const { rows } = await productLookup(text);
    if (!rows.length) {
      return {
        message:
          `Hi! This is Tash Bags ✨ — handcrafted bags, free shipping across India, COD available.\n` +
          `Looking for stock/price? Send the name (e.g. "mini dholki clutch", "wedding sunglasses").\n` +
          `Or shop live: tashbags.com`,
      };
    }
    return { message: rows.map(formatProduct).join('\n') };
  },
};

const marketplaceSkill = {
  name: 'marketplaceSkill',
  async execute(_text: string) {
    const { rows: channels } = await query(
      `SELECT id, name, fee_pct, cod_fee_pct FROM channels WHERE kind='marketplace' AND is_active ORDER BY id`,
    );
    return {
      message:
        `Great choice! Tash Bags is also live on these marketplaces — you can order directly from your preferred app.\n` +
        `${channels.map((c) => `• ${c.name}`).join('\n')}\n` +
        `Prices may vary slightly per platform. Same handcrafted quality on tashbags.com with free shipping.`,
    };
  },
};

const wholesaleSkill = {
  name: 'wholesaleSkill',
  async execute(text: string) {
    const qty = text.match(/(\d+)\s*(pcs|pieces|units?|qty)?/i);
    const amount = qty ? Number(qty[1]) : null;
    if (amount && amount >= 25) {
      const { rows: audit } = await costAudit({ onlyNegative: false, limit: 5 });
      const lowMargin = audit.filter((a) => a.netMarginPct < 15).map((a) => a.title).slice(0, 3);
      return {
        message:
          `Thanks for the bulk interest (${amount} pieces)! We love working with boutiques & resellers.\n` +
          `Please share: your boutique/shop name, city, and the styles you're eyeing — Tanu will share the B2B price list personally.` +
          (lowMargin.length ? `\n\nNote: those styles are tighter on margin: ${lowMargin.join(', ')}.` : '') +
          `\nMeanwhile I'll flag this to the team.`,
        handoff: true,
        reason: `wholesale lead ${amount} pcs from ${'WhatsApp'}`,
      };
    }
    return {
      message:
        `Bulk/B2B? We'd love to work with your store. For 25+ pieces we share a dedicated wholesale pricing sheet.\n` +
        `Reply with quantity (e.g. "50 pieces") and your store/city, and the team will reach out.`,
    };
  },
};

const influencerSkill = {
  name: 'influencerSkill',
  async execute(_text: string) {
    return {
      message:
        `Thanks for reaching out! 💫 We collaborate with creators for gifting and content.\n` +
        `Share your handle + audience size (e.g. "10k") and Tanu will send our collab kit — usually a bag from the Bling or Mini range, free of cost.`,
      handoff: true,
      reason: 'influencer collab lead',
    };
  },
};

const orderSkill = {
  name: 'orderSkill',
  async execute(m: WaMessage, text: string) {
    const orderNo = text.match(/#?([A-Za-z]?\d{4,8})/i)?.[1] ?? null;
    const { rows } = await query(
      orderNo
        ? `SELECT name, financial_status, fulfillment_status, total_price, updated_at FROM orders WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 1`
        : `SELECT name, financial_status, fulfillment_status, total_price, updated_at FROM orders WHERE phone=$1 ORDER BY created_at DESC LIMIT 2`,
      orderNo ? [`%${orderNo}%`] : [m.phone],
    );
    if (!rows.length) {
      return {
        message: `No order found for that. Share your order number (from the email/SMS) or the phone you ordered with, and I'll fetch the status.`,
      };
    }
    const list = rows
      .map(
        (r) =>
          `#${r.name} · ${r.financial_status} · ${r.fulfillment_status ?? 'not shipped yet'} · Rs. ${Number(r.total_price).toLocaleString('en-IN')} · updated ${new Date(r.updated_at).toLocaleDateString('en-IN')}`,
      )
      .join('\n');
    return { message: `Here's the latest on your order:\n${list}` };
  },
};

const handoffSkill = {
  name: 'handoffSkill',
  async execute() {
    return { message: `One moment — I'm connecting you with Tanu and the team. We'll reply here shortly! 🙏`, handoff: true, reason: 'explicit handoff request' };
  },
};

// --- Main pipeline --------------------------------------------------------

async function answer(m: WaMessage): Promise<{ message: string; handoff: boolean; reason?: string; skill: string }> {
  const text = m.text ?? '';
  const contact = await getOrCreateContact(m);
  const activePersona: Persona = contact.persona ?? classifyPersona(text, 'UNKNOWN');
  if (activePersona !== contact.persona) {
    await setPersona(contact.id, activePersona);
  }
  await remember(contact.id, 'user', text);

  const ctx = { m, text, contact, persona: activePersona };

  if (/(talk to human|talk to owner|tanu|support|agent|escalate|human)/i.test(text)) {
    const r = await handoffSkill.execute();
    await remember(contact.id, 'assistant', r.message, 'handoffSkill');
    return { ...r, skill: 'handoffSkill' };
  }
  if (/(order|track|delivery|shipment|shipped|dispatched|tracking)/i.test(text) && activePersona !== 'WHOLESALE_BUYER') {
    const r = await orderSkill.execute(m, text);
    await remember(contact.id, 'assistant', r.message, 'orderSkill');
    return { skill: 'orderSkill', message: r.message, handoff: false };
  }

  let result: { message: string; handoff?: boolean; reason?: string };
  let skillName: string;
  switch (activePersona) {
    case 'WHOLESALE_BUYER':
      result = await wholesaleSkill.execute(text);
      skillName = 'wholesaleSkill';
      break;
    case 'INFLUENCER_COLLAB':
      result = await influencerSkill.execute(text);
      skillName = 'influencerSkill';
      break;
    case 'MARKETPLACE_REDIRECT':
      result = await marketplaceSkill.execute(text);
      skillName = 'marketplaceSkill';
      break;
    default: {
      result = await d2cSkill.execute(text);
      skillName = 'd2cSkill';
    }
  }

  if (hasLlm() && skillName === 'd2cSkill') {
    const h = await history(contact.id);
    const llm = await chat(
      `You are Tash, the friendly WhatsApp assistant at Tash Bags (handcrafted Indian bags). ` +
        `Be short (under 250 chars), warm, and answer only from this context. If you lack the answer, suggest tashbags.com.`,
      text,
      h,
    );
    if (llm) result = { message: llm } ;
  }

  await remember(contact.id, 'assistant', result.message, skillName);
  if (result.handoff) {
    await query(`UPDATE wa_contacts SET needs_handoff=true, handoff_reason=$1 WHERE id=$2`, [result.reason ?? 'handoff', contact.id]);
    notifyLaptop(`🔔 Handoff needed (${ctx.persona})`, `${contact.name || m.phone}: ${text.slice(0, 90)}`);
  }
  return { message: result.message, handoff: Boolean(result.handoff), reason: result.reason, skill: skillName };
}

export async function handleIncoming(m: WaMessage): Promise<string> {
  const { message } = await answer(m);
  await query(
    `INSERT INTO agent_chats (wa_session, wa_chat_id, contact_name, is_owner, reply, created_at)
     VALUES ($1,$2,$3,$4,$5,now())`,
    [env.wahaSession, m.chatId, m.contactName ?? null, env.agentOwnerPhones.includes(m.phone), message],
  );
  if (env.agentOwnerPhones.includes(m.phone)) {
    notifyLaptop(`WhatsApp customer`, `${m.contactName || m.phone}: ${m.text?.slice(0, 80) ?? '(no text)'}`);
  }
  await sendText(m.chatId, message);
  return message;
}

export async function answerText(text: string, chatId = 'cli'): Promise<string> {
  const m: WaMessage = { id: `cli-${Date.now()}`, chatId, phone: chatId, text };
  const { message } = await answer(m);
  return message;
}

export function logAgentInfo() {
  log(`agent ready — LLM ${hasLlm() ? 'on' : 'off (no OPENROUTER_API_KEY/GEMINI_API_KEY/GROQ_API_KEY)'} · laptop alerts ${env.agentLaptopAlert ? 'on' : 'off'} · owner phones: ${env.agentOwnerPhones.length}`);
}
