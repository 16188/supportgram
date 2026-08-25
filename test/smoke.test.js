import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import purge from '../api/cron/purge.js';
import { createAppServer } from '../server.js';

test('VPS server exposes a health check', async (t) => {
  const server = createAppServer().listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');

  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const invalidUrl = await fetch(`http://127.0.0.1:${server.address().port}/%E0%A4%A`);
  assert.equal(invalidUrl.status, 400);
});

test('automatic purge stays disabled', async () => {
  let status;
  let body;
  await purge({}, {
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      body = value;
    },
  });

  assert.equal(status, 410);
  assert.match(body.error, /disabled/);
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal('crons' in vercel, false);
});
