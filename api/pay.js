// Public card payment for a Money Tracker debtor, charged through Luqra (NMI gateway).
// GET ?d=<debtId>  -> invoice summary. POST {d, payment_token, first_name, last_name, address1, city, state, zip, email} -> charge.
// The amount is always the debtor's live balance from Supabase. Only debtors with pay_card = true can be charged.
import { sb, getSnapshot, fmt, PAY_LINKS } from './_lib/mt.js';

const GATEWAY = 'https://luqra.transactiongateway.com/api/transact.php';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const snap = await getSnapshot(String(req.query.d || ''));
      if (!snap.payCard) { res.status(404).json({ error: 'Not available' }); return; }
      res.status(200).json({ name: snap.name, brand: snap.brand, balance: snap.balance, lines: snap.lines, original: snap.original, paid: snap.paid, invoiceNo: snap.invoiceNo, links: PAY_LINKS });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
    const key = process.env.LUQRA_SECURITY_KEY;
    if (!key) { res.status(500).json({ error: 'Card processing is not configured.' }); return; }
    const snap = await getSnapshot(String(b.d || ''));
    if (!snap.payCard) { res.status(404).json({ error: 'Not available' }); return; }
    if (snap.balance <= 0) { res.status(400).json({ error: 'Nothing is due on this invoice.' }); return; }
    const need = b.wallet ? ['payment_token'] : ['payment_token', 'first_name', 'last_name', 'address1', 'city', 'zip'];
    for (const f of need) {
      if (!b[f]) { res.status(400).json({ error: 'Missing ' + f }); return; }
    }
    const amount = snap.balance.toFixed(2);
    const p = new URLSearchParams({
      security_key: key, type: 'sale', payment_token: b.payment_token, amount,
      orderid: 'MT-' + snap.debtId.slice(-24), order_description: 'Axis Chems invoice ' + snap.name,
      first_name: b.first_name || '', last_name: b.last_name || '', address1: b.address1 || '', city: b.city || '', state: b.state || '', zip: b.zip || '',
      email: b.email || '',
    });
    const r = await fetch(GATEWAY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
    const out = Object.fromEntries(new URLSearchParams(await r.text()));
    if (out.response !== '1') { res.status(402).json({ ok: false, message: out.responsetext || 'Card declined' }); return; }
    const today = new Date().toISOString().slice(0, 10);
    const note = 'Card via Luqra, txn ' + out.transactionid;
    try {
      await sb('mt_payments', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ id: 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), debt_id: snap.debtId, amount: Number(amount), date: today, note }) });
      await sb('mt_activity', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ debt_id: snap.debtId, action: 'card_payment', detail: { amount: Number(amount), transactionid: out.transactionid, authcode: out.authcode } }) });
    } catch (e) { console.error('[pay] charged but failed to log', out.transactionid, e); }
    res.status(200).json({ ok: true, transactionid: out.transactionid, amount: fmt(amount) });
  } catch (err) {
    console.error('[pay] error', err);
    res.status(500).json({ error: 'Something went wrong. You were not charged unless you see a confirmation.' });
  }
}
