// POST /api/conversations — start a new conversation from the widget.
// GET  /api/conversations?key&email&sig — verified-identity conversation list.

import crypto from 'crypto';
import {
  getBusinessByKey,
  countRecentConversationsByIp,
  isVisitorBlocked,
  listConversationsByEmail,
} from '../db/index.js';
import { startConversation } from '../lib/relay.js';

// sig must be HMAC-SHA256(identity_secret, lowercase(email)) as hex — computed by the
// tenant's own backend, proving the page didn't just claim an arbitrary email.
function verifyIdentitySig(business, email, sig) {
  if (!business.identity_secret || !sig) return false;
  const expected = crypto
    .createHmac('sha256', business.identity_secret)
    .update(String(email).trim().toLowerCase())
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(sig), 'hex'));
  } catch {
    return false;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INPUT_LIMITS = { name: 100, email: 254, pageUrl: 2048, message: 4000 };

export function conversationInputError({ name, email, pageUrl, message } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) return 'name is required';
  if (name.trim().length > INPUT_LIMITS.name) return 'name is too long (max 100 chars)';
  if (!email || typeof email !== 'string') return 'valid email is required';
  if (email.trim().length > INPUT_LIMITS.email) return 'email is too long (max 254 chars)';
  if (!EMAIL_RE.test(email.trim())) return 'valid email is required';
  if (!message || typeof message !== 'string' || !message.trim()) return 'message is required';
  if (message.length > INPUT_LIMITS.message) return 'message too long (max 4000 chars)';
  if (typeof pageUrl === 'string' && pageUrl.length > INPUT_LIMITS.pageUrl) {
    return 'page URL is too long (max 2048 chars)';
  }
  return null;
}

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    const { key, email, sig } = req.query || {};
    if (!key) return res.status(400).json({ error: 'missing key' });

    const business = await getBusinessByKey(key);
    if (!business) return res.status(404).json({ error: 'unknown key' });
    if (!enforceOrigin(req, res, business)) return;

    if (!email || String(email).trim().length > INPUT_LIMITS.email || !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: 'valid email is required' });
    }
    if (!verifyIdentitySig(business, email, sig)) {
      return res.status(401).json({ error: 'identity signature invalid' });
    }

    try {
      const conversations = await listConversationsByEmail(business.id, String(email).trim());
      return res.status(200).json({ conversations });
    } catch (err) {
      console.error('conversations: list failed:', err);
      return res.status(500).json({ error: 'internal error' });
    }
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

  const inputError = conversationInputError({ name, email, pageUrl, message });
  if (inputError) return res.status(400).json({ error: inputError });

  // Per-IP rate limit: max 5 new conversations per hour.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);

  if (await isVisitorBlocked(business.id, email.trim(), ipHash)) {
    return res.status(403).json({ error: 'unable to start conversation' });
  }

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
