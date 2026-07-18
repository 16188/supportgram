// POST /api/conversations — start a new conversation from the widget.

import crypto from 'crypto';
import { getBusinessByKey, countRecentConversationsByIp } from '../db/index.js';
import { startConversation } from '../lib/relay.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function enforceOrigin(req, res, business) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients / same-origin
  let allowlist = [];
  try {
    allowlist = JSON.parse(business.origin_allowlist || '[]');
  } catch {
    allowlist = [];
  }
  if (!allowlist.includes(origin)) {
    res.status(403).json({ error: 'origin not allowed' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    // Preflight has no body/key — echo the origin; final enforcement happens on POST.
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const { key, name, email, pageUrl, message } = req.body || {};

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'missing key' });
  }

  const business = await getBusinessByKey(key);
  if (!business) {
    return res.status(404).json({ error: 'unknown key' });
  }

  if (!enforceOrigin(req, res, business)) return;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'valid email is required' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'message too long (max 4000 chars)' });
  }

  // Per-IP rate limit: max 5 new conversations per hour.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);

  const recent = await countRecentConversationsByIp(business.id, ipHash, 60);
  if (recent >= 5) {
    return res.status(429).json({ error: 'too many conversations, try again later' });
  }

  try {
    const conversation = await startConversation({
      business,
      name: name.trim(),
      email: email.trim(),
      pageUrl: typeof pageUrl === 'string' ? pageUrl : null,
      firstMessage: message,
      ipHash,
    });
    return res.status(200).json({ token: conversation.resume_token, status: 'open' });
  } catch (err) {
    console.error('conversations: startConversation failed:', err);
    return res.status(500).json({ error: 'internal error' });
  }
}
