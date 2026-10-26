// Renders a branded invoice as a PNG for MMS. Looks the invoice up by its unguessable id in mt_invoices.
// GET /api/invoice-image?id=inv-...
import { ImageResponse } from '@vercel/og';
import { LOGO_DATA_URI } from './_lib/logo.js';
import { AXIS_LOGO_DATA_URI } from './_lib/axis-logo.js';
import { getSnapshot, fmt as fmtMoney, todayLong } from './_lib/mt.js';

export const config = { runtime: 'edge' };

const SB_URL = 'https://udirnxilxlvhkzbgpjke.supabase.co';
const SB_KEY = 'sb_publishable_7SGeCmx1XATdHTawyT6hHw_iWV9-1Vz';
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const THEMES = {
  bryson: { bg: '#131110', card: '#1c1815', line: '#2f2a22', accent: '#C9A961', rule: '#8B6F35', text: '#f2ede2', muted: '#b4ab97', dim: '#756d5b', green: '#7fd39a', logo: LOGO_DATA_URI, logoW: 120, logoH: 120, logoRadius: 14, lines: ['Bryson Hunter', 'Enterprises'], site: 'brysonhunter.com', serif: 'serif' },
  axis: { bg: '#EEF3FA', card: '#ffffff', line: '#DCE5F2', accent: '#0B4CB8', rule: '#0B4CB8', text: '#0E1B33', muted: '#4A5B78', dim: '#7A889F', green: '#1a8f4c', logo: AXIS_LOGO_DATA_URI, logoW: 420, logoH: 100, logoRadius: 0, lines: null, site: 'axischems.com', serif: 'sans-serif' },
};

const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const txt = (style, children) => h('div', style, children);

export default async function handler(req) {
  const params = new URL(req.url).searchParams;
  const previewId = params.get('preview');
  let inv;
  let issued;
  let lines0;
  if (previewId) {
    // Live preview of what would be sent now, built from the current numbers (nothing is logged).
    try {
      const snap = await getSnapshot(previewId);
      inv = { brand: snap.brand, invoice_no: snap.invoiceNo || 'PREVIEW', amount: snap.balance, debtor_name: snap.name };
      lines0 = snap.lines;
      issued = todayLong();
    } catch (e) { return new Response('Not found', { status: 404 }); }
  } else {
    const id = params.get('id') || '';
    if (!/^inv-[a-z0-9-]+$/.test(id)) return new Response('Bad id', { status: 400 });
    const r = await fetch(`${SB_URL}/rest/v1/mt_invoices?id=eq.${encodeURIComponent(id)}&select=*`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const rows = r.ok ? await r.json() : [];
    inv = rows[0];
    if (!inv) return new Response('Not found', { status: 404 });
    issued = new Date(inv.sent_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Boise' });
    lines0 = Array.isArray(inv.items) && inv.items.length ? inv.items : null;
  }
  const T = THEMES[inv.brand] || THEMES.bryson;
  const original = Number(inv.original_amount ?? inv.amount);
  const borrowed = Number(inv.borrowed_amount || 0);
  const paid = Number(inv.paid_amount || 0);
  if (!lines0) {
    // Invoices logged before itemization
    lines0 = [{ label: 'Original balance', value: fmtMoney(original), kind: 'neutral' }];
    if (borrowed > 0) lines0.push({ label: 'Additional borrowed', value: '+ ' + fmtMoney(borrowed), kind: 'neutral' });
    if (paid > 0) lines0.push({ label: 'Payments received', value: '- ' + fmtMoney(paid), kind: 'credit' });
  }

  const line = (label, value, color) => h('div', { justifyContent: 'space-between', padding: '16px 0', borderBottom: `1px solid ${T.line}`, fontSize: 30 }, [
    txt({ color: T.muted, flexShrink: 1, paddingRight: 20 }, label), txt({ color: color || T.text, fontWeight: 700, whiteSpace: 'nowrap' }, value),
  ]);
  const lines = lines0.map((l) => line(l.label, l.value, l.kind === 'credit' ? T.green : undefined));
  const HEIGHT = 1500 + Math.max(0, lines0.length - 2) * 66;

  const pay = (label, bg, fg) => h('div', { justifyContent: 'center', alignItems: 'center', background: bg, color: fg, fontSize: 28, fontWeight: 700, padding: '20px 0', borderRadius: 16, marginTop: 14 }, label);

  const tree = h('div', {
    flexDirection: 'column', width: 1000, height: HEIGHT, background: T.bg, padding: 56, fontFamily: 'sans-serif',
  }, [
    h('div', { flexDirection: 'column', background: T.card, border: `2px solid ${T.line}`, borderRadius: 28, padding: '48px 56px', flexGrow: 1 }, [
      h('div', { alignItems: 'center', justifyContent: 'space-between', borderBottom: `3px solid ${T.rule}`, paddingBottom: 30 }, [
        h('div', { alignItems: 'center' }, [
          { type: 'img', props: { src: T.logo, width: T.logoW, height: T.logoH, style: { borderRadius: T.logoRadius } } },
          ...(T.lines ? [h('div', { flexDirection: 'column', marginLeft: 26 }, [
            txt({ color: T.accent, fontSize: 30, letterSpacing: 5, textTransform: 'uppercase' }, T.lines[0]),
            txt({ color: T.accent, fontSize: 30, letterSpacing: 5, textTransform: 'uppercase' }, T.lines[1]),
            txt({ color: T.dim, fontSize: 22, marginTop: 6 }, T.site),
          ])] : []),
        ]),
        ...(T.lines ? [] : [txt({ color: T.dim, fontSize: 26 }, T.site)]),
      ]),
      h('div', { justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 40 }, [
        txt({ color: T.accent, fontSize: 64, fontFamily: T.serif }, 'INVOICE'),
        h('div', { flexDirection: 'column', alignItems: 'flex-end' }, [
          txt({ color: T.text, fontSize: 30, fontWeight: 700 }, inv.invoice_no || ''),
          txt({ color: T.dim, fontSize: 24 }, issued),
        ]),
      ]),
      txt({ color: T.dim, fontSize: 22, letterSpacing: 3, textTransform: 'uppercase', marginTop: 40 }, 'Billed to'),
      txt({ color: T.text, fontSize: 44, fontWeight: 700, marginTop: 6, marginBottom: 24 }, inv.debtor_name || ''),
      h('div', { flexDirection: 'column' }, lines),
      h('div', { justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }, [
        txt({ color: T.muted, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase' }, 'Amount due'),
        txt({ color: T.accent, fontSize: 84, fontWeight: 800 }, money(inv.amount)),
      ]),
      txt({ color: T.dim, fontSize: 22, letterSpacing: 3, textTransform: 'uppercase', marginTop: 36 }, 'Pay with'),
      pay('Venmo: venmo.com/u/bhunt2388', '#3D95CE', '#ffffff'),
      pay('Cash App: $bhunt23', '#00D632', '#04310f'),
      pay('PayPal: paypal.me/BrysonHunter801', '#0070BA', '#ffffff'),
      pay('Zelle: Brysonhunter', '#6D1ED4', '#ffffff'),
      pay('Apple Cash: 801-400-2916', '#000000', '#ffffff'),
      txt({ color: T.dim, fontSize: 22, marginTop: 'auto', justifyContent: 'center' }, `Payment reference: ${inv.invoice_no || 'this invoice'}. Please include it with your payment.`),
    ]),
  ]);

  return new ImageResponse(tree, {
    width: 1000, height: HEIGHT,
    headers: { 'Cache-Control': previewId ? 'no-store' : 'public, max-age=86400, immutable' },
  });
}
