// POST /api/c/:token/upload?name=<filename> — stream one image or video to local storage.

import {
  countRecentMessages,
  getConversationMediaBytes,
  getBusiness,
  getConversationByToken,
  isVisitorBlocked,
} from '../../../db/index.js';
import { customerMedia } from '../../../lib/relay.js';
import {
  discardMedia,
  MAX_CONVERSATION_MEDIA_BYTES,
  MediaError,
  mediaRule,
  storeMedia,
} from '../../../lib/media.js';

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
    res.status(403).json({ error: '不允许此来源上传文件' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return true;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST 请求' });

  const conversation = await getConversationByToken(req.query.token);
  if (!conversation) return res.status(404).json({ error: '未找到该会话' });

  const business = await getBusiness(conversation.business_id);
  if (!business) return res.status(404).json({ error: '未找到该会话' });
  if (!enforceOrigin(req, res, business)) return;
  if (await isVisitorBlocked(business.id, conversation.customer_email, conversation.ip_hash)) {
    return res.status(403).json({ error: '无法上传文件' });
  }

  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const declaredSize = Number(req.headers['content-length']) || 0;
  try {
    mediaRule(mime, declaredSize);
  } catch (error) {
    if (error instanceof MediaError) return res.status(error.statusCode).json({ error: error.message });
    throw error;
  }

  const recent = await countRecentMessages(conversation.id, 10);
  if (recent >= 10) return res.status(429).json({ error: '发送过于频繁，请稍后再试' });

  const usedBytes = await getConversationMediaBytes(conversation.id);
  if (declaredSize && usedBytes + declaredSize > MAX_CONVERSATION_MEDIA_BYTES) {
    return res.status(413).json({ error: '当前会话的媒体文件总量不能超过 200 MB' });
  }

  let media;
  try {
    media = await storeMedia(req, { mime, name: req.query.name, size: declaredSize });
    if (usedBytes + media.size > MAX_CONVERSATION_MEDIA_BYTES) {
      await discardMedia(media.path);
      media = null;
      return res.status(413).json({ error: '当前会话的媒体文件总量不能超过 200 MB' });
    }
    await customerMedia(conversation, business, media);
    return res.status(201).json({ ok: true });
  } catch (error) {
    if (media) await discardMedia(media.path);
    if (error instanceof MediaError) return res.status(error.statusCode).json({ error: error.message });
    console.error('upload: media upload failed:', error.message);
    return res.status(500).json({ error: '文件上传失败，请重试' });
  }
}

handler.rawBody = true;
export default handler;
