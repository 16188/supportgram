// GET /c/:token — Resume conversation page
// Served at /c/:token by the self-hosted server (and by a Vercel rewrite for compatibility).

import { getConversationByToken, getBusiness, getMessages } from '../db/index.js';
import { config } from '../config.js';
import { publicMessages } from './c/[token]/messages.js';

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

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const token = req.query.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).html('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>链接无效</title></head><body>此会话链接无效或已过期。</body></html>');
  }

  let conversation;
  let business;
  let messages = [];

  try {
    conversation = await getConversationByToken(token);
    if (!conversation) {
      return res.status(404).setHeader('Content-Type', 'text/html').send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>链接无效</title></head><body>此会话链接无效或已过期。</body></html>');
    }

    business = await getBusiness(conversation.business_id);
    if (!business) {
      return res.status(404).setHeader('Content-Type', 'text/html').send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>链接无效</title></head><body>此会话链接无效或已过期。</body></html>');
    }

    messages = await getMessages(conversation.id);
  } catch (err) {
    console.error('resume: lookup failed:', err);
    return res.status(500).setHeader('Content-Type', 'text/html').send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>发生错误</title></head><body>发生错误，请稍后重试。</body></html>');
  }

  const businessNameEsc = escapeHtml(business.name);
  const messagesJson = jsonForScript(publicMessages(messages, token, conversation.customer_name));

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>与 ${businessNameEsc} 的会话</title>
  <link rel="icon" href="/maitg-logo.png">
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
    .message-media {
      display: block;
      width: 100%;
      max-width: 320px;
      max-height: 360px;
      border-radius: 6px;
      object-fit: contain;
      background: #111;
    }
    .reply-preview {
      border-left: 3px solid currentColor;
      margin-bottom: 7px;
      padding: 5px 7px;
      background: rgba(255, 255, 255, 0.16);
      border-radius: 4px;
      font-size: 12px;
      opacity: 0.82;
    }
    .message.out .reply-preview { background: rgba(0, 0, 0, 0.06); }
    .reply-sender { display: block; font-weight: 600; }
    .reply-body { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .reaction { padding: 1px 6px; border: 1px solid currentColor; border-radius: 10px; font-size: 12px; }
    .media-link { display: block; }
    .media-caption { margin-top: 6px; }
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
      <h1>与 ${businessNameEsc} 的会话</h1>
    </div>
    <div class="messages" id="messages"></div>
    <div class="input-area" id="inputArea">
      <textarea id="messageInput" placeholder="请输入消息..." maxlength="4000"></textarea>
      <input id="mediaInput" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" hidden>
      <div class="button-row">
        <button id="mediaBtn" type="button">发送图片或视频</button>
        <button id="sendBtn">发送</button>
      </div>
      <div id="error"></div>
    </div>
  </div>

  <script>
    const tokenData = ${jsonForScript({ token })};
    let messagesData = ${messagesJson};
    let conversationStatus = ${jsonForScript(conversation.status)};

    function renderMessages() {
      const container = document.getElementById('messages');
      container.innerHTML = '';

      if (['closed', 'blocked'].includes(conversationStatus)) {
        const divider = document.createElement('div');
        divider.className = 'divider';
        divider.textContent = conversationStatus === 'blocked' ? '该会话已停止' : '会话已结束';
        container.appendChild(divider);
      }

      messagesData.forEach((msg) => {
        const div = document.createElement('div');
        div.className = 'message ' + msg.direction;

        if (msg.direction === 'out') {
          const sender = document.createElement('div');
          sender.className = 'sender';
          sender.textContent = msg.sender || '客服';
          div.appendChild(sender);
        }

        if (msg.reply) {
          const reply = document.createElement('div');
          reply.className = 'reply-preview';
          const sender = document.createElement('span');
          sender.className = 'reply-sender';
          sender.textContent = msg.reply.sender || (msg.reply.direction === 'in' ? '访客' : '客服');
          const body = document.createElement('span');
          body.className = 'reply-body';
          body.textContent = msg.reply.body || '[消息]';
          reply.append(sender, body);
          div.appendChild(reply);
        }

        if (msg.media) {
          const media = document.createElement(msg.media.type === 'image' ? 'img' : 'video');
          media.className = 'message-media';
          media.src = msg.media.url;
          media.title = msg.media.name || '';
          if (msg.media.type === 'image') {
            media.loading = 'lazy';
            const link = document.createElement('a');
            link.className = 'media-link';
            link.href = msg.media.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.appendChild(media);
            div.appendChild(link);
          } else {
            media.controls = true;
            media.preload = 'metadata';
            div.appendChild(media);
          }
        }

        if (msg.body && (!msg.media || !['[图片]', '[视频]'].includes(msg.body))) {
          const text = document.createElement('div');
          text.className = msg.media ? 'media-caption' : '';
          text.textContent = msg.body;
          div.appendChild(text);
        }
        if (Array.isArray(msg.reactions) && msg.reactions.length > 0) {
          const reactions = document.createElement('div');
          reactions.className = 'reactions';
          msg.reactions.forEach(({ emoji, count }) => {
            const reaction = document.createElement('span');
            reaction.className = 'reaction';
            reaction.textContent = emoji + (count > 1 ? ' ' + count : '');
            reactions.appendChild(reaction);
          });
          div.appendChild(reactions);
        }
        container.appendChild(div);
      });

      const blocked = conversationStatus === 'blocked';
      const input = document.getElementById('messageInput');
      input.disabled = blocked;
      input.placeholder = blocked ? '该会话已停止' : '请输入消息...';
      document.getElementById('sendBtn').disabled = blocked;
      document.getElementById('mediaBtn').disabled = blocked;

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
      if (conversationStatus === 'blocked') return;
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
          showError(data.error || '消息发送失败');
          return;
        }

        input.value = '';
        pollMessages();
      } catch (err) {
        showError('网络错误，请稍后重试');
      } finally {
        btn.disabled = conversationStatus === 'blocked';
      }
    }

    async function uploadMedia(file) {
      if (conversationStatus === 'blocked') return;
      const limits = {
        'image/jpeg': 10 * 1024 * 1024,
        'image/png': 10 * 1024 * 1024,
        'image/webp': 10 * 1024 * 1024,
        'video/mp4': 20 * 1024 * 1024,
        'video/webm': 20 * 1024 * 1024,
        'video/quicktime': 20 * 1024 * 1024,
      };
      const limit = limits[file.type];
      if (!limit) return showError('只支持 JPG、PNG、WebP 图片和 MP4、WebM、MOV 视频');
      if (file.size > limit) return showError(file.type.startsWith('image/') ? '图片不能超过 10 MB' : '视频不能超过 20 MB');

      const btn = document.getElementById('mediaBtn');
      btn.disabled = true;
      btn.textContent = '上传中...';
      try {
        const response = await fetch('/api/c/' + tokenData.token + '/upload?name=' + encodeURIComponent(file.name), {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          showError(data.error || '文件上传失败');
          return;
        }
        pollMessages();
      } catch {
        showError('网络错误，请稍后重试');
      } finally {
        btn.disabled = conversationStatus === 'blocked';
        btn.textContent = '发送图片或视频';
        document.getElementById('mediaInput').value = '';
      }
    }

    async function pollMessages() {
      try {
        const response = await fetch('/api/c/' + tokenData.token + '/messages');
        if (response.status === 404) {
          showError('未找到该会话');
          return;
        }
        if (!response.ok) return;

        const data = await response.json();
        const statusChanged = conversationStatus !== (data.status || conversationStatus);
        conversationStatus = data.status || conversationStatus;
        if (Array.isArray(data.messages)) {
          // ponytail: full snapshots keep edits/deletions stateless; add revisions only if histories become large.
          const changed = JSON.stringify(messagesData) !== JSON.stringify(data.messages);
          messagesData = data.messages;
          if (changed || statusChanged) renderMessages();
        }
      } catch (err) {
        // Poll errors are silent
      }
    }

    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('mediaBtn').addEventListener('click', () => {
      document.getElementById('mediaInput').click();
    });
    document.getElementById('mediaInput').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) uploadMedia(file);
    });
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
