// Twilio status callback: updates the mt_invoices row for a sent MMS (queued, sent, delivered, undelivered, failed).
// Validates X-Twilio-Signature with TWILIO_AUTH_TOKEN; fails closed if the token is missing.
import crypto from 'node:crypto';
import { sb } from './_lib/mt.js';

function parseForm(raw) { const p = new URLSearchParams(raw); const o = {}; for (const [k, v] of p) o[k] = v; return o; }

async function readRaw(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return new URLSearchParams(req.body).toString();
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) { res.status(503).end(); return; }
  const params = parseForm(await readRaw(req));
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${proto}://${host}/api/twilio-status`;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  const got = req.headers['x-twilio-signature'] || '';
  const ok = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) { res.status(403).end(); return; }

  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;
  if (!sid || !status) { res.status(400).end(); return; }
  const patch = { status, status_updated_at: new Date().toISOString() };
  if (params.ErrorCode) patch.error = `${params.ErrorCode}: ${params.ErrorMessage || 'delivery error'}`;
  try {
    await sb(`mt_invoices?twilio_sid=eq.${encodeURIComponent(sid)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) });
    res.status(200).setHeader('Content-Type', 'text/xml').send('<Response></Response>');
  } catch (e) { console.error('[twilio-status]', e); res.status(500).end(); }
}
