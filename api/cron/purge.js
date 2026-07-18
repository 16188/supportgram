// GET /api/cron/purge — Vercel Cron handler for 90-day purge

import { config } from '../../config.js';
import {
  getExpiredConversations,
  getBusiness,
  deleteConversationCascade,
} from '../../db/index.js';
import { deleteForumTopic } from '../../lib/telegramApi.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  // Auth: if CRON_SECRET is set, require authorization header.
  if (config.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${config.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  let purged = 0;

  try {
    const expired = await getExpiredConversations(90);

    for (const conversation of expired) {
      try {
        // Delete the Telegram forum topic if it exists.
        if (conversation.topic_id) {
          const business = await getBusiness(conversation.business_id);
          if (business && business.bot_token) {
            try {
              await deleteForumTopic(business.bot_token, business.supergroup_id, conversation.topic_id);
            } catch (err) {
              console.error(`purge: deleteForumTopic failed for conversation ${conversation.id}:`, err.message);
            }
          }
        }

        // Delete the conversation and all its messages.
        await deleteConversationCascade(conversation.id);
        purged++;
      } catch (err) {
        console.error(`purge: failed to delete conversation ${conversation.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('purge: query failed:', err);
    return res.status(500).json({ error: 'query failed' });
  }

  return res.status(200).json({ purged });
}
