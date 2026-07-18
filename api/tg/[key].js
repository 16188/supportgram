// POST /api/tg/:key — Telegram webhook for one tenant's bot.

import { getBusinessByKey } from '../../db/index.js';
import { handleTelegramUpdate } from '../../lib/relay.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  let business;
  try {
    business = await getBusinessByKey(req.query.key);
  } catch (err) {
    console.error('tg webhook: business lookup failed:', err);
    return res.status(200).json({ ok: true });
  }
  if (!business) {
    return res.status(404).json({ ok: false });
  }

  if (req.headers['x-telegram-bot-api-secret-token'] !== business.webhook_secret) {
    return res.status(401).json({ ok: false });
  }

  try {
    const result = await handleTelegramUpdate(business, req.body || {});
    if (result?.deliver) {
      // Email module is optional/best-effort — must never break the webhook.
      try {
        const { notifyCustomerIfOffline } = await import('../../lib/email.js');
        await notifyCustomerIfOffline(result.deliver, business);
      } catch {
        // email module missing or failed — ignore
      }
    }
  } catch (err) {
    // Always ACK Telegram so it doesn't retry-storm.
    console.error('tg webhook: handler error:', err);
  }

  return res.status(200).json({ ok: true });
}
