// Shared helpers for the Money Tracker API routes (email invoice, MMS invoice, Twilio status).
export const SB_URL = 'https://udirnxilxlvhkzbgpjke.supabase.co';
export const SB_KEY = 'sb_publishable_7SGeCmx1XATdHTawyT6hHw_iWV9-1Vz';
export const SITE_URL = 'https://brysonhunter.com';
// Apex redirects (307) to www, and Twilio needs a direct URL for media and status callbacks.
export const API_BASE = 'https://www.brysonhunter.com';

export const PAY_LINKS = {
  venmo: 'https://www.venmo.com/u/bhunt2388',
  venmoShort: 'venmo.com/u/bhunt2388',
  cashapp: 'https://cash.app/$bhunt23',
  cashappShort: 'cash.app/$bhunt23',
  paypal: 'https://paypal.me/BrysonHunter801',
  paypalShort: 'paypal.me/BrysonHunter801',
  zelleTag: 'Brysonhunter',
  applecashNumber: '8014002916',
};

export const BRAND_NAMES = { bryson: 'Bryson Hunter', axis: 'Axis Chems' };

export function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function sb(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${opts.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Authoritative numbers come from the database, never from the browser.
export async function getSnapshot(debtId) {
  const id = encodeURIComponent(debtId);
  const [debtors, pays, borrows] = await Promise.all([
    sb(`mt_debtors?select=id,name,original_amount,brand&id=eq.${id}`),
    sb(`mt_payments?select=amount&debt_id=eq.${id}`),
    sb(`mt_borrows?select=amount&debt_id=eq.${id}`),
  ]);
  const d = debtors[0];
  if (!d) throw new Error('Debtor not found');
  const original = Number(d.original_amount);
  const borrowed = borrows.reduce((s, b) => s + Number(b.amount), 0);
  const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(original + borrowed - paid, 0);
  return { debtId: d.id, name: d.name, original, borrowed, paid, balance, brand: d.brand === 'axis' ? 'axis' : 'bryson' };
}

export async function nextInvoiceNo() {
  const res = await fetch(`${SB_URL}/rest/v1/mt_invoices?select=id`, {
    method: 'HEAD',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range') || '*/0';
  const count = parseInt(range.split('/')[1], 10) || 0;
  return 'INV-' + String(1001 + count);
}

export function newInvoiceId() {
  return 'inv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

export function todayLong() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Boise' });
}

export function toE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (String(raw).trim().startsWith('+') && digits.length >= 11) return '+' + digits;
  return null;
}
