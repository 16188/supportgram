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

  const staticPage = await fetch(`http://127.0.0.1:${server.address().port}/test.html`);
  assert.equal(staticPage.status, 200);
  assert.match(await staticPage.text(), /客服组件测试/);

  const logo = await fetch(`http://127.0.0.1:${server.address().port}/maitg-logo.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');

  const invalidUrl = await fetch(`http://127.0.0.1:${server.address().port}/%E0%A4%A`);
  assert.equal(invalidUrl.status, 400);
});

test('widget defaults to Chinese and uses the MAITG logo', async () => {
  const source = await readFile(new URL('../widget/src/widget.js', import.meta.url), 'utf8');
  assert.match(source, /联系我们/);
  assert.match(source, /maitg-logo\.png/);
  assert.doesNotMatch(source, /Send a Message|We'll respond as soon as we can/);
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

test('Docker stores the database beside the deployment files', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /\.\/data:\/app\/data/);
  assert.doesNotMatch(compose, /supportgram_data/);
});
