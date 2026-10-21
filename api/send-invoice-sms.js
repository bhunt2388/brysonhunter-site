// Sends the branded invoice as an MMS (PNG + payment links) through GoHighLevel (the account's own number),
// falling back to Twilio only when GHL env vars are absent. Logs every send to mt_invoices (channel 'mms'); delivery status arrives via
// /api/twilio-status and updates the same row.
//
// Env vars: GHL_TOKEN, GHL_LOCATION_ID (preferred). Legacy: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM

import { API_BASE, BRAND_NAMES, PAY_LINKS, fmt, sb, getSnapshot, nextInvoiceNo, newInvoiceId, toE164 } from './_lib/mt.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const { debtId, toPhone, dueNote } = body;
  if (!debtId || !toPhone) { res.status(400).json({ error: 'Missing required fields: debtId, toPhone' }); return; }

  const ghlToken = process.env.GHL_TOKEN, ghlLoc = process.env.GHL_LOCATION_ID;
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  const useGhl = !!(ghlToken && ghlLoc);
  if (!useGhl && (!sid || !token || !from)) { res.status(500).json({ error: 'No SMS provider configured (set GHL_TOKEN and GHL_LOCATION_ID).' }); return; }
  const to = toE164(toPhone);
  if (!to) { res.status(400).json({ error: `Could not read "${toPhone}" as a US phone number.` }); return; }

  let snap, invoiceNo, id;
  try {
    snap = await getSnapshot(debtId);
    if (snap.balance <= 0) { res.status(400).json({ error: `${snap.name} has no outstanding balance.` }); return; }
    invoiceNo = await nextInvoiceNo();
    id = newInvoiceId();
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); return; }

  const first = snap.name.split(' ')[0];
  const mediaUrl = `${API_BASE}/api/invoice-image?id=${id}`;
  const text = [
    `Hi ${first}, this is ${BRAND_NAMES[snap.brand]}. Invoice ${invoiceNo}: ${fmt(snap.balance)} due.${dueNote ? ' ' + dueNote : ''}`,
    `Venmo: ${PAY_LINKS.venmoShort}`,
    `Cash App: ${PAY_LINKS.cashappShort}`,
    `PayPal: ${PAY_LINKS.paypalShort}`,
    `Zelle: ${PAY_LINKS.zelleTag}`,
    `Reply STOP to opt out.`,
  ].join('\n');

  const row = {
    id, debt_id: debtId, amount: snap.balance, to_email: null, to_phone: to, status: 'queued', channel: 'mms',
    direction: 'outbound', source_account: useGhl ? 'ghl' : 'twilio', brand: snap.brand, invoice_no: invoiceNo, debtor_name: snap.name,
    original_amount: snap.original, borrowed_amount: snap.borrowed, paid_amount: snap.paid, items: snap.lines, body: text, media_url: mediaUrl,
  };
  // Log first so the image URL resolves when Twilio fetches it.
  try { await sb('mt_invoices', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(row) }); }
  catch (e) { res.status(500).json({ error: 'Could not log invoice: ' + String(e.message || e) }); return; }

  if (useGhl) {
    const H = { Authorization: `Bearer ${ghlToken}`, 'Content-Type': 'application/json', Version: '2021-07-28', Accept: 'application/json' };
    const fail = async (msg, code) => {
      await sb(`mt_invoices?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'failed', error: String(msg).slice(0, 300), status_updated_at: new Date().toISOString() }) }).catch(() => {});
      res.status(502).json({ error: msg, code });
    };
    try {
      // Reuse the GHL contact with this phone number if one exists; otherwise create it.
      let contactId = null;
      const q = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${ghlLoc}&query=${encodeURIComponent(to)}&limit=5`, { headers: H });
      if (q.ok) {
        const qj = await q.json().catch(() => ({}));
        const hit = (qj.contacts || []).find((c) => String(c.phone || '').replace(/\D/g, '').endsWith(to.slice(-10)));
        if (hit) contactId = hit.id;
      }
      if (!contactId) {
        const [firstName, ...rest] = snap.name.trim().split(/\s+/);
        const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method: 'POST', headers: H,
          body: JSON.stringify({ locationId: ghlLoc, firstName, lastName: rest.join(' ') || '-', phone: to, tags: ['Money Tracker'], source: 'brysonhunter.com/moneytracker' }),
        });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok) { await fail(`GHL contact error: ${uj.message || up.status}`, up.status); return; }
        contactId = (uj.contact && uj.contact.id) || uj.id;
      }
      if (!contactId) { await fail('GHL did not return a contact id', 0); return; }
      const m = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers: H,
        body: JSON.stringify({ type: 'SMS', contactId, message: text, attachments: [mediaUrl] }),
      });
      const mj = await m.json().catch(() => ({}));
      if (!m.ok) { await fail(`GHL rejected the message: ${mj.message || m.status}`, m.status); return; }
      const messageId = mj.messageId || mj.id || (mj.message && mj.message.id) || null;
      // Look the message up so the log reflects what GHL actually did, not just that it accepted the request.
      let status = 'queued';
      if (messageId) {
        await new Promise((r) => setTimeout(r, 3000));
        const g = await fetch(`https://services.leadconnectorhq.com/conversations/messages/${messageId}`, { headers: H });
        const gj = g.ok ? await g.json().catch(() => ({})) : {};
        status = (gj.message && gj.message.status) || gj.status || status;
      }
      await sb(`mt_invoices?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ twilio_sid: messageId, status, status_updated_at: new Date().toISOString() }) }).catch((e) => console.error('[sms] log patch failed', e));
      res.status(200).json({ status, invoiceNo, messageId });
    } catch (err) {
      console.error('[send-invoice-sms] ghl error:', err);
      await fail(String(err.message || err), 0);
    }
    return;
  }

  try {
    const params = new URLSearchParams({
      To: to, From: from, Body: text, MediaUrl: mediaUrl, StatusCallback: `${API_BASE}/api/twilio-status`,
    });
    const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const j = await tw.json().catch(() => ({}));
    if (!tw.ok) {
      await sb(`mt_invoices?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'failed', error: `${j.code || tw.status}: ${j.message || 'Twilio error'}`, status_updated_at: new Date().toISOString() }) }).catch(() => {});
      res.status(502).json({ error: `Twilio rejected the message: ${j.message || tw.status}`, code: j.code });
      return;
    }
    await sb(`mt_invoices?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ twilio_sid: j.sid, status: j.status || 'queued', status_updated_at: new Date().toISOString() }) }).catch((e) => console.error('[sms] log patch failed', e));
    res.status(200).json({ status: j.status || 'queued', invoiceNo, sid: j.sid });
  } catch (err) {
    console.error('[send-invoice-sms] error:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
}
