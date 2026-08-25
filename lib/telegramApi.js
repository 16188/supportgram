// Raw Telegram Bot API client — no SDK, global fetch.

export async function tg(botToken, method, params = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
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

export function sendMessage(botToken, chat_id, text, extra = {}) {
  return tg(botToken, 'sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });
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
