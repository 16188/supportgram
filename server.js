import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import conversations from './api/conversations.js';
import messages from './api/c/[token]/messages.js';
import resume from './api/resume.js';
import telegram from './api/tg/[key].js';

const publicDir = fileURLToPath(new URL('./public', import.meta.url));
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return res;
  };
  res.send = (body) => {
    res.end(body);
    return res;
  };
  res.html = (body) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
    return res;
  };
}

async function readBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function findHandler(pathname, query) {
  if (pathname === '/api/conversations') return conversations;

  let match = pathname.match(/^\/api\/c\/([^/]+)\/messages$/);
  if (match) {
    query.token = decodeURIComponent(match[1]);
    return messages;
  }

  match = pathname.match(/^\/api\/tg\/([^/]+)$/);
  if (match) {
    query.key = decodeURIComponent(match[1]);
    return telegram;
  }

  match = pathname.match(/^\/c\/([^/]+)$/);
  if (match) {
    query.token = decodeURIComponent(match[1]);
    return resume;
  }

  return null;
}

async function servePublic(pathname, res) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'test.html';
  const file = resolve(publicDir, relative);
  if (!file.startsWith(`${publicDir}${sep}`)) return false;

  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  createReadStream(file).pipe(res);
  return true;
}

async function handle(req, res) {
  decorate(res);
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') return res.status(200).json({ ok: true });

  req.query = Object.fromEntries(url.searchParams);
  const handler = findHandler(url.pathname, req.query);
  if (handler) {
    try {
      req.body = await readBody(req);
      return await handler(req, res);
    } catch (error) {
      const badRequest = error instanceof SyntaxError || error.message === 'request body too large';
      return res.status(badRequest ? 400 : 500).json({ error: badRequest ? error.message : 'internal error' });
    }
  }

  if (req.method === 'GET' && await servePublic(url.pathname, res)) return;
  return res.status(404).json({ error: 'not found' });
}

export function createAppServer() {
  return createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!(error instanceof URIError)) console.error('server: unhandled request error:', error);
      if (res.headersSent) return res.destroy();
      decorate(res);
      return res.status(error instanceof URIError ? 400 : 500).json({
        error: error instanceof URIError ? 'invalid URL' : 'internal error',
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createAppServer().listen(port, '0.0.0.0', () => {
    console.log(`Supportgram listening on http://0.0.0.0:${port}`);
  });
}
