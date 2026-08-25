// GET /api/c/:token/media/:file — serve a stored conversation image or video.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { getBusiness, getConversationByToken, getMessageMedia } from '../../../db/index.js';
import { mediaAbsolutePath } from '../../../lib/media.js';

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
    res.status(403).json({ error: '不允许此来源访问文件' });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return true;
}

export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || ''));
  if (!match) return null;

  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(405).json({ error: '仅支持 GET 请求' });
  }
  if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(req.query.file || '')) {
    return res.status(404).json({ error: '未找到文件' });
  }

  const conversation = await getConversationByToken(req.query.token);
  if (!conversation) return res.status(404).json({ error: '未找到文件' });
  const business = await getBusiness(conversation.business_id);
  if (!business || !enforceOrigin(req, res, business)) return;

  const media = await getMessageMedia(conversation.id, req.query.file);
  if (!media?.media_path) return res.status(404).json({ error: '未找到文件' });

  let info;
  let filePath;
  try {
    filePath = mediaAbsolutePath(media.media_path);
    info = await stat(filePath);
  } catch {
    return res.status(404).json({ error: '未找到文件' });
  }

  res.setHeader('Content-Type', media.media_mime || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const requestedRange = req.headers.range;
  if (requestedRange) {
    const range = byteRange(requestedRange, info.size);
    if (!range) {
      res.setHeader('Content-Range', `bytes */${info.size}`);
      return res.status(416).end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath, range).pipe(res);
    return;
  }

  res.setHeader('Content-Length', info.size);
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}
