import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import purge from '../api/cron/purge.js';
import { conversationInputError } from '../api/conversations.js';
import { byteRange } from '../api/c/[token]/media.js';
import { publicMessages } from '../api/c/[token]/messages.js';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, mediaRule } from '../lib/media.js';
import { blockCommand, deleteCommand, telegramReactionEmojis, undoCommand } from '../lib/relay.js';
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
  const staticHtml = await staticPage.text();
  assert.match(staticHtml, /请查看页面右下角的客服图标，点击后即可开始会话。/);
  assert.doesNotMatch(staticHtml, /data-key.*公开|localhost:3000|参数说明/);

  const logo = await fetch(`http://127.0.0.1:${server.address().port}/maitg-logo.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');

  const voice = await fetch(`http://127.0.0.1:${server.address().port}/voice.mp3`);
  assert.equal(voice.status, 200);
  assert.equal(voice.headers.get('content-type'), 'audio/mpeg');
  assert.ok((await voice.arrayBuffer()).byteLength > 0);

  const invalidUrl = await fetch(`http://127.0.0.1:${server.address().port}/%E0%A4%A`);
  assert.equal(invalidUrl.status, 400);
});

test('widget defaults to Chinese and uses the MAITG logo', async () => {
  const source = await readFile(new URL('../widget/src/widget.js', import.meta.url), 'utf8');
  assert.match(source, /联系我们/);
  assert.match(source, /我要咨询/);
  assert.match(source, /客服在线时间（北京时间）：9:00-20:00/);
  assert.match(source, /beijingHour >= 9 && beijingHour < 20/);
  assert.match(source, /setInterval\(syncServiceAvailability, 60 \* 1000\)/);
  assert.match(source, /maxlength="100"/);
  assert.match(source, /maxlength="254"/);
  assert.match(source, /maitg-logo\.png/);
  assert.match(source, /launcher\.innerHTML = `\s*<svg/);
  assert.match(source, /newAgentMessages\.length > 0\) playNotificationSound\(\)/);
  assert.match(source, /new Audio\(`\$\{state\.apiBase\}\/voice\.mp3`\)/);
  assert.match(source, /notificationAudio\.volume = 1/);
  assert.doesNotMatch(source, /createOscillator|linearRampToValueAtTime\(0\.06/);
  assert.match(source, /backgroundRate: 10000/);
  assert.doesNotMatch(source, /Send a Message|We'll respond as soon as we can/);
});

test('conversation fields enforce practical length limits', () => {
  const valid = { name: '访客', email: 'user@example.com', pageUrl: 'https://example.com', message: '你好' };
  assert.equal(conversationInputError(valid), null);
  assert.match(conversationInputError({ ...valid, name: 'x'.repeat(101) }), /100/);
  assert.match(conversationInputError({ ...valid, email: `${'x'.repeat(243)}@example.com` }), /254/);
  assert.match(conversationInputError({ ...valid, pageUrl: `https://example.com/${'x'.repeat(2048)}` }), /2048/);
});

test('Telegram replies and reactions become website message metadata', async () => {
  const messages = publicMessages([
    { id: 1, direction: 'in', sender_label: '访客', body: '原消息', reactions: '{}', created_at: '2026-08-27' },
    {
      id: 2,
      direction: 'out',
      sender_label: '客服',
      body: '引用回复',
      reply_to_message_id: 1,
      reply_quote: '选中的句子',
      reactions: JSON.stringify({ 11: ['❤'], 22: ['❤', '👍'] }),
      created_at: '2026-08-27',
    },
  ], 'token', '访客');
  assert.equal(messages[1].reply.body, '选中的句子');
  assert.deepEqual(messages[1].reactions, [{ emoji: '❤', count: 2 }, { emoji: '👍', count: 1 }]);
  assert.deepEqual(telegramReactionEmojis([
    { type: 'emoji', emoji: '👍' },
    { type: 'emoji', emoji: '👍' },
    { type: 'custom_emoji', custom_emoji_id: '1' },
  ]), ['👍']);

  const telegramApi = await readFile(new URL('../lib/telegramApi.js', import.meta.url), 'utf8');
  const deploy = await readFile(new URL('../scripts/deploy.sh', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../db/schema.js', import.meta.url), 'utf8');
  assert.match(telegramApi, /'message_reaction'/);
  assert.match(deploy, /--sync-telegram/);
  assert.match(schema, /reply_to_message_id INTEGER/);
  assert.match(schema, /reply_quote TEXT/);
  assert.match(schema, /reactions TEXT NOT NULL/);
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

test('VPS deployment keeps one local image for one-command rollback', async () => {
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  const deploy = await readFile(new URL('../scripts/deploy.sh', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../scripts/rollback.sh', import.meta.url), 'utf8');
  assert.match(compose, /\$\{IMAGE_TAG:-latest\}/);
  assert.match(deploy, /docker image tag .*rollback-local/);
  assert.match(rollback, /IMAGE_TAG=rollback-local docker compose up .*--pull never/);
});

test('media uploads accept only supported images and videos within Telegram-safe limits', async () => {
  assert.equal(mediaRule('image/png', MAX_IMAGE_BYTES).type, 'image');
  assert.equal(mediaRule('video/mp4', MAX_VIDEO_BYTES).type, 'video');
  assert.throws(() => mediaRule('application/pdf', 100), /只支持/);
  assert.throws(() => mediaRule('video/mp4', MAX_VIDEO_BYTES + 1), /20 MB/);
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.equal(byteRange('bytes=100-200', 100), null);

  const widget = await readFile(new URL('../widget/src/widget.js', import.meta.url), 'utf8');
  assert.match(widget, /type="file"/);
  assert.match(widget, /\/upload\?name=/);

  const schema = await readFile(new URL('../db/schema.js', import.meta.url), 'utf8');
  assert.match(schema, /media_path TEXT/);
});

test('permanent deletion requires an explicit confirmation command', () => {
  assert.equal(deleteCommand('/delete'), 'prompt');
  assert.equal(deleteCommand('/delete confirm'), 'confirm');
  assert.equal(deleteCommand('/delete@support_bot confirm'), 'confirm');
  assert.equal(deleteCommand('/delete maybe'), 'prompt');
  assert.equal(deleteCommand('/close'), null);
});

test('agent message correction and blacklist commands are explicit', async () => {
  assert.equal(undoCommand('/undo'), true);
  assert.equal(undoCommand('/undo@support_bot'), true);
  assert.equal(undoCommand('/undo now'), false);
  assert.equal(blockCommand('/block'), 'block');
  assert.equal(blockCommand('/unblock@support_bot'), 'unblock');
  assert.equal(blockCommand('/block confirm'), null);

  const relay = await readFile(new URL('../lib/relay.js', import.meta.url), 'utf8');
  assert.match(relay, /update\?\.edited_message/);
  assert.match(relay, /deleteAgentMessage/);
  assert.ok(relay.indexOf('if (edited)') < relay.indexOf('if (!msg.message_thread_id)'));

  const widget = await readFile(new URL('../widget/src/widget.js', import.meta.url), 'utf8');
  const resume = await readFile(new URL('../api/resume.js', import.meta.url), 'utf8');
  assert.doesNotMatch(widget, /searchParams\.append\('after'/);
  assert.doesNotMatch(resume, /messages\?after=/);

  const schema = await readFile(new URL('../db/schema.js', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS blocked_visitors/);

  const messagesApi = await readFile(new URL('../api/c/[token]/messages.js', import.meta.url), 'utf8');
  assert.match(messagesApi, /Cache-Control', 'no-store/);

  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /relative === 'widget\.js'/);
  assert.match(server, /no-cache, no-store, must-revalidate/);
});
