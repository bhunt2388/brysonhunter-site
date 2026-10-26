// Sends a "payment received" confirmation (email via Resend, or text via GoHighLevel) and logs it to mt_invoices
// with direction 'receipt'. Numbers come from the database. Body: { debtId, paymentId, channel: 'email'|'sms', toEmail | toPhone }
import { BRAND_NAMES, PAY_LINKS, fmt, escapeHtml, sb, getSnapshot, newInvoiceId, todayLong, toE164, ghlSendText, logToCommand } from './_lib/mt.js';
import { THEMES } from './send-invoice.js';

function receiptHtml({ snap, pay, reference, remaining }) {
  const T = THEMES[snap.brand] || THEMES.bryson;
  const name = escapeHtml(snap.name);
  const paidOff = remaining <= 0.004;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0; padding:0; background:${T.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.bg}; padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px; background:${T.card}; border:1px solid ${T.line}; border-radius:16px; overflow:hidden;">
      <tr><td style="padding:34px 32px 22px; text-align:center; border-bottom:2px solid ${T.rule};">
        <img src="${T.logoSrc}" alt="${T.name}" style="display:block; margin:0 auto ${T.upper ? 14 : 0}px; ${T.logoStyle}" />
        ${T.upper ? `<div style="color:${T.accent}; font-family:${T.display}; font-size:13px; letter-spacing:3px; text-transform:uppercase;">${T.name}</div>` : ''}
      </td></tr>
      <tr><td style="padding:28px 32px 26px;">
        <div style="color:${T.accent}; font-family:${T.display}; font-size:28px;">Payment received</div>
        <div style="color:${T.dim}; font-size:13px; margin:4px 0 22px;">${todayLong()}</div>
        <div style="color:${T.text}; font-size:16px; line-height:1.5; margin-bottom:20px;">Hi ${name.split(' ')[0]}, thank you. We received your payment.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
          <tr><td style="color:${T.muted}; font-size:13px; text-transform:uppercase; letter-spacing:1px; padding:6px 0;">Amount received</td><td style="text-align:right; color:${T.green}; font-family:${T.display}; font-size:30px; font-weight:700;">${fmt(pay.amount)}</td></tr>
          <tr><td style="color:${T.muted}; font-size:13px; padding:6px 0;">Payment date</td><td style="text-align:right; color:${T.text}; font-size:14px;">${escapeHtml(pay.date)}</td></tr>
          ${reference ? `<tr><td style="color:${T.muted}; font-size:13px; padding:6px 0;">Reference</td><td style="text-align:right; color:${T.text}; font-size:14px; font-weight:700;">${reference}</td></tr>` : ''}
          <tr><td style="color:${T.muted}; font-size:13px; padding:6px 0; border-top:1px solid ${T.line};">Remaining balance</td><td style="text-align:right; color:${paidOff ? T.green : T.accent}; font-size:16px; font-weight:700; border-top:1px solid ${T.line};">${paidOff ? 'Paid in full' : fmt(remaining)}</td></tr>
        </table>
        <div style="color:${T.dim}; font-size:12px; line-height:1.5; margin-top:18px;">Keep this message for your records. Questions? Reply to this message.</div>
      </td></tr>
      <tr><td style="padding:22px 32px; background:${T.foot}; text-align:center; border-top:1px solid ${T.line};"><div style="color:${T.muted}; font-size:12px; font-weight:600;">${T.name}</div></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const { debtId, paymentId, channel, toEmail, toPhone } = body;
  if (!debtId || !paymentId || !['email', 'sms'].includes(channel)) { res.status(400).json({ error: 'Missing required fields: debtId, paymentId, channel' }); return; }
  try {
    const snap = await getSnapshot(debtId);
    const pays = await sb(`mt_payments?select=id,amount,date&id=eq.${encodeURIComponent(paymentId)}&debt_id=eq.${encodeURIComponent(debtId)}`);
    const pay = pays && pays[0];
    if (!pay || Number(pay.amount) <= 0) { res.status(400).json({ error: 'Payment not found, or it is not a payment (corrections cannot be confirmed).' }); return; }
    pay.amount = Number(pay.amount);
    // The reference is the client's permanent invoice number (same one on every invoice and receipt).
    const reference = snap.invoiceNo || '';
    const remaining = snap.balance;
    const brandName = BRAND_NAMES[snap.brand];
    const id = newInvoiceId();
    const row = { id, debt_id: debtId, amount: pay.amount, status: 'queued', channel: channel === 'email' ? 'email' : 'sms', direction: 'receipt', brand: snap.brand, invoice_no: reference || null, debtor_name: snap.name, paid_amount: snap.paid, original_amount: snap.original, borrowed_amount: snap.borrowed };

    if (channel === 'email') {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) { res.status(500).json({ error: 'RESEND_API_KEY not configured on the server yet.' }); return; }
      if (!toEmail) { res.status(400).json({ error: 'Missing toEmail' }); return; }
      const fromEnv = process.env.INVOICE_FROM || 'Bryson Hunter <billing@brysonhunter.com>';
      const from = snap.brand === 'axis' ? fromEnv.replace(/^[^<]*</, 'Axis Chems <') : fromEnv;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [toEmail], subject: `Payment received: ${fmt(pay.amount)}${reference ? ' (' + reference + ')' : ''}`, html: receiptHtml({ snap, pay, reference, remaining }) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: 'Resend send failed', detail: j }); return; }
      await sb('mt_invoices', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ ...row, to_email: toEmail, status: 'sent', resend_id: j.id || null, source_account: 'resend' }) }).catch((e) => console.error('[receipt] log failed', e));
      res.status(200).json({ status: 'sent', channel: 'email' });
      return;
    }

    const to = toE164(toPhone);
    if (!to) { res.status(400).json({ error: `Could not read "${toPhone}" as a US phone number.` }); return; }
    const first = snap.name.split(' ')[0];
    const text = [
      `Hi ${first}, ${brandName} here. Payment received: ${fmt(pay.amount)} on ${pay.date}. Thank you.`,
      reference ? `Reference: ${reference}` : null,
      remaining > 0.004 ? `Remaining balance: ${fmt(remaining)}.` : 'Your balance is paid in full.',
      'Reply STOP to opt out.',
    ].filter(Boolean).join('\n');
    await sb('mt_invoices', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ ...row, to_phone: to, body: text, source_account: 'ghl' }) });
    try {
      const out = await ghlSendText({ to, name: snap.name, message: text });
      await sb(`mt_invoices?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ twilio_sid: out.messageId, status: out.status, status_updated_at: new Date().toISOString() }) }).catch(() => {});
      await logToCommand({ name: snap.name, phone: to, ghlContactId: out.contactId, logId: id, messageId: out.messageId, text, kind: 'Receipt', invoiceNo: reference, status: out.status });
      res.status(200).json({ status: out.status, channel: 'sms' });
    } catch (e) {
      await sb(`mt_invoices?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'failed', error: String(e.message).slice(0, 300), status_updated_at: new Date().toISOString() }) }).catch(() => {});
      res.status(502).json({ error: String(e.message || e) });
    }
  } catch (err) {
    console.error('[send-receipt] error:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
}
