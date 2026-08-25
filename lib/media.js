import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { config } from '../config.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
export const MAX_CONVERSATION_MEDIA_BYTES = 200 * 1024 * 1024;

const mediaTypes = new Map([
  ['image/jpeg', { type: 'image', ext: '.jpg', maxBytes: MAX_IMAGE_BYTES }],
  ['image/png', { type: 'image', ext: '.png', maxBytes: MAX_IMAGE_BYTES }],
  ['image/webp', { type: 'image', ext: '.webp', maxBytes: MAX_IMAGE_BYTES }],
  ['video/mp4', { type: 'video', ext: '.mp4', maxBytes: MAX_VIDEO_BYTES }],
  ['video/webm', { type: 'video', ext: '.webm', maxBytes: MAX_VIDEO_BYTES }],
  ['video/quicktime', { type: 'video', ext: '.mov', maxBytes: MAX_VIDEO_BYTES }],
]);

const databaseFile = config.TURSO_DATABASE_URL.startsWith('file:')
  ? config.TURSO_DATABASE_URL.slice('file:'.length)
  : 'data/supportgram.db';
export const DATA_DIR = path.resolve(path.dirname(databaseFile));
export const MEDIA_DIR = path.join(DATA_DIR, 'uploads');

export class MediaError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'MediaError';
    this.statusCode = statusCode;
  }
}

export function mediaRule(mime, size = 0) {
  const normalized = String(mime || '').split(';')[0].trim().toLowerCase();
  const rule = mediaTypes.get(normalized);
  if (!rule) throw new MediaError('只支持 JPG、PNG、WebP 图片和 MP4、WebM、MOV 视频');
  if (Number(size) > rule.maxBytes) {
    throw new MediaError(rule.type === 'image' ? '图片不能超过 10 MB' : '视频不能超过 20 MB', 413);
  }
  return { ...rule, mime: normalized };
}

function displayName(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function mediaAbsolutePath(relativePath) {
  const fullPath = path.resolve(DATA_DIR, String(relativePath || ''));
  if (!fullPath.startsWith(`${MEDIA_DIR}${path.sep}`)) {
    throw new MediaError('媒体路径无效');
  }
  return fullPath;
}

export async function storeMedia(readable, { mime, name, size = 0 }) {
  const rule = mediaRule(mime, size);
  const storageName = `${crypto.randomUUID()}${rule.ext}`;
  const relativePath = `uploads/${storageName}`;
  const finalPath = mediaAbsolutePath(relativePath);
  const partialPath = `${finalPath}.part`;
  let bytes = 0;

  await mkdir(MEDIA_DIR, { recursive: true });

  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > rule.maxBytes) {
        callback(new MediaError(rule.type === 'image' ? '图片不能超过 10 MB' : '视频不能超过 20 MB', 413));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(readable, limiter, createWriteStream(partialPath, { flags: 'wx' }));
    if (bytes === 0) throw new MediaError('文件内容为空');
    await rename(partialPath, finalPath);
  } catch (error) {
    await unlink(partialPath).catch(() => {});
    throw error;
  }

  return {
    type: rule.type,
    mime: rule.mime,
    name: displayName(name, `${rule.type === 'image' ? '图片' : '视频'}${rule.ext}`),
    size: bytes,
    path: relativePath,
    absolutePath: finalPath,
  };
}

export async function discardMedia(relativePath) {
  try {
    await unlink(mediaAbsolutePath(relativePath));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    console.error('media: failed to delete file:', relativePath, error.message);
    return false;
  }
}
