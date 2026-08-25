// Conversation lifecycle: widget <-> Telegram forum topics.

import crypto from 'crypto';
import { Readable } from 'node:stream';
import * as db from '../db/index.js';
import { discardMedia, mediaRule, storeMedia } from './media.js';
import {
  sendMessage,
  sendMedia,
  getTelegramFile,
  createForumTopic,
  closeForumTopic,
  deleteForumTopic,
  reopenForumTopic,
  pinChatMessage,
  deleteMessage,
  esc,
} from './telegramApi.js';

function agentMention(agent) {
  if (agent.tg_username) return `@${agent.tg_username}`;
  return `<a href="tg://user?id=${agent.tg_user_id}">${esc(agent.display_name)}</a>`;
}

async function reopenIfClosed(conversation, business) {
  if (conversation.status !== 'closed') return;

  try {
    await db.updateConversation(conversation.id, { status: 'open' });
  } catch (err) {
    console.error('reopenIfClosed: update conversation failed:', err.message);
    return;
  }
  if (!conversation.topic_id) return;

  try {
    await reopenForumTopic(business.bot_token, business.supergroup_id, conversation.topic_id);
  } catch (err) {
    console.error('reopenIfClosed: reopen topic failed:', err.message);
  }
  try {
    await sendMessage(business.bot_token, business.supergroup_id, '— 客户已重新开启会话 —', {
      message_thread_id: conversation.topic_id,
    });
  } catch (err) {
    console.error('reopenIfClosed: reopen note failed:', err.message);
  }
}

export async function startConversation({ business, name, email, pageUrl, firstMessage, ipHash }) {
  const resumeToken = crypto.randomBytes(16).toString('hex');

  // Count prior conversations for this email BEFORE inserting the new row.
  let priorCount = 0;
  try {
    priorCount = await db.countConversationsByEmail(business.id, email);
  } catch (err) {
    console.error('startConversation: prior count failed:', err.message);
  }

  let conversation = await db.createConversation({
    business_id: business.id,
    customer_name: name,
    customer_email: email,
    page_url: pageUrl || null,
    ip_hash: ipHash || null,
    resume_token: resumeToken,
  });

  // Store the customer's first message regardless of Telegram availability —
  // never lose the customer.
  await db.addMessage({
    conversation_id: conversation.id,
    direction: 'in',
    sender_label: name,
    body: firstMessage,
  });

  const emailDomain = email.includes('@') ? email.split('@').pop() : email;

  try {
    const topic = await createForumTopic(
      business.bot_token,
      business.supergroup_id,
      `${name} — ${emailDomain}`
    );
    const topicId = topic.message_thread_id;

    // Pinned info card
    try {
      const card = await sendMessage(
        business.bot_token,
        business.supergroup_id,
        [
          `<b>${esc(name)}</b>`,
          `邮箱：${esc(email)}`,
          `访问页面：${esc(pageUrl || '—')}`,
          `历史会话数：${priorCount}`,
        ].join('\n'),
        { message_thread_id: topicId }
      );
      try {
        await pinChatMessage(business.bot_token, business.supergroup_id, card.message_id);
      } catch (err) {
        console.error('startConversation: pin failed:', err.message);
      }
    } catch (err) {
      console.error('startConversation: info card failed:', err.message);
    }

    // Round-robin suggestion
    try {
      const agent = await db.getNextAgent(business.id);
      if (agent) {
        await sendMessage(
          business.bot_token,
          business.supergroup_id,
          `新会话，建议接待：${agentMention(agent)}`,
          { message_thread_id: topicId }
        );
      }
    } catch (err) {
      console.error('startConversation: suggestion failed:', err.message);
    }

    // The customer's first message
    try {
      await sendMessage(business.bot_token, business.supergroup_id, esc(firstMessage), {
        message_thread_id: topicId,
      });
    } catch (err) {
      console.error('startConversation: first message relay failed:', err.message);
    }

    conversation = await db.updateConversation(conversation.id, { topic_id: topicId });
  } catch (err) {
    // Topic creation failed — keep the conversation (topic_id null), don't lose the customer.
    console.error('startConversation: topic creation failed:', err.message);
  }

  return conversation;
}

export async function customerMessage(conversation, business, body) {
  await db.addMessage({
    conversation_id: conversation.id,
    direction: 'in',
    sender_label: conversation.customer_name,
    body,
  });

  await reopenIfClosed(conversation, business);

  if (conversation.topic_id) {
    try {
      await sendMessage(business.bot_token, business.supergroup_id, esc(body), {
        message_thread_id: conversation.topic_id,
      });
    } catch (err) {
      console.error('customerMessage: relay failed:', err.message);
    }
  }
}

export async function customerMedia(conversation, business, media) {
  const body = media.type === 'image' ? '[图片]' : '[视频]';

  await db.addMessage({
    conversation_id: conversation.id,
    direction: 'in',
    sender_label: conversation.customer_name,
    body,
    media_type: media.type,
    media_path: media.path,
    media_name: media.name,
    media_mime: media.mime,
    media_size: media.size,
  });

  await reopenIfClosed(conversation, business);

  if (conversation.topic_id) {
    try {
      await sendMedia(business.bot_token, business.supergroup_id, media, {
        message_thread_id: conversation.topic_id,
        caption: media.name,
        supports_streaming: media.mime === 'video/mp4' ? true : undefined,
      });
    } catch (err) {
      console.error('customerMedia: relay failed:', err.message);
    }
  }
}

function telegramAttachment(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1];
    return {
      fileId: photo.file_id,
      mime: 'image/jpeg',
      name: `photo-${msg.message_id}.jpg`,
      size: Number(photo.file_size) || 0,
    };
  }
  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      mime: msg.video.mime_type || 'video/mp4',
      name: msg.video.file_name || `video-${msg.message_id}.mp4`,
      size: Number(msg.video.file_size) || 0,
    };
  }
  if (msg.document?.mime_type?.startsWith('image/') || msg.document?.mime_type?.startsWith('video/')) {
    return {
      fileId: msg.document.file_id,
      mime: msg.document.mime_type,
      name: msg.document.file_name || `media-${msg.message_id}`,
      size: Number(msg.document.file_size) || 0,
    };
  }
  return null;
}

export function deleteCommand(text) {
  const command = String(text || '').trim();
  if (/^\/delete(?:@\w+)?\s+confirm$/i.test(command)) return 'confirm';
  if (/^\/delete(?:@\w+)?(?:\s.*)?$/i.test(command)) return 'prompt';
  return null;
}

export function undoCommand(text) {
  return /^\/undo(?:@\w+)?$/i.test(String(text || '').trim());
}

export function blockCommand(text) {
  const command = String(text || '').trim();
  if (/^\/block(?:@\w+)?$/i.test(command)) return 'block';
  if (/^\/unblock(?:@\w+)?$/i.test(command)) return 'unblock';
  return null;
}

export async function handleTelegramUpdate(business, update) {
  const edited = Boolean(update?.edited_message);
  const msg = update?.message || update?.edited_message;
  if (!msg) return null;
  if (!msg.message_thread_id) return null;
  if (String(msg.chat?.id) !== String(business.supergroup_id)) return null;
  if (msg.from?.is_bot) return null;

  const conversation = await db.getConversationByTopic(business.id, msg.message_thread_id);
  if (!conversation) return null;

  const text = msg.text || msg.caption || '';
  const attachment = telegramAttachment(msg);
  if (!text && !attachment) return null;

  const topicExtra = { message_thread_id: conversation.topic_id };

  if (edited) {
    const body = text || (attachment?.mime?.startsWith('image/') ? '[图片]' : '[视频]');
    await db.editAgentMessage(conversation.id, msg.message_id, body);
    return null;
  }

  if (undoCommand(text)) {
    const agents = await db.getActiveAgents(business.id);
    const agent = agents.find((candidate) => Number(candidate.tg_user_id) === Number(msg.from?.id));
    if (!agent) {
      await sendMessage(business.bot_token, business.supergroup_id, '只有已配置的客服可以撤回消息。', topicExtra);
      return null;
    }

    const targetMessageId = msg.reply_to_message?.message_id;
    if (!targetMessageId) {
      await sendMessage(business.bot_token, business.supergroup_id, '请回复需要撤回的客服消息，并发送 <code>/undo</code>。', topicExtra);
      return null;
    }

    const removed = await db.deleteAgentMessage(conversation.id, targetMessageId);
    if (!removed) {
      await sendMessage(business.bot_token, business.supergroup_id, '只能撤回已经同步到访客页面的客服消息。', topicExtra);
      return null;
    }

    if (removed.media_path && !await discardMedia(removed.media_path)) {
      await sendMessage(business.bot_token, business.supergroup_id, '消息已从访客页面撤回，但 VPS 媒体文件删除失败，请检查容器日志。', topicExtra);
    }

    try {
      await deleteMessage(business.bot_token, business.supergroup_id, targetMessageId);
    } catch (error) {
      console.error('handleTelegramUpdate: delete Telegram message failed:', error.message);
      await sendMessage(
        business.bot_token,
        business.supergroup_id,
        '消息已从访客页面撤回，但 Telegram 原消息删除失败。请确认消息未超过 48 小时，且机器人拥有“删除消息”权限。',
        topicExtra
      );
    }
    try {
      await deleteMessage(business.bot_token, business.supergroup_id, msg.message_id);
    } catch { /* best effort */ }
    return null;
  }

  const blockAction = blockCommand(text);
  if (blockAction) {
    const agents = await db.getActiveAgents(business.id);
    const agent = agents.find((candidate) => Number(candidate.tg_user_id) === Number(msg.from?.id));
    if (!agent) {
      await sendMessage(business.bot_token, business.supergroup_id, '只有已配置的客服可以管理黑名单。', topicExtra);
      return null;
    }

    if (blockAction === 'block') {
      await db.blockVisitor(business.id, conversation.customer_email, conversation.ip_hash);
      await db.updateConversation(conversation.id, { status: 'blocked' });
      await sendMessage(
        business.bot_token,
        business.supergroup_id,
        '访客已拉黑：现有会话、新会话及媒体上传均已停止。发送 <code>/unblock</code> 可解除。',
        topicExtra
      );
    } else {
      await db.unblockVisitor(business.id, conversation.customer_email);
      await db.updateConversation(conversation.id, { status: 'open' });
      await sendMessage(business.bot_token, business.supergroup_id, '访客黑名单已解除，可以继续会话。', topicExtra);
    }
    return null;
  }

  const deleteAction = deleteCommand(text);
  if (deleteAction) {
    const agents = await db.getActiveAgents(business.id);
    const agent = agents.find((candidate) => Number(candidate.tg_user_id) === Number(msg.from?.id));
    if (!agent) {
      await sendMessage(business.bot_token, business.supergroup_id, '只有已配置的客服可以永久删除会话。', topicExtra);
      return null;
    }
    if (deleteAction === 'prompt') {
      await sendMessage(
        business.bot_token,
        business.supergroup_id,
        '⚠️ 此操作会永久删除数据库记录、VPS 媒体文件和当前 Telegram 话题。确认删除请输入 <code>/delete confirm</code>',
        topicExtra
      );
      return null;
    }

    let mediaPaths;
    try {
      mediaPaths = await db.deleteConversationCascade(conversation.id);
    } catch (error) {
      console.error('handleTelegramUpdate: delete conversation failed:', error.message);
      await sendMessage(business.bot_token, business.supergroup_id, '删除失败，数据库数据未被删除，请稍后重试。', topicExtra);
      return null;
    }

    let failedFiles = 0;
    for (const mediaPath of mediaPaths) {
      if (!await discardMedia(mediaPath)) failedFiles++;
    }
    if (failedFiles > 0) {
      await sendMessage(
        business.bot_token,
        business.supergroup_id,
        `数据库已删除，但有 ${failedFiles} 个 VPS 媒体文件删除失败，请检查容器日志后手动处理。`,
        topicExtra
      );
      return null;
    }

    try {
      await deleteForumTopic(business.bot_token, business.supergroup_id, conversation.topic_id);
    } catch (error) {
      console.error('handleTelegramUpdate: delete topic failed:', error.message);
      await sendMessage(
        business.bot_token,
        business.supergroup_id,
        '数据库和 VPS 文件已删除，但 Telegram 话题删除失败，请手动删除当前话题。',
        topicExtra
      );
    }
    return null;
  }

  if (text.startsWith('/close')) {
    await db.updateConversation(conversation.id, { status: 'closed' });
    try {
      await closeForumTopic(business.bot_token, business.supergroup_id, conversation.topic_id);
    } catch (err) {
      console.error('handleTelegramUpdate: close topic failed:', err.message);
    }
    await db.addMessage({
      conversation_id: conversation.id,
      direction: 'note',
      body: '[已关闭]',
    });
    try {
      await sendMessage(business.bot_token, business.supergroup_id, '会话已关闭 ✅', topicExtra);
    } catch (err) {
      console.error('handleTelegramUpdate: close ack failed:', err.message);
    }
    return null;
  }

  if (text.startsWith('/note ')) {
    await db.addMessage({
      conversation_id: conversation.id,
      direction: 'note',
      sender_label: msg.from?.first_name || null,
      body: text.slice('/note '.length),
    });
    try {
      await sendMessage(business.bot_token, business.supergroup_id, '🗒 已记录（内部备注）', topicExtra);
    } catch (err) {
      console.error('handleTelegramUpdate: note ack failed:', err.message);
    }
    return null;
  }

  // Regular agent reply → relay to customer
  const agents = await db.getActiveAgents(business.id);
  const agent = agents.find((a) => Number(a.tg_user_id) === Number(msg.from?.id));
  const senderLabel = agent ? agent.display_name : msg.from?.first_name || '客服';

  let media = null;
  if (attachment) {
    try {
      mediaRule(attachment.mime, attachment.size);
      const { file, response } = await getTelegramFile(business.bot_token, attachment.fileId);
      if (!response.body) throw new Error('Telegram returned an empty file');
      media = await storeMedia(Readable.fromWeb(response.body), {
        mime: attachment.mime,
        name: attachment.name,
        size: Number(file.file_size) || attachment.size,
      });
    } catch (err) {
      console.error('handleTelegramUpdate: media download failed:', err.message);
      try {
        await sendMessage(
          business.bot_token,
          business.supergroup_id,
          `媒体同步失败：${esc(err.message)}`,
          topicExtra
        );
      } catch { /* best effort */ }
      return null;
    }
  }

  try {
    await db.addMessage({
      conversation_id: conversation.id,
      direction: 'out',
      sender_label: senderLabel,
      body: text || (media?.type === 'image' ? '[图片]' : '[视频]'),
      tg_message_id: msg.message_id,
      media_type: media?.type,
      media_path: media?.path,
      media_name: media?.name,
      media_mime: media?.mime,
      media_size: media?.size,
    });
  } catch (error) {
    if (media) await discardMedia(media.path);
    throw error;
  }

  let updated = conversation;
  if (conversation.assigned_agent_id == null && agent) {
    updated = await db.updateConversation(conversation.id, { assigned_agent_id: agent.id });
  }

  // Caller may trigger the offline-customer email notification.
  return { deliver: updated };
}
