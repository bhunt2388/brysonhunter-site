// Vercel serverless function: sends a branded invoice email (itemized, numbered, with payment links) via Resend.
// Called by moneytracker/index.html's "Email Invoice" button.
//
// Env vars: RESEND_API_KEY, INVOICE_FROM (e.g. "Bryson Hunter <billing@brysonhunter.com>")
// Numbers come from Supabase (not the browser). Every send is logged to mt_invoices.

import { LOGO_DATA_URI } from './_lib/logo.js';
import { AXIS_LOGO_DATA_URI } from './_lib/axis-logo.js';
import { SITE_URL, BRAND_NAMES, PAY_LINKS, fmt, escapeHtml, sb, getSnapshot, getInvoiceNo, newInvoiceId, todayLong } from './_lib/mt.js';

export const THEMES = {
  bryson: { bg: '#131110', card: '#1c1815', line: '#2f2a22', accent: '#C9A961', rule: '#8B6F35', text: '#f2ede2', muted: '#b4ab97', dim: '#756d5b', foot: '#161410', green: '#7fd39a',
    display: "Georgia,'Times New Roman',serif", name: 'Bryson Hunter Enterprises', site: 'brysonhunter.com', siteUrl: SITE_URL, logoSrc: LOGO_DATA_URI, logoStyle: 'width:92px;border-radius:8px;', upper: true },
  axis: { bg: '#EEF3FA', card: '#ffffff', line: '#DCE5F2', accent: '#0B4CB8', rule: '#0B4CB8', text: '#0E1B33', muted: '#4A5B78', dim: '#7A889F', foot: '#F6F9FD', green: '#1a8f4c',
    display: "'Manrope','Helvetica Neue',Helvetica,sans-serif", name: 'Axis Chems', site: 'axischems.com', siteUrl: 'https://axischems.com', logoSrc: AXIS_LOGO_DATA_URI, logoStyle: 'width:220px;', upper: false },
};

function row(T, label, value, color) {
  return `<tr>
    <td style="padding:9px 0; color:${T.muted}; font-size:14px; border-bottom:1px solid ${T.line};">${label}</td>
    <td style="padding:9px 0; color:${color || T.text}; font-size:14px; font-weight:600; text-align:right; border-bottom:1px solid ${T.line};">${value}</td>
  </tr>`;
}

export function buildInvoiceHtml({ invoiceNo, issued, snap, dueNote }) {
  const T = THEMES[snap.brand] || THEMES.bryson;
  const safeName = escapeHtml(snap.name);
  const safeDueNote = dueNote ? escapeHtml(dueNote) : '';
  const lines = (snap.lines || []).map((l) => row(T, escapeHtml(l.label), l.value, l.kind === 'credit' ? T.green : undefined));

  const btn = (href, bg, fg, label) => `<tr><td style="padding-bottom:10px;"><a href="${href}" style="display:block; text-align:center; background:${bg}; color:${fg}; text-decoration:none; font-weight:700; font-size:15px; padding:14px; border-radius:10px;">${label}</a></td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0; padding:0; background:${T.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.bg}; padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px; background:${T.card}; border:1px solid ${T.line}; border-radius:16px; overflow:hidden;">
      <tr><td style="padding:34px 32px 22px; text-align:center; border-bottom:2px solid ${T.rule};">
        <img src="${T.logoSrc}" alt="${T.name}" style="display:block; margin:0 auto ${T.upper ? 14 : 0}px; ${T.logoStyle}" />
        ${T.upper ? `<div style="color:${T.accent}; font-family:${T.display}; font-size:13px; letter-spacing:3px; text-transform:uppercase;">${T.name}</div>` : ''}
        ${T.siteUrl ? `<a href="${T.siteUrl}" style="color:${T.dim}; font-size:12px; text-decoration:none; letter-spacing:.5px;">${T.site}</a>` : ''}
      </td></tr>
      <tr><td style="padding:28px 32px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><div style="color:${T.accent}; font-family:${T.display}; font-size:28px;">Invoice</div></td>
          <td style="text-align:right; vertical-align:bottom;"><div style="color:${T.text}; font-size:14px; font-weight:700;">${invoiceNo}</div><div style="color:${T.dim}; font-size:12px;">${issued}</div></td>
        </tr></table>
        <div style="color:${T.dim}; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin:24px 0 4px;">Billed to</div>
        <div style="color:${T.text}; font-size:18px; font-weight:600; margin-bottom:22px;">${safeName}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">${lines.join('')}</table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 6px;"><tr>
          <td style="color:${T.muted}; font-size:13px; text-transform:uppercase; letter-spacing:1px;">Amount due</td>
          <td style="text-align:right; color:${T.accent}; font-family:${T.display}; font-size:36px; font-weight:700;">${fmt(snap.balance)}</td>
        </tr></table>
        <div style="color:${T.text}; font-size:13px; margin:2px 0 8px;">Payment reference: <b>${invoiceNo}</b></div>
        ${safeDueNote ? `<div style="color:${T.dim}; font-size:13px; font-style:italic; margin-bottom:8px;">${safeDueNote}</div>` : ''}
        <div style="color:${T.dim}; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin:26px 0 14px;">Pay with</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${btn(PAY_LINKS.venmo, '#3D95CE', '#ffffff', 'Pay with Venmo')}
          ${btn(PAY_LINKS.cashapp, '#00D632', '#04310f', 'Pay with Cash App')}
          ${btn(PAY_LINKS.paypal, '#0070BA', '#ffffff', 'Pay with PayPal')}
          <tr><td style="padding-bottom:10px;"><div style="background:#6D1ED4; color:#ffffff; text-align:center; font-weight:700; font-size:15px; padding:14px; border-radius:10px;">Zelle: search <span style="text-decoration:underline;">${PAY_LINKS.zelleTag}</span> in your bank app</div></td></tr>
          <tr><td><div style="background:#000000; color:#ffffff; text-align:center; font-weight:700; font-size:15px; padding:14px; border-radius:10px; border:1px solid #333;">Apple Cash: send to ${PAY_LINKS.applecashNumber}</div></td></tr>
        </table>
        <div style="color:${T.dim}; font-size:11.5px; margin-top:14px; line-height:1.5;">Zelle and Apple Cash do not support clickable links in email. Open your banking app or Messages and use the info above. Payment reference: <b>${invoiceNo}</b>. Please include it with your payment.</div>
      </td></tr>
      <tr><td style="padding:22px 32px; background:${T.foot}; text-align:center; border-top:1px solid ${T.line};">
        <div style="color:${T.muted}; font-size:12px; font-weight:600; margin-bottom:2px;">${T.name}</div>
        ${T.siteUrl ? `<div style="color:${T.dim}; font-size:11px;"><a href="${T.siteUrl}" style="color:${T.dim}; text-decoration:none;">${T.site}</a></div>` : ''}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const { debtId, toEmail, dueNote } = body;
  if (!debtId || !toEmail) { res.status(400).json({ error: 'Missing required fields: debtId, toEmail' }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'RESEND_API_KEY not configured on the server yet.' }); return; }
  const fromEnv = process.env.INVOICE_FROM || 'Bryson Hunter <billing@brysonhunter.com>';

  try {
    const snap = await getSnapshot(debtId);
    const from = snap.brand === 'axis' ? fromEnv.replace(/^[^<]*</, 'Axis Chems <') : fromEnv;
    if (snap.balance <= 0) { res.status(400).json({ error: `${snap.name} has no outstanding balance.` }); return; }
    const invoiceNo = await getInvoiceNo(debtId, snap);
    const html = buildInvoiceHtml({ invoiceNo, issued: todayLong(), snap, dueNote });

    const sendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [toEmail], subject: `${invoiceNo}: ${fmt(snap.balance)} due`, html }),
    });
    const sendJson = await sendResp.json().catch(() => ({}));
    if (!sendResp.ok) { res.status(502).json({ error: 'Resend send failed', detail: sendJson }); return; }

    try {
      await sb('mt_invoices', {
        method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({
          id: newInvoiceId(), debt_id: debtId, amount: snap.balance, to_email: toEmail, status: 'sent',
          resend_id: sendJson.id || null, channel: 'email', direction: 'outbound', source_account: 'resend',
          invoice_no: invoiceNo, brand: snap.brand, items: snap.lines, debtor_name: snap.name, original_amount: snap.original,
          borrowed_amount: snap.borrowed, paid_amount: snap.paid,
        }),
      });
    } catch (logErr) { console.error('[send-invoice] failed to log invoice:', logErr); }

    res.status(200).json({ status: 'sent', invoiceNo, resendId: sendJson.id || null });
  } catch (err) {
    console.error('[send-invoice] error:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
}
