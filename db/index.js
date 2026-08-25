import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { config } from '../config.js';
import { statements, migrations } from './schema.js';

// For local file databases, make sure the directory exists before libsql opens it.
if (config.TURSO_DATABASE_URL.startsWith('file:')) {
  const filePath = config.TURSO_DATABASE_URL.slice('file:'.length);
  const dir = path.dirname(filePath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
}

export const client = createClient({
  url: config.TURSO_DATABASE_URL,
  authToken: config.TURSO_AUTH_TOKEN || undefined,
});

export async function initSchema() {
  for (const sql of statements) {
    await client.execute(sql);
  }
  for (const sql of migrations) {
    try {
      await client.execute(sql);
    } catch (err) {
      if (!/duplicate column/i.test(err.message || '')) throw err;
    }
  }
}

// Lazily initialize the schema exactly once; every query awaits this.
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = initSchema();
  return readyPromise;
}

async function q(sql, args = []) {
  await ready();
  return client.execute({ sql, args });
}

// libsql rows are array-like with column metadata — normalize to plain objects.
function toObjects(result) {
  return result.rows.map((row) => {
    const obj = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

function firstRow(result) {
  return toObjects(result)[0];
}

export async function getAllBusinesses() {
  return toObjects(await q('SELECT * FROM businesses'));
}

export async function getBusiness(id) {
  return firstRow(await q('SELECT * FROM businesses WHERE id = ?', [id]));
}

export async function getBusinessByKey(public_key) {
  return firstRow(await q('SELECT * FROM businesses WHERE public_key = ?', [public_key]));
}

// Verified-identity conversation list: newest first, with a one-line preview each.
export async function listConversationsByEmail(businessId, email, limit = 20) {
  return toObjects(await q(
    `SELECT c.resume_token AS token, c.status, c.last_activity_at,
            (SELECT body FROM messages WHERE conversation_id = c.id AND direction != 'note' ORDER BY id DESC LIMIT 1) AS last_body,
            (SELECT created_at FROM messages WHERE conversation_id = c.id AND direction != 'note' ORDER BY id DESC LIMIT 1) AS last_at
     FROM conversations c
     WHERE c.business_id = ? AND lower(c.customer_email) = lower(?)
     ORDER BY c.last_activity_at DESC
     LIMIT ?`,
    [businessId, email, limit]
  ));
}

export async function getActiveAgents(businessId) {
  return toObjects(await q(
    'SELECT * FROM agents WHERE business_id = ? AND active = 1 ORDER BY rotation_order',
    [businessId]
  ));
}

export async function getNextAgent(businessId) {
  const agent = firstRow(await q(
    `SELECT * FROM agents
     WHERE business_id = ? AND active = 1
     ORDER BY COALESCE(last_suggested_at, '1900-01-01') ASC, rotation_order ASC
     LIMIT 1`,
    [businessId]
  ));
  if (agent) {
    await q("UPDATE agents SET last_suggested_at = datetime('now') WHERE id = ?", [agent.id]);
  }
  return agent;
}

export async function createConversation(fields) {
  const result = await q(
    `INSERT INTO conversations (business_id, customer_name, customer_email, page_url, ip_hash, resume_token)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      fields.business_id,
      fields.customer_name,
      fields.customer_email,
      fields.page_url || null,
      fields.ip_hash || null,
      fields.resume_token,
    ]
  );
  return getConversationById(Number(result.lastInsertRowid));
}

export async function getConversationByToken(token) {
  return firstRow(await q('SELECT * FROM conversations WHERE resume_token = ?', [token]));
}

export async function getConversationById(id) {
  return firstRow(await q('SELECT * FROM conversations WHERE id = ?', [id]));
}

export async function getConversationByTopic(businessId, topicId) {
  return firstRow(await q(
    'SELECT * FROM conversations WHERE business_id = ? AND topic_id = ?',
    [businessId, topicId]
  ));
}

export async function updateConversation(id, fields) {
  // Whitelist allowed fields
  const allowed = ['topic_id', 'status', 'assigned_agent_id', 'last_email_at', 'last_seen_at', 'last_activity_at'];
  const updates = {};

  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return getConversationById(id);
  }

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(updates);

  await q(`UPDATE conversations SET ${setClauses} WHERE id = ?`, [...values, id]);

  return getConversationById(id);
}

export async function touchConversation(id) {
  await q("UPDATE conversations SET last_activity_at = datetime('now') WHERE id = ?", [id]);
}

export async function countConversationsByEmail(businessId, email) {
  const row = firstRow(await q(
    'SELECT COUNT(*) as count FROM conversations WHERE business_id = ? AND customer_email = ?',
    [businessId, email]
  ));
  return Number(row.count);
}

export async function countRecentConversationsByIp(businessId, ipHash, minutes) {
  const row = firstRow(await q(
    `SELECT COUNT(*) as count FROM conversations
     WHERE business_id = ? AND ip_hash = ?
       AND created_at >= datetime('now', '-' || ? || ' minutes')`,
    [businessId, ipHash, minutes]
  ));
  return Number(row.count);
}

export async function countRecentMessages(conversationId, seconds) {
  const row = firstRow(await q(
    `SELECT COUNT(*) as count FROM messages
     WHERE conversation_id = ?
       AND created_at >= datetime('now', '-' || ? || ' seconds')`,
    [conversationId, seconds]
  ));
  return Number(row.count);
}

export async function isVisitorBlocked(businessId, email, ipHash) {
  const row = firstRow(await q(
    `SELECT 1 AS blocked FROM blocked_visitors
     WHERE business_id = ?
       AND (email = lower(?) OR (? != '' AND ip_hash = ?))
     LIMIT 1`,
    [businessId, email, ipHash || '', ipHash || '']
  ));
  return Boolean(row);
}

export async function blockVisitor(businessId, email, ipHash) {
  await q(
    `INSERT INTO blocked_visitors (business_id, email, ip_hash)
     VALUES (?, lower(?), ?)
     ON CONFLICT(business_id, email) DO UPDATE SET ip_hash = excluded.ip_hash`,
    [businessId, email, ipHash || null]
  );
}

export async function unblockVisitor(businessId, email) {
  const result = await q(
    'DELETE FROM blocked_visitors WHERE business_id = ? AND email = lower(?)',
    [businessId, email]
  );
  return Number(result.rowsAffected) > 0;
}

export async function addMessage(fields) {
  const result = await q(
    `INSERT INTO messages
       (conversation_id, direction, sender_label, body, tg_message_id,
        media_type, media_path, media_name, media_mime, media_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fields.conversation_id,
      fields.direction,
      fields.sender_label || null,
      fields.body,
      fields.tg_message_id || null,
      fields.media_type || null,
      fields.media_path || null,
      fields.media_name || null,
      fields.media_mime || null,
      fields.media_size || null,
    ]
  );
  await touchConversation(fields.conversation_id);
  return {
    id: Number(result.lastInsertRowid),
    conversation_id: fields.conversation_id,
    direction: fields.direction,
    sender_label: fields.sender_label || null,
    body: fields.body,
    tg_message_id: fields.tg_message_id || null,
    media_type: fields.media_type || null,
    media_path: fields.media_path || null,
    media_name: fields.media_name || null,
    media_mime: fields.media_mime || null,
    media_size: fields.media_size || null,
    created_at: new Date().toISOString(),
  };
}

export async function editAgentMessage(conversationId, telegramMessageId, body) {
  const result = await q(
    `UPDATE messages SET body = ?
     WHERE conversation_id = ? AND tg_message_id = ? AND direction = 'out'`,
    [body, conversationId, telegramMessageId]
  );
  return Number(result.rowsAffected) > 0;
}

export async function deleteAgentMessage(conversationId, telegramMessageId) {
  const message = firstRow(await q(
    `SELECT * FROM messages
     WHERE conversation_id = ? AND tg_message_id = ? AND direction = 'out'
     LIMIT 1`,
    [conversationId, telegramMessageId]
  ));
  if (!message) return null;
  await q('DELETE FROM messages WHERE id = ?', [message.id]);
  return message;
}

export async function getConversationMediaBytes(conversationId) {
  const row = firstRow(await q(
    'SELECT COALESCE(SUM(media_size), 0) AS total FROM messages WHERE conversation_id = ?',
    [conversationId]
  ));
  return Number(row.total) || 0;
}

export async function getMessages(conversationId) {
  return toObjects(await q('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', [conversationId]));
}

export async function getMessageMedia(conversationId, storageName) {
  return firstRow(await q(
    `SELECT media_type, media_path, media_name, media_mime, media_size
     FROM messages
     WHERE conversation_id = ? AND media_path = ?
     LIMIT 1`,
    [conversationId, `uploads/${storageName}`]
  ));
}

export async function getExpiredConversations(days) {
  return toObjects(await q(
    `SELECT * FROM conversations WHERE last_activity_at < datetime('now', '-' || ? || ' days')`,
    [days]
  ));
}

export async function deleteConversationCascade(id) {
  await ready();
  const mediaRows = toObjects(await q(
    'SELECT DISTINCT media_path FROM messages WHERE conversation_id = ? AND media_path IS NOT NULL',
    [id]
  ));
  await client.batch(
    [
      { sql: 'DELETE FROM messages WHERE conversation_id = ?', args: [id] },
      { sql: 'DELETE FROM conversations WHERE id = ?', args: [id] },
    ],
    'write'
  );
  return mediaRows.map((row) => row.media_path);
}

export default client;
