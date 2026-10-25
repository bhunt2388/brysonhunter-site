// Re-reads GoHighLevel's real delivery status for text invoices/receipts still logged as queued/pending/sent,
// and writes the final status back to mt_invoices. Called by the Money Tracker page on load and after a send.
import { sb } from './_lib/mt.js';

const FINAL = ['delivered', 'failed', 'undelivered'];

export default async function handler(req, res) {
  const ghlToken = process.env.GHL_TOKEN;
  if (!ghlToken) { res.status(500).json({ error: 'GHL_TOKEN not configured' }); return; }
  const H = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', Accept: 'application/json' };
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const rows = await sb(`mt_invoices?select=id,status,twilio_sid&source_account=eq.ghl&twilio_sid=not.is.null&status=not.in.(delivered,failed,undelivered)&sent_at=gte.${since}&limit=50`);
    let updated = 0;
    for (const r of rows || []) {
      const g = await fetch(`https://services.leadconnectorhq.com/conversations/messages/${r.twilio_sid}`, { headers: H });
      if (!g.ok) continue;
      const gj = await g.json().catch(() => ({}));
      const m = gj.message || gj;
      const status = m.status;
      if (!status || status === r.status) continue;
      const patch = { status, status_updated_at: new Date().toISOString() };
      if (['failed', 'undelivered'].includes(status)) patch.error = String(m.error || m.errorMessage || 'Carrier did not deliver').slice(0, 300);
      await sb(`mt_invoices?id=eq.${r.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) });
      updated++;
    }
    res.status(200).json({ checked: (rows || []).length, updated, final: FINAL });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
