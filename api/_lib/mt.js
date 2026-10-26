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

// Invoice numbers: the first is AXS78953, every one after is AXS plus a random 5-digit number. Never repeats.
export async function nextInvoiceNo() {
  const rows = await sb('mt_invoices?select=invoice_no&invoice_no=like.AXS*&limit=5000', { prefer: 'return=representation' });
  const used = new Set((rows || []).map((r) => r.invoice_no));
  if (!used.has('AXS78953')) return 'AXS78953';
  for (let i = 0; i < 200; i++) {
    const n = 'AXS' + String(10000 + Math.floor(Math.random() * 90000));
    if (!used.has(n)) return n;
  }
  throw new Error('Could not generate a unique invoice number');
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

// Sends a text through GoHighLevel (the account's own number). Reuses the contact with that phone, or creates one.
export async function ghlSendText({ to, name, message, attachments }) {
  const ghlToken = process.env.GHL_TOKEN, ghlLoc = process.env.GHL_LOCATION_ID;
  if (!ghlToken || !ghlLoc) throw new Error('GHL_TOKEN and GHL_LOCATION_ID are not configured.');
  const H = { Authorization: `Bearer ${ghlToken}`, 'Content-Type': 'application/json', Version: '2021-07-28', Accept: 'application/json' };
  let contactId = null;
  const q = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${ghlLoc}&query=${encodeURIComponent(to)}&limit=5`, { headers: H });
  if (q.ok) {
    const qj = await q.json().catch(() => ({}));
    const hit = (qj.contacts || []).find((c) => String(c.phone || '').replace(/\D/g, '').endsWith(to.slice(-10)));
    if (hit) contactId = hit.id;
  }
  if (!contactId) {
    const [firstName, ...rest] = String(name).trim().split(/\s+/);
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: H,
      body: JSON.stringify({ locationId: ghlLoc, firstName, lastName: rest.join(' ') || '-', phone: to, tags: ['Money Tracker'], source: 'brysonhunter.com/moneytracker' }),
    });
    const uj = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(`GHL contact error: ${uj.message || up.status}`);
    contactId = (uj.contact && uj.contact.id) || uj.id;
  }
  if (!contactId) throw new Error('GHL did not return a contact id');
  const body = { type: 'SMS', contactId, message };
  if (attachments && attachments.length) body.attachments = attachments;
  const m = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const mj = await m.json().catch(() => ({}));
  if (!m.ok) throw new Error(`GHL rejected the message: ${mj.message || m.status}`);
  const messageId = mj.messageId || mj.id || (mj.message && mj.message.id) || null;
  let status = 'queued';
  if (messageId) {
    await new Promise((r) => setTimeout(r, 3000));
    const g = await fetch(`https://services.leadconnectorhq.com/conversations/messages/${messageId}`, { headers: H });
    const gj = g.ok ? await g.json().catch(() => ({})) : {};
    status = (gj.message && gj.message.status) || gj.status || status;
  }
  return { messageId, status, contactId };
}

// Mirrors a Money Tracker text into MHG Command (Axis Chems workspace) so it shows in Command's Messages and the
// contact's communication log. Best-effort: never throws, never blocks the send. Needs MHG_SERVICE_KEY.
const CMD_URL = 'https://rafgdywjvijiqnampsha.supabase.co/rest/v1/';
const AXIS_ENTITY = '351b7c4a-bbcf-4d45-b5c2-3227606541e3';
export async function logToCommand({ name, phone, ghlContactId, logId, messageId, text, kind, invoiceNo, status }) {
  try {
    const key = process.env.MHG_SERVICE_KEY;
    if (!key || !ghlContactId) return;
    const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const get = async (q) => { const r = await fetch(CMD_URL + q, { headers: H }); return r.ok ? r.json() : []; };
    let hit = await get(`contacts?select=id,entity_id&ghl_contact_id=eq.${encodeURIComponent(ghlContactId)}&limit=1`);
    let contactId = hit[0] && hit[0].id;
    if (hit[0] && hit[0].entity_id !== AXIS_ENTITY) return; // already a contact in another company: do not mix
    if (!contactId) {
      const r = await fetch(CMD_URL + 'contacts', { method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify({ name, phone, entity_id: AXIS_ENTITY, network_role: 'customer', stage: 'active', ghl_contact_id: ghlContactId, source: 'Money Tracker' }) });
      const j = await r.json().catch(() => []);
      contactId = j[0] && j[0].id;
    }
    if (!contactId) return;
    await fetch(CMD_URL + 'communications?on_conflict=dedupe_key', { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ entity_id: AXIS_ENTITY, contact_id: contactId, channel: 'sms', direction: 'outbound',
        summary: `${kind} text ${invoiceNo || ''} (Money Tracker, ${status || 'sent'})`, full_text: text, occurred_at: new Date().toISOString(),
        source_account: 'ghl', logged_by: 'auto', importance: 'low', dedupe_key: 'mt:' + logId, external_id: messageId }) });
  } catch (e) { console.error('[logToCommand]', e); }
}
