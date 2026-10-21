// Preview of exactly what an invoice looks like right now (email and text-message image) without sending or logging anything.
// GET /api/preview-invoice?debtId=...
import { buildInvoiceHtml } from './send-invoice.js';
import { API_BASE, escapeHtml, getSnapshot, todayLong, fmt } from './_lib/mt.js';

export default async function handler(req, res) {
  const debtId = String((req.query && req.query.debtId) || '');
  if (!debtId) { res.status(400).send('Missing debtId'); return; }
  try {
    const snap = await getSnapshot(debtId);
    const emailHtml = buildInvoiceHtml({ invoiceNo: 'PREVIEW', issued: todayLong(), snap, dueNote: '' });
    const brandName = snap.brand === 'axis' ? 'AXIS Chems' : 'Bryson Hunter';
    const page = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice preview: ${escapeHtml(snap.name)}</title>
<style>
  body{margin:0; background:#0b0d10; color:#eef1f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  header{padding:16px 20px; border-bottom:1px solid #262b33; display:flex; gap:16px; align-items:baseline; flex-wrap:wrap;}
  header b{font-size:16px;} header span{color:#8a92a0; font-size:13px;}
  .tabs{display:flex; gap:8px; padding:12px 20px;}
  .tabs button{background:transparent; color:#eef1f4; border:1px solid #262b33; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:13px;}
  .tabs button.on{border-color:#facc15; color:#facc15;}
  .pane{display:none; padding:0 20px 30px;} .pane.on{display:block;}
  iframe{width:100%; max-width:640px; height:1100px; border:0; background:#fff; border-radius:10px;}
  img{width:100%; max-width:500px; border-radius:10px; display:block;}
</style></head><body>
<header><b>Preview: ${escapeHtml(snap.name)}</b><span>${brandName} / balance ${fmt(snap.balance)} / nothing is sent or logged</span></header>
<div class="tabs"><button class="on" data-t="email">Email</button><button data-t="mms">Text (MMS image)</button></div>
<div class="pane on" id="email"><iframe srcdoc="${escapeHtml(emailHtml)}"></iframe></div>
<div class="pane" id="mms"><img src="${API_BASE}/api/invoice-image?preview=${encodeURIComponent(debtId)}&t=${Date.now()}" alt="MMS invoice preview"></div>
<script>document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button,.pane').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.getElementById(b.dataset.t).classList.add('on');});</script>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(page);
  } catch (e) { res.status(500).send('Could not build preview: ' + escapeHtml(String(e.message || e))); }
}
