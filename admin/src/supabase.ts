import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://eithqrpmnriaqvlfxwji.supabase.co';
// Publishable keys are safe in browser code; deployments can override this with an env var.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_YGVQiUccX0b2P8fmWNgSTw_VYNinPlk';

export const supabase = key ? createClient(url, key) : null;
export const supabaseConfigured = Boolean(key);
export const ownerEmail = 'thetashbags@gmail.com';
export const authorizedEmails = [ownerEmail, 'chariotrealty@gmail.com'];
export const isAuthorizedEmail = (email?: string | null) => authorizedEmails.includes((email ?? '').toLowerCase());
