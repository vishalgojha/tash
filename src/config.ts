import 'dotenv/config';

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://tashbags:tashbags@localhost:5432/tashbags',
  storefrontUrl: (process.env.SHOPIFY_STOREFRONT_URL ?? 'https://tashbags.com').replace(/\/$/, ''),
  adminToken: process.env.SHOPIFY_ADMIN_TOKEN ?? '',
  myshopifyDomain: process.env.SHOPIFY_MYSHOPIFY_DOMAIN ?? 'tashbags.myshopify.com',
  adminApiVersion: process.env.SHOPIFY_ADMIN_API_VERSION ?? '2026-01',
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  syncCron: (process.env.SYNC_CRON ?? '0 */4 * * *').trim(),
  wahaApiUrl: (process.env.WAHA_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  wahaApiKey: process.env.WAHA_API_KEY ?? '',
  wahaSession: process.env.WAHA_SESSION ?? 'default',
  agentOwnerPhones: (process.env.AGENT_OWNER_PHONES ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\D/g, ''))
    .filter(Boolean),
  agentLaptopAlert: (process.env.AGENT_LAPTOP_ALERT ?? 'false') === 'true',
  agentBusinessFacts: (process.env.AGENT_BUSINESS_FACTS ?? '').split(';').filter(Boolean),
  shiprocketEmail: process.env.SHIPROCKET_EMAIL ?? '',
  shiprocketPassword: process.env.SHIPROCKET_PASSWORD ?? '',
};

export const hasAdminAccess = () => env.adminToken.length > 0;
export const hasShiprocket = () => env.shiprocketEmail.length > 0 && env.shiprocketPassword.length > 0;
export const hasWaha = () => env.wahaApiUrl.length > 0;

export function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}