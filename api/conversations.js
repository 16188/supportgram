// POST /api/conversations — start a new conversation from the widget.
// GET  /api/conversations?key&email&sig — verified-identity conversation list.

import crypto from 'crypto';
import { BlockList, isIP } from 'node:net';
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
export const NEW_CONVERSATION_WINDOW_MINUTES = 10;

const cloudflareIps = new BlockList();
for (const cidr of [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32',
  '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
]) {
  const [address, prefix] = cidr.split('/');
  cloudflareIps.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

const startingIps = new Set();

function validIp(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : '';
}

export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1);
  const proxyIp = validIp(req.headers['x-real-ip']) || validIp(forwarded) || validIp(req.socket?.remoteAddress);
  const cloudflareIp = validIp(req.headers['cf-connecting-ip']);
  const proxyType = isIP(proxyIp) === 6 ? 'ipv6' : 'ipv4';
  return cloudflareIp && proxyIp && cloudflareIps.check(proxyIp, proxyType) ? cloudflareIp : proxyIp;
}

export function conversationInputError({ name, email, pageUrl, message, website } = {}) {
  if (website) return 'invalid request';
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

  const { key, name, email, pageUrl, message, website } = req.body || {};

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'missing key' });
  }

  const business = await getBusinessByKey(key);
  if (!business) {
    return res.status(404).json({ error: 'unknown key' });
  }

  if (!enforceOrigin(req, res, business)) return;

  const inputError = conversationInputError({ name, email, pageUrl, message, website });
  if (inputError) return res.status(400).json({ error: inputError });

  const ip = clientIp(req);
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const rateKey = `${business.id}:${ipHash}`;

  if (startingIps.has(rateKey)) {
    return res.status(429).json({ error: '10分钟内只允许开启一个聊天窗口' });
  }
  startingIps.add(rateKey);

  try {
    if (await isVisitorBlocked(business.id, email.trim(), ipHash)) {
      return res.status(403).json({ error: 'unable to start conversation' });
    }

    const recent = await countRecentConversationsByIp(business.id, ipHash, NEW_CONVERSATION_WINDOW_MINUTES);
    if (recent >= 1) {
      return res.status(429).json({ error: '10分钟内只允许开启一个聊天窗口' });
    }

    const conversation = await startConversation({
      business,
      name: name.trim(),
      email: email.trim(),
      pageUrl: typeof pageUrl === 'string' ? pageUrl : null,
      firstMessage: message,
      ip,
      ipHash,
    });
    return res.status(200).json({ token: conversation.resume_token, status: 'open' });
  } catch (err) {
    console.error('conversations: startConversation failed:', err);
    return res.status(500).json({ error: 'internal error' });
  } finally {
    startingIps.delete(rateKey);
  }
}
