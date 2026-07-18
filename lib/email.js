// SendGrid transactional email for offline customer notifications.

import { config } from '../config.js';
import { updateConversation } from '../db/index.js';

// Escape HTML for safe embedding in email templates.
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(text ?? '').replace(/[&<>"']/g, (char) => map[char]);
}

export async function notifyCustomerIfOffline(conversation, business) {
  // Skip silently if SendGrid is not configured.
  if (!config.SENDGRID_API_KEY || !config.SENDGRID_FROM_EMAIL) {
    return;
  }

  const now = new Date();

  // Skip if customer is actively polling (last_seen_at within 60 seconds).
  if (conversation.last_seen_at) {
    const lastSeen = new Date(conversation.last_seen_at);
    const secsSinceLastSeen = (now - lastSeen) / 1000;
    if (secsSinceLastSeen < 60) {
      return;
    }
  }

  // Skip if email was already sent within the last hour (1 email per conversation per hour max).
  if (conversation.last_email_at) {
    const lastEmail = new Date(conversation.last_email_at);
    const secsSinceLastEmail = (now - lastEmail) / 1000;
    if (secsSinceLastEmail < 3600) {
      return;
    }
  }

  const resumeUrl = `${config.BASE_URL}/c/${conversation.resume_token}`;
  const businessNameEsc = escapeHtml(business.name);
  const customerNameEsc = escapeHtml(conversation.customer_name);

  const htmlBody = `
    <p>Hi ${customerNameEsc},</p>
    <p>You have a new reply to your support conversation with <strong>${businessNameEsc}</strong>.</p>
    <p>
      <a href="${resumeUrl}" style="display:inline-block;background-color:#1E8FD5;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:bold;">Open conversation</a>
    </p>
    <p>Or visit: ${resumeUrl}</p>
  `;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.SENDGRID_API_KEY}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: conversation.customer_email, name: conversation.customer_name }] }],
        from: { email: config.SENDGRID_FROM_EMAIL, name: business.name },
        subject: `You have a reply from ${business.name}`,
        content: [{ type: 'text/html', value: htmlBody }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error('email: SendGrid API error:', response.status, errBody.slice(0, 300));
      return;
    }

    // Update last_email_at to mark that we sent an email.
    await updateConversation(conversation.id, { last_email_at: now.toISOString() });
  } catch (err) {
    // All failures are logged but never thrown; webhook must always ACK.
    console.error('email: notifyCustomerIfOffline error:', err.message);
  }
}
