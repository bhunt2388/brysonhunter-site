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
  // POST/PATCH with Prefer: return=minimal answers 201/200 with an empty body.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Authoritative numbers come from the database, never from the browser.
export async function getSnapshot(debtId) {
  const id = encodeURIComponent(debtId);
  const [debtors, pays, borrows, itemRows] = await Promise.all([
    sb(`mt_debtors?select=id,name,original_amount,brand&id=eq.${id}`),
    sb(`mt_payments?select=amount&debt_id=eq.${id}`),
    sb(`mt_borrows?select=amount&debt_id=eq.${id}`),
    sb(`mt_items?select=description,qty,unit_price&debt_id=eq.${id}&order=created_at.asc`),
  ]);
  const d = debtors[0];
  if (!d) throw new Error('Debtor not found');
  const original = Number(d.original_amount);
  const borrowed = borrows.reduce((s, b) => s + Number(b.amount), 0);
  const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  const balance = Math.max(original + borrowed - paid, 0);
  const items = itemRows.map((i) => ({ description: i.description, qty: Number(i.qty), unit: Number(i.unit_price) }));
  const snap = { debtId: d.id, name: d.name, original, borrowed, paid, balance, brand: d.brand === 'axis' ? 'axis' : 'bryson', items };
  snap.lines = invoiceLines(snap);
  return snap;
}

// Display lines for an invoice. Line items are already counted inside the debtor's original amount,
// so any remainder (older balance with no itemization) shows as its own line.
// kind: 'credit' renders green (payments, discounts).
export function invoiceLines(snap) {
  const lines = [];
  let itemsTotal = 0;
  for (const it of snap.items || []) {
    const total = Math.round(it.qty * it.unit * 100) / 100;
    itemsTotal += total;
    const label = it.qty !== 1 ? `${it.description} (${it.qty} x ${fmt(it.unit)})` : it.description;
    lines.push(total < 0 ? { label, value: '- ' + fmt(Math.abs(total)), kind: 'credit' } : { label, value: fmt(total), kind: 'neutral' });
  }
  const rest = Math.round((snap.original - itemsTotal) * 100) / 100;
  if (!lines.length) lines.push({ label: 'Original balance', value: fmt(snap.original), kind: 'neutral' });
  else if (rest > 0.004) lines.unshift({ label: 'Previous balance', value: fmt(rest), kind: 'neutral' });
  if (snap.borrowed > 0) lines.push({ label: 'Additional borrowed', value: '+ ' + fmt(snap.borrowed), kind: 'neutral' });
  if (snap.paid > 0) lines.push({ label: 'Payments received', value: '- ' + fmt(snap.paid), kind: 'credit' });
  return lines;
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
