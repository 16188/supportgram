// Conversation lifecycle: widget <-> Telegram forum topics.

import crypto from 'crypto';
import * as db from '../db/index.js';
import {
  sendMessage,
  createForumTopic,
  closeForumTopic,
  reopenForumTopic,
  pinChatMessage,
  esc,
} from './telegramApi.js';

function agentMention(agent) {
  if (agent.tg_username) return `@${agent.tg_username}`;
  return `<a href="tg://user?id=${agent.tg_user_id}">${esc(agent.display_name)}</a>`;
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
          `Email: ${esc(email)}`,
          `Page: ${esc(pageUrl || '—')}`,
          `Prior conversations: ${priorCount}`,
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
          `New conversation — suggested: ${agentMention(agent)}`,
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

  if (conversation.status === 'closed') {
    await db.updateConversation(conversation.id, { status: 'open' });
    if (conversation.topic_id) {
      try {
        await reopenForumTopic(business.bot_token, business.supergroup_id, conversation.topic_id);
      } catch (err) {
        console.error('customerMessage: reopen topic failed:', err.message);
      }
      try {
        await sendMessage(business.bot_token, business.supergroup_id, '— reopened by customer —', {
          message_thread_id: conversation.topic_id,
        });
      } catch (err) {
        console.error('customerMessage: reopen note failed:', err.message);
      }
    }
  }

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

export async function handleTelegramUpdate(business, update) {
  const msg = update?.message;
  if (!msg) return null;
  if (!msg.message_thread_id) return null;
  if (String(msg.chat?.id) !== String(business.supergroup_id)) return null;
  if (msg.from?.is_bot) return null;

  const conversation = await db.getConversationByTopic(business.id, msg.message_thread_id);
  if (!conversation) return null;

  const text = msg.text || msg.caption || '';
  if (!text) return null;

  const topicExtra = { message_thread_id: conversation.topic_id };

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
      body: '[closed]',
    });
    try {
      await sendMessage(business.bot_token, business.supergroup_id, 'Closed ✅', topicExtra);
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
      await sendMessage(business.bot_token, business.supergroup_id, '🗒 noted (internal)', topicExtra);
    } catch (err) {
      console.error('handleTelegramUpdate: note ack failed:', err.message);
    }
    return null;
  }

  // Regular agent reply → relay to customer
  const agents = await db.getActiveAgents(business.id);
  const agent = agents.find((a) => Number(a.tg_user_id) === Number(msg.from?.id));
  const senderLabel = agent ? agent.display_name : msg.from?.first_name || 'Agent';

  await db.addMessage({
    conversation_id: conversation.id,
    direction: 'out',
    sender_label: senderLabel,
    body: text,
    tg_message_id: msg.message_id,
  });

  let updated = conversation;
  if (conversation.assigned_agent_id == null && agent) {
    updated = await db.updateConversation(conversation.id, { assigned_agent_id: agent.id });
  }

  // Caller may trigger the offline-customer email notification.
  return { deliver: updated };
}
