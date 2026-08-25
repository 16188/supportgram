// Raw Telegram Bot API client — no SDK, global fetch.

import { readFile } from 'node:fs/promises';

async function telegramResult(resp, method) {
  let data = null;
  try {
    data = await resp.json();
  } catch {
    // non-JSON response
  }
  if (!data || !data.ok) {
    const description = data?.description || `HTTP ${resp.status}`;
    throw new Error(`Telegram ${method} failed: ${description}`);
  }
  return data.result;
}

export async function tg(botToken, method, params = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  return telegramResult(resp, method);
}

export function sendMessage(botToken, chat_id, text, extra = {}) {
  return tg(botToken, 'sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });
}

export async function sendMedia(botToken, chat_id, media, extra = {}) {
  const isPhoto = media.type === 'image';
  const method = isPhoto ? 'sendPhoto' : media.mime === 'video/mp4' ? 'sendVideo' : 'sendDocument';
  const field = isPhoto ? 'photo' : method === 'sendVideo' ? 'video' : 'document';
  const form = new FormData();
  form.set('chat_id', String(chat_id));
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') form.set(key, String(value));
  }

  // ponytail: the 20 MB application cap keeps one-buffer Bot API uploads bounded.
  const bytes = await readFile(media.absolutePath);
  form.set(field, new Blob([bytes], { type: media.mime }), media.name);

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    body: form,
  });
  return telegramResult(resp, method);
}

export async function getTelegramFile(botToken, fileId) {
  const file = await tg(botToken, 'getFile', { file_id: fileId });
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`);
  if (!response.ok) throw new Error(`Telegram file download failed: HTTP ${response.status}`);
  return { file, response };
}

export function createForumTopic(botToken, chat_id, name) {
  return tg(botToken, 'createForumTopic', { chat_id, name });
}

export function closeForumTopic(botToken, chat_id, message_thread_id) {
  return tg(botToken, 'closeForumTopic', { chat_id, message_thread_id });
}

export function reopenForumTopic(botToken, chat_id, message_thread_id) {
  return tg(botToken, 'reopenForumTopic', { chat_id, message_thread_id });
}

export function deleteForumTopic(botToken, chat_id, message_thread_id) {
  return tg(botToken, 'deleteForumTopic', { chat_id, message_thread_id });
}

export function pinChatMessage(botToken, chat_id, message_id) {
  return tg(botToken, 'pinChatMessage', { chat_id, message_id });
}

export function setWebhook(botToken, url, secret_token) {
  return tg(botToken, 'setWebhook', { url, secret_token });
}

// Agent commands shown in Telegram's "/" autocomplete. One bot per tenant, so default scope is fine.
export const AGENT_COMMANDS = [
  { command: 'close', description: '关闭当前会话（客户再次发消息可重新开启）' },
  { command: 'note', description: '添加内部备注（不会发送给客户）' },
];

export function setMyCommands(botToken, commands = AGENT_COMMANDS) {
  return tg(botToken, 'setMyCommands', { commands });
}

// Escape text for Telegram HTML parse mode.
export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
