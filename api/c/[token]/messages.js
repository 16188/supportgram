// GET  /api/c/:token/messages?after=<messageId> — poll conversation messages.
// POST /api/c/:token/messages — send a customer message.

import {
  getConversationByToken,
  getBusiness,
  getMessages,
  countRecentMessages,
  isVisitorBlocked,
  updateConversation,
} from '../../../db/index.js';
import { customerMessage } from '../../../lib/relay.js';

function enforceOrigin(req, res, business) {
  const origin = req.headers.origin;
  if (!origin) return true;
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

function mediaPayload(message, token) {
  if (!message.media_path) return null;
  const storageName = String(message.media_path).split('/').pop();
  return {
    type: message.media_type,
    name: message.media_name,
    mime: message.media_mime,
    size: Number(message.media_size) || 0,
    url: `/api/c/${encodeURIComponent(token)}/media/${encodeURIComponent(storageName)}`,
  };
}

function reactionPayload(raw) {
  let byActor = {};
  try { byActor = JSON.parse(raw || '{}'); } catch { /* ignore invalid legacy data */ }
  const counts = new Map();
  Object.values(byActor).flat().forEach((emoji) => {
    counts.set(emoji, (counts.get(emoji) || 0) + 1);
  });
  return [...counts].map(([emoji, count]) => ({ emoji, count }));
}

export function publicMessages(rows, token, customerName = '访客') {
  const byId = new Map(rows.map((message) => [Number(message.id), message]));
  return rows
    .filter((message) => message.direction !== 'note')
    .map((message) => {
      const replied = byId.get(Number(message.reply_to_message_id));
      return {
        id: Number(message.id),
        direction: message.direction,
        sender: message.sender_label,
        body: message.body,
        reply: replied ? {
          id: Number(replied.id),
          direction: replied.direction,
          sender: replied.sender_label || (replied.direction === 'in' ? customerName : '客服'),
          body: message.reply_quote || replied.body,
        } : null,
        reactions: reactionPayload(message.reactions),
        media: mediaPayload(message, token),
        at: message.created_at,
      };
    });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  const token = req.query.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'missing token' });
  }

  const conversation = await getConversationByToken(token);
  if (!conversation) {
    return res.status(404).json({ error: 'not found' });
  }

  const business = await getBusiness(conversation.business_id);
  if (!business) {
    return res.status(404).json({ error: 'not found' });
  }

  if (!enforceOrigin(req, res, business)) return;

  const visitorBlocked = await isVisitorBlocked(
    business.id,
    conversation.customer_email,
    conversation.ip_hash
  );

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const after = parseInt(req.query.after, 10) || 0;
    const all = await getMessages(conversation.id);
    const messages = publicMessages(all, token, conversation.customer_name)
      .filter((message) => message.id > after);

    // Fire-and-forget update last_seen_at to mark customer as online.
    try {
      await updateConversation(conversation.id, { last_seen_at: new Date().toISOString() });
    } catch (err) {
      console.error('messages: update last_seen_at failed:', err);
    }

    return res.status(200).json({
      status: visitorBlocked ? 'blocked' : conversation.status,
      messages,
    });
  }

  if (req.method === 'POST') {
    if (visitorBlocked) {
      return res.status(403).json({ error: 'unable to send message' });
    }

    const { message } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'message too long (max 4000 chars)' });
    }

    // Per-conversation throttle: max 10 messages per 10 seconds.
    const recent = await countRecentMessages(conversation.id, 10);
    if (recent >= 10) {
      return res.status(429).json({ error: 'slow down' });
    }

    try {
      await customerMessage(conversation, business, message);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('messages: customerMessage failed:', err);
      return res.status(500).json({ error: 'internal error' });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
