// Website form -> MHG Command (/api/intake). Creates the contact in the right
// workspace tab, a follow-up task for Bryson and JC, and texts and emails both.
// Fallback: if Command is unreachable, forward to Formspree so a lead is never lost.
// Env (Vercel): INTAKE_SECRET, COMMAND_INTAKE_URL
const SITE = "bhe";
const FALLBACK = "https://formspree.io/f/xdarooko";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body.website) return res.status(200).json({ ok: true }); // honeypot
  delete body.testMode;
  const payload = { ...body, site: SITE };
  if (!(payload.name || payload.first_name) || !payload.email) {
    return res.status(400).json({ ok: false, error: "Name and email are required" });
  }
  try {
    const url = process.env.COMMAND_INTAKE_URL, secret = process.env.INTAKE_SECRET;
    if (!url || !secret) throw new Error("not configured");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-intake-secret": secret }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error("command " + r.status);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Command intake failed, using Formspree fallback:", err.message);
  }
  try {
    const f = await fetch(FALLBACK, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (f.ok) return res.status(200).json({ ok: true, fallback: true });
  } catch (e) {}
  return res.status(502).json({ ok: false, error: "Could not record inquiry" });
}
