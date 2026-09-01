// Vercel serverless function: sends a branded, designed invoice email with
// payment links (Venmo, CashApp, PayPal, Zelle, Apple Cash) via Resend.
// Called by moneytracker/index.html's "Send Invoice" button.
//
// Env vars required (set in Vercel project settings):
//   RESEND_API_KEY      — Resend API key (send-only scope is fine)
//   INVOICE_FROM        — sending address, e.g. "Bryson Hunter <billing@brysonhunter.com>"
//
// Also writes a row to mt_invoices (Supabase) so the send is logged in the debtor's history.

const SB_URL = 'https://udirnxilxlvhkzbgpjke.supabase.co';
const SB_KEY = 'sb_publishable_7SGeCmx1XATdHTawyT6hHw_iWV9-1Vz';

const PAY_LINKS = {
  venmo: 'https://www.venmo.com/u/bhunt2388',
  cashapp: 'https://cash.app/$bhunt23',
  paypal: 'https://paypal.me/BrysonHunter801',
  zelle: 'Brysonhunter', // Zelle has no universal deep link — shown as a tag to search for in your banking app
  applecash: '8014002916', // Apple Cash is P2P via Messages/Contacts only — shown as a number, not a link
};

function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildInvoiceHtml({ debtorName, amount, dueNote }) {
  const amountStr = fmt(amount);
  const safeDebtorName = escapeHtml(debtorName);
  const safeDueNote = dueNote ? escapeHtml(dueNote) : '';

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background:#0b0d10; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d10; padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px; background:#14171c; border:1px solid #262b33; border-radius:16px; overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 24px; border-bottom:1px solid #262b33;">
              <div style="color:#8a92a0; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Invoice</div>
              <div style="color:#eef1f4; font-size:22px; font-weight:700;">Payment Requested</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <div style="color:#8a92a0; font-size:13px; margin-bottom:4px;">Billed to</div>
              <div style="color:#eef1f4; font-size:17px; font-weight:600; margin-bottom:20px;">${safeDebtorName}</div>

              <div style="color:#8a92a0; font-size:13px; margin-bottom:4px;">Amount Due</div>
              <div style="color:#facc15; font-size:34px; font-weight:800; margin-bottom:${safeDueNote ? '10px' : '24px'};">${amountStr}</div>
              ${safeDueNote ? `<div style="color:#8a92a0; font-size:13px; font-style:italic; margin-bottom:24px;">${safeDueNote}</div>` : ''}

              <div style="color:#8a92a0; font-size:13px; text-transform:uppercase; letter-spacing:.5px; margin-bottom:14px;">Pay With</div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:10px;">
                    <a href="${PAY_LINKS.venmo}" style="display:block; text-align:center; background:#3D95CE; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; padding:14px; border-radius:10px;">Pay with Venmo</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:10px;">
                    <a href="${PAY_LINKS.cashapp}" style="display:block; text-align:center; background:#00D632; color:#04310f; text-decoration:none; font-weight:700; font-size:15px; padding:14px; border-radius:10px;">Pay with Cash App</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:10px;">
                    <a href="${PAY_LINKS.paypal}" style="display:block; text-align:center; background:#0070BA; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; padding:14px; border-radius:10px;">Pay with PayPal</a>
                  </td>
                </tr>
              </table>

              <div style="margin-top:18px; padding-top:18px; border-top:1px solid #262b33;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:#8a92a0; font-size:13px; padding:6px 0;">Zelle</td>
                    <td style="color:#eef1f4; font-size:13px; text-align:right; padding:6px 0;">${PAY_LINKS.zelle}</td>
                  </tr>
                  <tr>
                    <td style="color:#8a92a0; font-size:13px; padding:6px 0;">Apple Cash</td>
                    <td style="color:#eef1f4; font-size:13px; text-align:right; padding:6px 0;">${PAY_LINKS.applecash}</td>
                  </tr>
                </table>
                <div style="color:#8a92a0; font-size:11.5px; margin-top:10px; line-height:1.5;">
                  Zelle and Apple Cash don't support clickable payment links — search the tag/number above in your banking app or Messages.
                </div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px; background:#0f1115; text-align:center;">
              <div style="color:#8a92a0; font-size:11.5px;">Sent via Bryson Hunter · Money Tracker</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

async function sbInsert(table, row) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase insert failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const { debtId, debtorName, amount, toEmail, dueNote } = body;

  if (!debtId || !debtorName || !amount || !toEmail) {
    res.status(400).json({ error: 'Missing required fields: debtId, debtorName, amount, toEmail' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'RESEND_API_KEY not configured on the server yet.' });
    return;
  }

  const from = process.env.INVOICE_FROM || 'Bryson Hunter <billing@brysonhunter.com>';
  const html = buildInvoiceHtml({ debtorName, amount, dueNote });

  try {
    const sendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject: `Invoice — ${fmt(amount)} due`,
        html,
      }),
    });

    const sendJson = await sendResp.json().catch(() => ({}));

    if (!sendResp.ok) {
      res.status(502).json({ error: 'Resend send failed', detail: sendJson });
      return;
    }

    // Log the invoice send to Supabase (best-effort — don't fail the response if this errors)
    try {
      await sbInsert('mt_invoices', {
        id: 'inv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        debt_id: debtId,
        amount,
        to_email: toEmail,
        status: 'sent',
        resend_id: sendJson.id || null,
      });
    } catch (logErr) {
      console.error('[send-invoice] failed to log invoice to Supabase:', logErr);
    }

    res.status(200).json({ status: 'sent', resendId: sendJson.id || null });
  } catch (err) {
    console.error('[send-invoice] error:', err);
    res.status(500).json({ error: String(err) });
  }
}
