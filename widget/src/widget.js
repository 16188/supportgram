(() => {
  // Supportgram embeddable chat widget
  // Vanilla JS, no dependencies, IIFE pattern for bundling

  const state = {
    token: null,
    key: null,
    apiBase: null,
    messages: [],
    lastMessageId: null,
    conversationStatus: 'open',
    pollingInterval: null,
    pollingRate: 3000, // 3s when open
    backgroundRate: 30000, // 30s when closed
    unreadCount: 0,
    isOpen: false,
    name: '',
    email: '',
  };

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function log(...args) {
    if (typeof window !== 'undefined' && window.console) {
      console.log('[supportgram]', ...args);
    }
  }

  function warn(...args) {
    if (typeof window !== 'undefined' && window.console) {
      console.warn('[supportgram]', ...args);
    }
  }

  function findScriptTag() {
    if (document.currentScript) {
      return document.currentScript;
    }
    // Fallback for older browsers
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.includes('widget.js')) {
        return scripts[i];
      }
    }
    return null;
  }

  function initializeState() {
    const script = findScriptTag();
    if (!script) {
      warn('Could not find widget script tag');
      return false;
    }

    state.key = script.getAttribute('data-key');
    if (!state.key) {
      warn('data-key attribute not found on script tag');
      return false;
    }

    // Derive API base from script src origin
    const url = new URL(script.src);
    state.apiBase = url.origin;

    // Try to restore token from localStorage
    const storageKey = `sg_token_${state.key}`;
    state.token = localStorage.getItem(storageKey);

    log('Initialized with key:', state.key, 'api base:', state.apiBase);
    return true;
  }

  function injectStyles() {
    if (document.getElementById('sg-styles')) return;

    const style = document.createElement('style');
    style.id = 'sg-styles';
    style.textContent = `
      .sg-launcher {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background-color: #1E8FD5;
        border: none;
        cursor: pointer;
        box-shadow: 0 2px 12px rgba(30, 143, 213, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        transition: transform 0.2s, box-shadow 0.2s;
        font-size: 0;
        padding: 0;
      }
      .sg-launcher:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 16px rgba(30, 143, 213, 0.6);
      }
      .sg-launcher-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        background-color: #ef4444;
        color: white;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        font-size: 12px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .sg-launcher-badge.hidden {
        display: none;
      }
      .sg-panel {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 360px;
        max-height: 560px;
        background-color: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        z-index: 999999;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        color: #333;
      }
      .sg-panel.hidden {
        display: none;
      }
      .sg-header {
        padding: 16px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: #f9fafb;
        border-radius: 12px 12px 0 0;
      }
      .sg-header-title {
        font-weight: 600;
        font-size: 15px;
      }
      .sg-close-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 20px;
        padding: 0;
        margin: -4px -4px 0 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #666;
      }
      .sg-close-btn:hover {
        color: #333;
      }
      .sg-form {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .sg-form-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sg-label {
        font-size: 13px;
        font-weight: 500;
        color: #555;
      }
      .sg-input, .sg-textarea {
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        resize: none;
        transition: border-color 0.2s;
      }
      .sg-input:focus, .sg-textarea:focus {
        outline: none;
        border-color: #1E8FD5;
        box-shadow: 0 0 0 3px rgba(30, 143, 213, 0.1);
      }
      .sg-textarea {
        min-height: 60px;
      }
      .sg-submit-btn {
        padding: 8px 16px;
        background-color: #1E8FD5;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        transition: background-color 0.2s;
      }
      .sg-submit-btn:hover {
        background-color: #1a74b1;
      }
      .sg-submit-btn:disabled {
        background-color: #ccc;
        cursor: not-allowed;
      }
      .sg-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sg-message {
        display: flex;
        gap: 8px;
        max-width: 90%;
      }
      .sg-message.sg-message-in {
        align-self: flex-end;
      }
      .sg-message.sg-message-out {
        align-self: flex-start;
      }
      .sg-message-bubble {
        padding: 8px 12px;
        border-radius: 8px;
        word-wrap: break-word;
        font-size: 14px;
        line-height: 1.4;
      }
      .sg-message-in .sg-message-bubble {
        background-color: #1E8FD5;
        color: white;
      }
      .sg-message-out .sg-message-bubble {
        background-color: #e5e7eb;
        color: #333;
      }
      .sg-message-sender {
        font-size: 12px;
        color: #999;
        margin-bottom: 2px;
      }
      .sg-message-out .sg-message-sender {
        padding-left: 4px;
      }
      .sg-divider {
        text-align: center;
        font-size: 12px;
        color: #999;
        padding: 12px 0;
        border-bottom: 1px solid #e5e7eb;
        margin: 8px 0;
      }
      .sg-input-row {
        padding: 12px 16px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }
      .sg-input-row-textarea {
        flex: 1;
        min-height: 32px;
        max-height: 100px;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        resize: none;
        transition: border-color 0.2s;
      }
      .sg-input-row-textarea:focus {
        outline: none;
        border-color: #1E8FD5;
      }
      .sg-send-btn {
        padding: 6px 12px;
        background-color: #1E8FD5;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        white-space: nowrap;
        transition: background-color 0.2s;
      }
      .sg-send-btn:hover {
        background-color: #1a74b1;
      }
      .sg-send-btn:disabled {
        background-color: #ccc;
        cursor: not-allowed;
      }
      .sg-error {
        color: #dc2626;
        font-size: 13px;
        padding: 8px 12px;
        background-color: #fee2e2;
        border-radius: 4px;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  function createLauncher() {
    const launcher = document.createElement('button');
    launcher.className = 'sg-launcher';
    launcher.id = 'sg-launcher';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <div class="sg-launcher-badge hidden" id="sg-badge">0</div>
    `;
    launcher.addEventListener('click', togglePanel);
    document.body.appendChild(launcher);
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.className = 'sg-panel hidden';
    panel.id = 'sg-panel';
    panel.innerHTML = `
      <div class="sg-header">
        <div class="sg-header-title">Chat with us</div>
        <button class="sg-close-btn" id="sg-close-btn">×</button>
      </div>
      <div id="sg-content"></div>
    `;
    document.getElementById('sg-close-btn')?.addEventListener('click', togglePanel);
    document.body.appendChild(panel);
  }

  function showForm() {
    const content = document.getElementById('sg-content');
    content.innerHTML = `
      <div class="sg-form">
        <div class="sg-form-group">
          <label class="sg-label" for="sg-name">Name</label>
          <input type="text" id="sg-name" class="sg-input" placeholder="Your name" required>
        </div>
        <div class="sg-form-group">
          <label class="sg-label" for="sg-email">Email</label>
          <input type="email" id="sg-email" class="sg-input" placeholder="your@email.com" required>
        </div>
        <div class="sg-form-group">
          <label class="sg-label" for="sg-message">Message</label>
          <textarea id="sg-message" class="sg-textarea" placeholder="How can we help?" required></textarea>
        </div>
        <button class="sg-submit-btn" id="sg-submit">Start</button>
        <div class="sg-error hidden" id="sg-error"></div>
      </div>
    `;

    const submitBtn = document.getElementById('sg-submit');
    const nameInput = document.getElementById('sg-name');
    const emailInput = document.getElementById('sg-email');
    const messageInput = document.getElementById('sg-message');
    const errorDiv = document.getElementById('sg-error');

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const message = messageInput.value.trim();

      if (!name) {
        showError('Name is required', errorDiv);
        return;
      }
      if (!email || !email.includes('@')) {
        showError('Valid email is required', errorDiv);
        return;
      }
      if (!message) {
        showError('Message is required', errorDiv);
        return;
      }

      submitBtn.disabled = true;
      errorDiv.classList.add('hidden');

      try {
        const response = await fetch(`${state.apiBase}/api/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: state.key,
            name,
            email,
            pageUrl: location.href,
            message,
          }),
        });

        if (response.status === 429) {
          showError('Too many requests — try again later', errorDiv);
          submitBtn.disabled = false;
          return;
        }

        if (!response.ok) {
          showError('Failed to start conversation. Please try again.', errorDiv);
          submitBtn.disabled = false;
          return;
        }

        const data = await response.json();
        state.token = data.token;
        state.name = name;
        state.email = email;
        state.conversationStatus = data.status || 'open';
        state.messages = [];
        state.lastMessageId = null;
        state.unreadCount = 0;

        const storageKey = `sg_token_${state.key}`;
        localStorage.setItem(storageKey, state.token);

        showChat();
        startPolling();
      } catch (err) {
        warn('Error starting conversation:', err);
        showError('Failed to start conversation. Please try again.', errorDiv);
        submitBtn.disabled = false;
      }
    });
  }

  function showError(msg, errorDiv) {
    errorDiv.textContent = msg;
    errorDiv.classList.remove('hidden');
  }

  function showChat() {
    const content = document.getElementById('sg-content');
    content.innerHTML = `
      <div class="sg-messages" id="sg-messages"></div>
      <div class="sg-input-row">
        <textarea class="sg-input-row-textarea" id="sg-input" placeholder="Type a message..." ></textarea>
        <button class="sg-send-btn" id="sg-send">Send</button>
      </div>
    `;

    const textarea = document.getElementById('sg-input');
    const sendBtn = document.getElementById('sg-send');

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener('click', sendMessage);

    // Auto-expand textarea
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    });

    renderMessages();
  }

  function renderMessages() {
    const messagesDiv = document.getElementById('sg-messages');
    messagesDiv.innerHTML = '';

    if (state.conversationStatus === 'closed' && state.messages.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'sg-divider';
      divider.textContent = 'Conversation ended';
      messagesDiv.appendChild(divider);
    }

    state.messages.forEach((msg) => {
      const msgEl = document.createElement('div');
      const isOwn = msg.direction === 'in';
      msgEl.className = `sg-message ${isOwn ? 'sg-message-in' : 'sg-message-out'}`;

      const bubble = document.createElement('div');
      bubble.className = 'sg-message-bubble';
      bubble.textContent = msg.body;

      if (!isOwn && msg.sender) {
        const sender = document.createElement('div');
        sender.className = 'sg-message-sender';
        sender.textContent = msg.sender;
        msgEl.appendChild(sender);
      }

      msgEl.appendChild(bubble);
      messagesDiv.appendChild(msgEl);
    });

    // Scroll to bottom
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  async function sendMessage() {
    const textarea = document.getElementById('sg-input');
    const text = textarea.value.trim();

    if (!text || !state.token) return;

    textarea.value = '';
    textarea.style.height = 'auto';

    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      direction: 'in',
      sender: state.name,
      body: text,
      at: new Date().toISOString(),
    };
    state.messages.push(optimisticMsg);
    renderMessages();

    try {
      const response = await fetch(`${state.apiBase}/api/c/${state.token}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (response.status === 429) {
        // Rate limited; remove optimistic message
        state.messages = state.messages.filter((m) => m.id !== optimisticMsg.id);
        renderMessages();
        // Optional: show a transient error
        return;
      }

      if (!response.ok) {
        state.messages = state.messages.filter((m) => m.id !== optimisticMsg.id);
        renderMessages();
      }
    } catch (err) {
      warn('Error sending message:', err);
      state.messages = state.messages.filter((m) => m.id !== optimisticMsg.id);
      renderMessages();
    }
  }

  async function fetchMessages() {
    if (!state.token) return;

    try {
      const url = new URL(`${state.apiBase}/api/c/${state.token}/messages`);
      if (state.lastMessageId) {
        url.searchParams.append('after', state.lastMessageId);
      }

      const response = await fetch(url.toString());

      if (response.status === 404) {
        // Token invalid; clear and reset
        const storageKey = `sg_token_${state.key}`;
        localStorage.removeItem(storageKey);
        state.token = null;
        state.messages = [];
        state.lastMessageId = null;
        stopPolling();
        showForm();
        closePanel();
        return;
      }

      if (!response.ok) return;

      const data = await response.json();

      state.conversationStatus = data.status || 'open';

      if (Array.isArray(data.messages)) {
        data.messages.forEach((msg) => {
          if (!state.messages.find((m) => m.id === msg.id)) {
            state.messages.push(msg);
            if (!state.lastMessageId || msg.id > state.lastMessageId) {
              state.lastMessageId = msg.id;
            }

            // Track unread if panel is closed
            if (!state.isOpen && msg.direction === 'out') {
              state.unreadCount++;
            }
          }
        });

        if (state.isOpen) {
          renderMessages();
          state.unreadCount = 0;
          updateBadge();
        } else {
          updateBadge();
        }
      }
    } catch (err) {
      warn('Error fetching messages:', err);
    }
  }

  function updateBadge() {
    const badge = document.getElementById('sg-badge');
    if (state.unreadCount > 0) {
      badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function startPolling() {
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
    }

    const poll = () => {
      if (!document.hidden) {
        fetchMessages();
      }
    };

    state.pollingInterval = setInterval(
      poll,
      state.isOpen ? state.pollingRate : state.backgroundRate
    );
    poll();
  }

  function stopPolling() {
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
      state.pollingInterval = null;
    }
  }

  function togglePanel() {
    state.isOpen = !state.isOpen;
    const panel = document.getElementById('sg-panel');

    if (state.isOpen) {
      panel.classList.remove('hidden');
      state.unreadCount = 0;
      updateBadge();
      if (state.token) {
        fetchMessages();
        startPolling();
      }
    } else {
      panel.classList.add('hidden');
      // Keep polling in background
      if (state.token && state.pollingInterval) {
        // Adjust polling rate when closed
        stopPolling();
        startPolling();
      }
    }
  }

  function closePanel() {
    if (state.isOpen) {
      state.isOpen = false;
      const panel = document.getElementById('sg-panel');
      panel.classList.add('hidden');
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopPolling();
    } else if (state.token) {
      fetchMessages();
      startPolling();
    }
  }

  function init() {
    if (!initializeState()) {
      return;
    }

    injectStyles();
    createLauncher();
    createPanel();

    if (state.token) {
      showChat();
      fetchMessages();
    } else {
      showForm();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
