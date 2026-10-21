// Renders a branded invoice as a PNG for MMS. Looks the invoice up by its unguessable id in mt_invoices.
// GET /api/invoice-image?id=inv-...
import { ImageResponse } from '@vercel/og';
import { LOGO_DATA_URI } from './_lib/logo.js';

export const config = { runtime: 'edge' };

const SB_URL = 'https://udirnxilxlvhkzbgpjke.supabase.co';
const SB_KEY = 'sb_publishable_7SGeCmx1XATdHTawyT6hHw_iWV9-1Vz';
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const txt = (style, children) => h('div', style, children);

export default async function handler(req) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^inv-[a-z0-9-]+$/.test(id)) return new Response('Bad id', { status: 400 });
  const r = await fetch(`${SB_URL}/rest/v1/mt_invoices?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const rows = r.ok ? await r.json() : [];
  const inv = rows[0];
  if (!inv) return new Response('Not found', { status: 404 });

  const issued = new Date(inv.sent_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Boise' });
  const original = Number(inv.original_amount ?? inv.amount);
  const borrowed = Number(inv.borrowed_amount || 0);
  const paid = Number(inv.paid_amount || 0);

  const line = (label, value, color) => h('div', { justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid #2f2a22', fontSize: 30 }, [
    txt({ color: '#b4ab97' }, label), txt({ color: color || '#f2ede2', fontWeight: 700 }, value),
  ]);
  const lines = [line('Original balance', money(original))];
  if (borrowed > 0) lines.push(line('Additional borrowed', '+ ' + money(borrowed)));
  if (paid > 0) lines.push(line('Payments received', '- ' + money(paid), '#7fd39a'));

  const pay = (label, bg, fg) => h('div', { justifyContent: 'center', alignItems: 'center', background: bg, color: fg, fontSize: 28, fontWeight: 700, padding: '20px 0', borderRadius: 16, marginTop: 14 }, label);

  const tree = h('div', {
    flexDirection: 'column', width: 1000, height: 1500, background: '#131110', padding: 56, fontFamily: 'sans-serif',
  }, [
    h('div', { flexDirection: 'column', background: '#1c1815', border: '2px solid #2f2a22', borderRadius: 28, padding: '48px 56px', flexGrow: 1 }, [
      h('div', { alignItems: 'center', justifyContent: 'space-between', borderBottom: '3px solid #8B6F35', paddingBottom: 30 }, [
        h('div', { alignItems: 'center' }, [
          { type: 'img', props: { src: LOGO_DATA_URI, width: 120, height: 120, style: { borderRadius: 14 } } },
          h('div', { flexDirection: 'column', marginLeft: 26 }, [
            txt({ color: '#C9A961', fontSize: 30, letterSpacing: 5, textTransform: 'uppercase' }, 'Bryson Hunter'),
            txt({ color: '#C9A961', fontSize: 30, letterSpacing: 5, textTransform: 'uppercase' }, 'Enterprises'),
            txt({ color: '#756d5b', fontSize: 22, marginTop: 6 }, 'brysonhunter.com'),
          ]),
        ]),
      ]),
      h('div', { justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 40 }, [
        txt({ color: '#C9A961', fontSize: 64, fontFamily: 'serif' }, 'INVOICE'),
        h('div', { flexDirection: 'column', alignItems: 'flex-end' }, [
          txt({ color: '#f2ede2', fontSize: 30, fontWeight: 700 }, inv.invoice_no || ''),
          txt({ color: '#756d5b', fontSize: 24 }, issued),
        ]),
      ]),
      txt({ color: '#756d5b', fontSize: 22, letterSpacing: 3, textTransform: 'uppercase', marginTop: 40 }, 'Billed to'),
      txt({ color: '#f2ede2', fontSize: 44, fontWeight: 700, marginTop: 6, marginBottom: 24 }, inv.debtor_name || ''),
      h('div', { flexDirection: 'column' }, lines),
      h('div', { justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }, [
        txt({ color: '#b4ab97', fontSize: 26, letterSpacing: 3, textTransform: 'uppercase' }, 'Amount due'),
        txt({ color: '#C9A961', fontSize: 84, fontWeight: 800 }, money(inv.amount)),
      ]),
      txt({ color: '#756d5b', fontSize: 22, letterSpacing: 3, textTransform: 'uppercase', marginTop: 36 }, 'Pay with'),
      pay('Venmo: venmo.com/u/bhunt2388', '#3D95CE', '#ffffff'),
      pay('Cash App: $bhunt23', '#00D632', '#04310f'),
      pay('PayPal: paypal.me/BrysonHunter801', '#0070BA', '#ffffff'),
      pay('Zelle: Brysonhunter', '#6D1ED4', '#ffffff'),
      pay('Apple Cash: 801-400-2916', '#000000', '#ffffff'),
      txt({ color: '#756d5b', fontSize: 22, marginTop: 'auto', justifyContent: 'center' }, `Please reference ${inv.invoice_no || 'this invoice'} with your payment.`),
    ]),
  ]);

  return new ImageResponse(tree, {
    width: 1000, height: 1500,
    headers: { 'Cache-Control': 'public, max-age=86400, immutable' },
  });
}
