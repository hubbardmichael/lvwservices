const { createHash } = require('node:crypto');
const MAX_BYTES = 16000;
const emailPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const unavailable = 'The contact form is temporarily unavailable. Please try again later.';
const buckets = new Map();

// A best-effort per-instance limit; Turnstile remains mandatory across instances.
function rateLimited(ip, now = Date.now()) {
  for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
  if (buckets.size >= 5000 && !buckets.has(ip)) return true;
  const bucket = buckets.get(ip) || { count: 0, until: now + 600000 };
  bucket.count++; buckets.set(ip, bucket);
  return bucket.count > 5;
}
function configuration(env) {
  const origins = (env.CONTACT_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (env.VERCEL_URL) origins.push(`https://${env.VERCEL_URL}`);
  const ready = env.CONTACT_ENABLED === 'true' && env.RESEND_API_KEY &&
    emailPattern.test(env.CONTACT_FROM || '') && emailPattern.test(env.CONTACT_TO || '') &&
    env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY && origins.length;
  return { ready: Boolean(ready), origins };
}
function validate(body) {
  const errors = {};
  const limits = { name: [1, 100], email: [3, 254], company: [0, 150], needs: [20, 5000] };
  const values = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    values[key] = value;
    if ((body[key] !== undefined && typeof body[key] !== 'string') || value.length < min || value.length > max || (key !== 'needs' && /[\r\n\x00-\x1f]/.test(value)) || (key === 'needs' && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))) {
      errors[key] = key === 'needs' ? 'Describe your project in 20–5,000 characters.' : `Enter ${key === 'email' ? 'a reply email' : key === 'name' ? 'your name' : 'a company name'} (up to ${max} characters).`;
    }
  }
  if (!emailPattern.test(values.email)) errors.email = 'Enter a valid reply email address.';
  return { errors, values };
}
function createHandler({ env = process.env, fetchImpl = fetch, limit = rateLimited } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, data) => res.status(status).json(data);
    const config = configuration(env);
    if (req.method === 'GET') return config.ready ? reply(200, { siteKey: env.TURNSTILE_SITE_KEY }) : reply(503, { message: unavailable });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return reply(405, { message: 'Method not allowed.' }); }
    const origin = req.headers.origin;
    if (!origin || !config.origins.includes(origin)) return reply(403, { message: 'Please send your inquiry from the contact page.' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { message: 'Unsupported request format.' });
    if (Number(req.headers['content-length']) > MAX_BYTES) return reply(413, { message: 'Your inquiry is too long.' });
    let body;
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!raw || Buffer.byteLength(raw) > MAX_BYTES) return reply(413, { message: 'Your inquiry is too long.' });
      body = JSON.parse(raw);
      if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
    } catch { return reply(400, { message: 'Unable to read your inquiry. Please try again.' }); }
    if (!config.ready) return reply(503, { message: unavailable });
    // Vercel supplies this header. Never persist or log raw IPs or inquiry text.
    const ip = createHash('sha256').update(String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown')).digest('hex');
    if (limit(ip)) { res.setHeader('Retry-After', '600'); return reply(429, { message: 'Too many attempts. Please wait ten minutes and try again.' }); }
    if (typeof body.website !== 'string' || body.website !== '') return reply(400, { message: 'Unable to submit this inquiry. Please reload the page.' });
    const { errors, values } = validate(body);
    if (Object.keys(errors).length) return reply(422, { message: 'Please check the highlighted fields.', errors });
    if (typeof body.token !== 'string' || !body.token || body.token.length > 2048) return reply(400, { message: 'Please complete the spam check and try again.' });
    if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) return reply(400, { message: 'Please reload the page and try again.' });
    try {
      const verification = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: body.token }), signal: AbortSignal.timeout(8000)
      });
      if (!verification.ok) return reply(503, { message: 'The spam check is unavailable. Please try again.' });
      const result = await verification.json();
      if (!result.success || result.action !== 'contact' || result.hostname !== new URL(origin).hostname) return reply(400, { message: 'The spam check expired or failed. Please try again.' });
      const payload = { from: env.CONTACT_FROM, to: [env.CONTACT_TO], reply_to: values.email,
        subject: 'LVW Services website inquiry',
        text: `New website inquiry\n\nName: ${values.name}\nReply email: ${values.email}\nCompany: ${values.company || '(not provided)'}\n\nProject needs:\n${values.needs}` };
      // Same submission/content keeps its key across ambiguous network failures.
      const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const sent = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `contact/${body.requestId}/${digest}` },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(10000)
      });
      if (!sent.ok) return reply(503, { message: 'We could not confirm your inquiry was sent. Your message is still here; please try again.' });
      const resultSent = await sent.json();
      if (!resultSent.id) throw Error('Missing provider acknowledgement');
      return reply(200, { message: 'Thank you. Your inquiry has been submitted to Michael.' });
    } catch { return reply(503, { message: 'We could not confirm your inquiry was sent. Your message is still here; please try again.' }); }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.validate = validate;
module.exports.rateLimited = rateLimited;
