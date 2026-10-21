// Sends the branded invoice as an MMS (PNG + payment links) through Twilio, from the same number the
// MHG Command app uses. Logs every send to mt_invoices (channel 'mms'); delivery status arrives via
// /api/twilio-status and updates the same row.
//
// Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (E.164, the Command app number)

import { SITE_URL, PAY_LINKS, fmt, sb, getSnapshot, nextInvoiceNo, newInvoiceId, toE164 } from './_lib/mt.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const { debtId, toPhone, dueNote } = body;
  if (!debtId || !toPhone) { res.status(400).json({ error: 'Missing required fields: debtId, toPhone' }); return; }

  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) { res.status(500).json({ error: 'Twilio is not configured yet (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).' }); return; }
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
  const mediaUrl = `${SITE_URL}/api/invoice-image?id=${id}`;
  const text = [
    `Hi ${first}, this is Bryson Hunter. Invoice ${invoiceNo}: ${fmt(snap.balance)} due.${dueNote ? ' ' + dueNote : ''}`,
    `Venmo: ${PAY_LINKS.venmoShort}`,
    `Cash App: ${PAY_LINKS.cashappShort}`,
    `PayPal: ${PAY_LINKS.paypalShort}`,
    `Zelle: ${PAY_LINKS.zelleTag}`,
    `Reply STOP to opt out.`,
  ].join('\n');

  const row = {
    id, debt_id: debtId, amount: snap.balance, to_email: null, to_phone: to, status: 'queued', channel: 'mms',
    direction: 'outbound', source_account: 'twilio', invoice_no: invoiceNo, debtor_name: snap.name,
    original_amount: snap.original, borrowed_amount: snap.borrowed, paid_amount: snap.paid, body: text, media_url: mediaUrl,
  };
  // Log first so the image URL resolves when Twilio fetches it.
  try { await sb('mt_invoices', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(row) }); }
  catch (e) { res.status(500).json({ error: 'Could not log invoice: ' + String(e.message || e) }); return; }

  try {
    const params = new URLSearchParams({
      To: to, From: from, Body: text, MediaUrl: mediaUrl, StatusCallback: `${SITE_URL}/api/twilio-status`,
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
