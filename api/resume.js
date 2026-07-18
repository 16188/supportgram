// GET /c/:token — Resume conversation page
// Served via Vercel rewrite from /c/:token

import { getConversationByToken, getBusiness, getMessages } from '../db/index.js';
import { config } from '../config.js';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const token = req.query.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).html('<!DOCTYPE html><html><head><title>Invalid Link</title></head><body>This conversation link is invalid or expired.</body></html>');
  }

  let conversation;
  let business;
  let messages = [];

  try {
    conversation = await getConversationByToken(token);
    if (!conversation) {
      return res.status(404).setHeader('Content-Type', 'text/html').send('<!DOCTYPE html><html><head><title>Invalid Link</title></head><body>This conversation link is invalid or expired.</body></html>');
    }

    business = await getBusiness(conversation.business_id);
    if (!business) {
      return res.status(404).setHeader('Content-Type', 'text/html').send('<!DOCTYPE html><html><head><title>Invalid Link</title></head><body>This conversation link is invalid or expired.</body></html>');
    }

    messages = await getMessages(conversation.id);
  } catch (err) {
    console.error('resume: lookup failed:', err);
    return res.status(500).setHeader('Content-Type', 'text/html').send('<!DOCTYPE html><html><head><title>Error</title></head><body>An error occurred. Please try again.</body></html>');
  }

  const businessNameEsc = escapeHtml(business.name);
  const messagesJson = JSON.stringify(
    messages
      .filter((m) => m.direction !== 'note')
      .map((m) => ({
        id: Number(m.id),
        direction: m.direction,
        sender: m.sender_label || (m.direction === 'in' ? conversation.customer_name : 'Agent'),
        body: m.body,
        at: m.created_at,
      }))
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conversation with ${businessNameEsc}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      margin: 0;
      padding: 16px;
      color: #333;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e0e0e0; }
      .container { background: #2a2a2a; }
      .message.in { background: #0d47a1; }
      .message.out { background: #424242; }
      textarea { background: #333; color: #e0e0e0; border-color: #555; }
    }
    .container {
      max-width: 560px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .header {
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;
      background: #f9f9f9;
    }
    @media (prefers-color-scheme: dark) {
      .header { background: #333; border-color: #444; }
    }
    .header h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      display: flex;
      max-width: 85%;
      word-wrap: break-word;
    }
    .message.in {
      align-self: flex-end;
      background: #1E8FD5;
      color: white;
      padding: 10px 12px;
      border-radius: 4px;
    }
    .message.out {
      align-self: flex-start;
      background: #e0e0e0;
      color: #333;
      padding: 10px 12px;
      border-radius: 4px;
    }
    .message.out .sender {
      font-size: 12px;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    @media (prefers-color-scheme: dark) {
      .message.out { background: #424242; color: #e0e0e0; }
    }
    .divider {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin: 12px 0;
      padding: 8px 0;
    }
    .input-area {
      padding: 16px;
      border-top: 1px solid #e0e0e0;
      background: #f9f9f9;
    }
    @media (prefers-color-scheme: dark) {
      .input-area { background: #333; border-color: #444; }
    }
    textarea {
      width: 100%;
      min-height: 60px;
      max-height: 120px;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-family: inherit;
      resize: vertical;
      font-size: 14px;
    }
    .button-row {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    button {
      flex: 1;
      padding: 10px;
      background: #1E8FD5;
      color: white;
      border: none;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background: #1a7fb8;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .error {
      background: #fee;
      color: #c33;
      padding: 10px;
      border-radius: 4px;
      margin-top: 8px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Conversation with ${businessNameEsc}</h1>
    </div>
    <div class="messages" id="messages"></div>
    <div class="input-area" id="inputArea">
      <textarea id="messageInput" placeholder="Type your message..." maxlength="4000"></textarea>
      <div class="button-row">
        <button id="sendBtn">Send</button>
      </div>
      <div id="error"></div>
    </div>
  </div>

  <script>
    const tokenData = ${JSON.stringify({ token })};
    const messagesData = ${messagesJson};
    const conversationStatus = ${JSON.stringify(conversation.status)};

    let lastMessageId = 0;

    function renderMessages() {
      const container = document.getElementById('messages');
      container.innerHTML = '';

      if (conversationStatus === 'closed') {
        const divider = document.createElement('div');
        divider.className = 'divider';
        divider.textContent = 'Conversation ended';
        container.appendChild(divider);
      }

      messagesData.forEach((msg) => {
        const div = document.createElement('div');
        div.className = 'message ' + msg.direction;

        if (msg.direction === 'out') {
          const sender = document.createElement('div');
          sender.className = 'sender';
          sender.textContent = msg.sender || 'Agent';
          div.appendChild(sender);
        }

        const text = document.createElement('div');
        text.textContent = msg.body;
        div.appendChild(text);
        container.appendChild(div);

        lastMessageId = Math.max(lastMessageId, msg.id);
      });

      container.scrollTop = container.scrollHeight;
    }

    function showError(msg) {
      const errDiv = document.getElementById('error');
      errDiv.textContent = msg;
      setTimeout(() => {
        errDiv.textContent = '';
      }, 3000);
    }

    async function sendMessage() {
      const input = document.getElementById('messageInput');
      const message = input.value.trim();
      if (!message) return;

      const btn = document.getElementById('sendBtn');
      btn.disabled = true;

      try {
        const response = await fetch('/api/c/' + tokenData.token + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          showError(data.error || 'Failed to send message');
          return;
        }

        input.value = '';
        pollMessages();
      } catch (err) {
        showError('Network error');
      } finally {
        btn.disabled = false;
      }
    }

    async function pollMessages() {
      try {
        const response = await fetch('/api/c/' + tokenData.token + '/messages?after=' + lastMessageId);
        if (response.status === 404) {
          showError('Conversation not found');
          return;
        }
        if (!response.ok) return;

        const data = await response.json();
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach((msg) => {
            messagesData.push(msg);
            lastMessageId = Math.max(lastMessageId, msg.id);
          });
          renderMessages();
        }
      } catch (err) {
        // Poll errors are silent
      }
    }

    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Remove token from URL immediately for security.
    window.history.replaceState(null, '', '/c/session');

    renderMessages();

    // Poll for new messages every 3 seconds while visible.
    setInterval(() => {
      if (!document.hidden) {
        pollMessages();
      }
    }, 3000);
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
