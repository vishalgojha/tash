import { dashboard } from '../analytics/dashboard.js';
import { inventoryAnalytics, reorderAlerts } from '../analytics/inventory.js';
import { costAudit, costAuditSummary } from '../cost/audit.js';
import { chat, hasLlm } from './llm.js';

const FALLBACK =
  'I can review sales, profit, cash, inventory, reorder alerts, pricing, and channel margins. Ask a specific question such as "what should we reorder?" or "why are we behind target?"';

async function opsContext() {
  const month = new Date().toISOString().slice(0, 7);
  const [commandCentre, inventory, reorders, margins, marginSummary] = await Promise.all([
    dashboard(month),
    inventoryAnalytics(30),
    reorderAlerts(),
    costAudit({ onlyNegative: true, limit: 20 }),
    costAuditSummary(),
  ]);

  return {
    as_of: new Date().toISOString(),
    command_centre: commandCentre,
    inventory: {
      summary: inventory.summary,
      top_risk: inventory.rows
        .filter((row) => row.stock_status !== 'healthy')
        .sort((a, b) => (a.cover_days ?? -1) - (b.cover_days ?? -1))
        .slice(0, 20),
    },
    reorder_alerts: reorders,
    negative_margin_listings: margins.rows,
    channel_margin_summary: marginSummary,
  };
}

export async function answerOps(message: string, history: { role: string; content: string }[] = []) {
  const question = message.trim();
  if (!question) throw new Error('message is required');

  const context = await opsContext();
  if (!hasLlm()) {
    return `${FALLBACK}\n\nCurrent high-priority alerts: ${context.reorder_alerts.length} reorder alerts and ${context.negative_margin_listings.length} negative-margin listings.`;
  }

  const response = await chat(
    `You are Tash Bags Ops, an internal operations analyst for a handcrafted Indian bag business. ` +
      `Use only the supplied business context. Answer directly in under 500 words. ` +
      `Prioritize concrete next actions, cite the relevant SKU/metric, and use INR formatting. ` +
      `Never invent data. You are read-only: do not claim to have changed stock, prices, orders, or campaigns. ` +
      `If the context is insufficient, say exactly what data is missing.`,
    `${question}\n\nBUSINESS CONTEXT:\n${JSON.stringify(context)}`,
    history,
  );

  return response ?? FALLBACK;
}

export async function opsHistory(sessionId: string, limit = 50) {
  const { rows } = await import('../db/pool.js').then(({ query }) => query(
    `SELECT role, content FROM ops_conversations WHERE session_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [sessionId, limit],
  ));
  return rows.reverse();
}

export async function rememberOps(sessionId: string, role: 'user' | 'assistant', content: string) {
  const { query } = await import('../db/pool.js');
  await query(`INSERT INTO ops_conversations (session_id, role, content) VALUES ($1,$2,$3)`, [sessionId, role, content]);
}
