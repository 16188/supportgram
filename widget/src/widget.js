(() => {
  // Supportgram embeddable chat widget
  // Vanilla JS, no dependencies, IIFE pattern for bundling

  const state = {
    key: null,
    apiBase: null,
    tokens: [],            // all conversation tokens for this identity, oldest first
    token: null,           // active conversation
    messages: [],
    lastMessageId: null,
    conversationStatus: 'open',
    pollingInterval: null,
    pollingRate: 3000,     // 3s when chat open
    backgroundRate: 30000, // 30s when panel closed
    unreadCount: 0,
    isOpen: false,
    view: 'home',          // 'home' | 'chat' | 'form'
    name: '',
    email: '',
    identified: false,
    accent: '#1E8FD5',
    offset: 20,
    title: 'Contact Us',
    greeting: 'Let me know if you have any questions!',
    storageKey: null,      // JSON array of tokens
    teaserKey: null,
    teaserEl: null,
  };

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

  // Stable short hash so identified users get their own token slot (no plaintext email in storage keys).
  function identityHash(email) {
    const s = String(email).trim().toLowerCase();
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }

  function findScriptTag() {
    if (document.currentScript) {
      return document.currentScript;
    }
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.includes('widget.js')) {
        return scripts[i];
      }
    }
    return null;
  }

  function saveTokens() {
    try { localStorage.setItem(state.storageKey, JSON.stringify(state.tokens)); } catch { /* ignore */ }
  }

  function loadTokens() {
    try {
      const raw = localStorage.getItem(state.storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.filter((t) => typeof t === 'string');
      }
    } catch { /* ignore */ }
    // Migrate legacy single-token storage (sg_token_*) into the list.
    const legacyKey = state.storageKey.replace('sg_convs_', 'sg_token_');
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      localStorage.removeItem(legacyKey);
      return [legacy];
    }
    return [];
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

    const url = new URL(script.src);
    state.apiBase = url.origin;

    // Known-visitor identity: window.SupportgramSettings wins over script data attributes.
    const settings = (typeof window !== 'undefined' && window.SupportgramSettings) || {};
    const knownName = String(settings.name || script.getAttribute('data-name') || '').trim();
    const knownEmail = String(settings.email || script.getAttribute('data-email') || '').trim();
    if (knownName && knownEmail.includes('@')) {
      state.name = knownName;
      state.email = knownEmail;
      state.identified = true;
    }

    // Brand accent color (hex only; anything else falls back to the default).
    const rawColor = String(settings.color || script.getAttribute('data-color') || '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(rawColor)) {
      state.accent = rawColor;
    }

    // Bottom offset in px — lets host pages lift the widget above their own fixed UI.
    const rawOffset = parseInt(settings.offset ?? script.getAttribute('data-offset') ?? '', 10);
    if (Number.isFinite(rawOffset) && rawOffset >= 0 && rawOffset <= 500) {
      state.offset = rawOffset;
    }

    const title = String(settings.title || script.getAttribute('data-title') || '').trim();
    if (title) state.title = title.slice(0, 40);
    const greeting = String(settings.greeting || script.getAttribute('data-greeting') || '').trim();
    if (greeting) state.greeting = greeting.slice(0, 120);

    // Conversations are scoped per identity: anonymous visitors share the browser slot,
    // each identified user (by email) gets their own.
    const suffix = state.identified ? `_${identityHash(state.email)}` : '';
    state.storageKey = `sg_convs_${state.key}${suffix}`;
    state.teaserKey = `sg_teaser_${state.key}`;
    state.tokens = loadTokens();
    saveTokens();

    log('Initialized with key:', state.key, 'api base:', state.apiBase);
    return true;
  }

  function injectStyles() {
    if (document.getElementById('sg-styles')) return;

    const style = document.createElement('style');
    style.id = 'sg-styles';
    style.textContent = `
      .sg-launcher, .sg-panel, .sg-teaser {
        --sg-accent: ${state.accent};
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      .sg-launcher {
        position: fixed;
        bottom: ${state.offset}px;
        right: 20px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background-color: var(--sg-accent);
        border: none;
        cursor: pointer;
        box-shadow: 0 2px 12px color-mix(in srgb, var(--sg-accent) 40%, transparent);
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
        box-shadow: 0 4px 16px color-mix(in srgb, var(--sg-accent) 60%, transparent);
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
      }
      .sg-launcher-badge.hidden {
        display: none;
      }
      .sg-teaser {
        position: fixed;
        bottom: ${state.offset + 68}px;
        right: 20px;
        width: 280px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
        padding: 14px;
        z-index: 999998;
        font-size: 14px;
        color: #333;
      }
      .sg-teaser-title {
        font-weight: 700;
        margin-bottom: 4px;
      }
      .sg-teaser-text {
        margin-bottom: 10px;
        line-height: 1.4;
      }
      .sg-teaser-btn {
        display: block;
        width: 100%;
        padding: 8px 12px;
        margin-top: 6px;
        border: none;
        border-radius: 999px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: filter 0.15s;
      }
      .sg-teaser-btn:hover { filter: brightness(0.92); }
      .sg-teaser-btn.primary { background: var(--sg-accent); color: white; }
      .sg-teaser-btn.secondary { background: #e5e7eb; color: #333; }
      .sg-panel {
        position: fixed;
        bottom: ${state.offset + 68}px;
        right: 20px;
        width: 360px;
        max-height: 600px;
        height: 520px;
        background-color: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 999999;
        font-size: 14px;
        color: #333;
      }
      .sg-panel.hidden {
        display: none;
      }
      .sg-header {
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        background-color: var(--sg-accent);
        color: white;
        flex: 0 0 auto;
      }
      .sg-header-title {
        font-weight: 600;
        font-size: 15px;
        flex: 1;
        text-align: center;
      }
      .sg-header-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        opacity: 0.85;
      }
      .sg-header-btn:hover { opacity: 1; }
      .sg-header-btn.hidden { visibility: hidden; }
      #sg-content {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }
      .sg-home {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        background: #f5f6f8;
      }
      .sg-home-hero {
        padding: 12px 16px 18px;
        text-align: center;
        background-color: var(--sg-accent);
        color: white;
      }
      .sg-avatar {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: white;
        color: var(--sg-accent);
        font-weight: 700;
        font-size: 19px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 6px;
      }
      .sg-home-sub {
        font-size: 13px;
        opacity: 0.95;
      }
      .sg-recent {
        margin: 14px 14px 0;
        background: white;
        border-radius: 10px;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }
      .sg-recent-title {
        font-weight: 600;
        font-size: 13px;
        padding: 10px 14px 4px;
        color: #444;
      }
      .sg-recent-item {
        display: flex;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        align-items: center;
        border-top: 1px solid #f0f1f3;
      }
      .sg-recent-item:hover { background: #f7f8fa; }
      .sg-recent-avatar {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: var(--sg-accent);
        color: white;
        font-weight: 700;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
      }
      .sg-recent-main { flex: 1; min-width: 0; }
      .sg-recent-name { font-weight: 600; font-size: 13px; color: #222; }
      .sg-recent-preview {
        font-size: 13px;
        color: #777;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sg-recent-time {
        font-size: 11px;
        color: #999;
        flex: 0 0 auto;
        align-self: flex-start;
        padding-top: 2px;
      }
      .sg-home-footer {
        margin-top: auto;
        padding: 14px;
        text-align: center;
      }
      .sg-newmsg-btn {
        padding: 10px 22px;
        background-color: var(--sg-accent);
        color: white;
        border: none;
        border-radius: 999px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        transition: filter 0.15s;
      }
      .sg-newmsg-btn:hover { filter: brightness(0.92); }
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
        font-family: inherit;
        font-size: 14px;
        resize: none;
        transition: border-color 0.2s;
      }
      .sg-input:focus, .sg-textarea:focus {
        outline: none;
        border-color: var(--sg-accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--sg-accent) 10%, transparent);
      }
      .sg-textarea {
        min-height: 60px;
      }
      .sg-submit-btn {
        padding: 8px 16px;
        background-color: var(--sg-accent);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        transition: filter 0.15s;
      }
      .sg-submit-btn:hover { filter: brightness(0.92); }
      .sg-submit-btn:disabled { background-color: #ccc; cursor: not-allowed; }
      .sg-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
      }
      .sg-message {
        display: flex;
        flex-direction: column;
        max-width: 90%;
      }
      .sg-message.sg-message-in { align-self: flex-end; }
      .sg-message.sg-message-out { align-self: flex-start; }
      .sg-message-bubble {
        padding: 8px 12px;
        border-radius: 8px;
        word-wrap: break-word;
        font-size: 14px;
        line-height: 1.4;
      }
      .sg-message-in .sg-message-bubble {
        background-color: var(--sg-accent);
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
        padding-left: 4px;
      }
      .sg-divider {
        text-align: center;
        font-size: 12px;
        color: #999;
        padding: 8px 0;
      }
      .sg-input-row {
        padding: 12px 16px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        gap: 8px;
        align-items: flex-end;
        flex: 0 0 auto;
      }
      .sg-input-row-textarea {
        flex: 1;
        min-height: 32px;
        max-height: 100px;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-family: inherit;
        font-size: 14px;
        resize: none;
        transition: border-color 0.2s;
      }
      .sg-input-row-textarea:focus {
        outline: none;
        border-color: var(--sg-accent);
      }
      .sg-send-btn {
        padding: 6px 12px;
        background-color: var(--sg-accent);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        white-space: nowrap;
        transition: filter 0.15s;
      }
      .sg-send-btn:hover { filter: brightness(0.92); }
      .sg-send-btn:disabled { background-color: #ccc; cursor: not-allowed; }
      .sg-error {
        color: #dc2626;
        font-size: 13px;
        padding: 8px 12px;
        background-color: #fee2e2;
        border-radius: 4px;
        text-align: center;
      }
      .sg-error.hidden { display: none; }
      @media (max-width: 420px) {
        .sg-panel { width: calc(100vw - 24px); right: 12px; }
        .sg-teaser { width: calc(100vw - 104px); }
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
        <button class="sg-header-btn hidden" id="sg-back-btn" aria-label="Back">‹</button>
        <div class="sg-header-title" id="sg-title"></div>
        <button class="sg-header-btn" id="sg-close-btn" aria-label="Close">×</button>
      </div>
      <div id="sg-content"></div>
    `;
    panel.querySelector('#sg-title').textContent = state.title;
    panel.querySelector('#sg-close-btn').addEventListener('click', togglePanel);
    panel.querySelector('#sg-back-btn').addEventListener('click', () => {
      stopPolling();
      state.view = 'home';
      renderView();
    });
    document.body.appendChild(panel);
  }

  /* ---------------- teaser (proactive greeting) ---------------- */

  // Soft two-note chime, synthesized (no audio asset). Best-effort: browsers
  // block audio until the visitor has interacted with the page at least once.
  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') { ctx.close(); return; }
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      [[880, 0], [1174.7, 0.12]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.35);
      });
      setTimeout(() => ctx.close(), 700);
    } catch { /* never let sound break the widget */ }
  }

  // '1' = engaged, never show again; a numeric value = snoozed until that epoch-ms.
  function teaserDismissed() {
    try {
      if (sessionStorage.getItem(state.teaserKey) === '1') return true; // max once per session
      const v = localStorage.getItem(state.teaserKey);
      if (v === '1') return true;
      if (v && Date.now() < Number(v)) return true;
    } catch { /* ignore */ }
    return false;
  }

  function dismissTeaser(permanent) {
    try {
      if (permanent) {
        localStorage.setItem(state.teaserKey, '1');
      } else {
        // "No, thanks" — snooze for 7 days, then eligible again.
        localStorage.setItem(state.teaserKey, String(Date.now() + 7 * 24 * 3600 * 1000));
      }
    } catch { /* ignore */ }
    if (state.teaserEl) {
      state.teaserEl.remove();
      state.teaserEl = null;
    }
    if (state.unreadCount === 0) {
      const badge = document.getElementById('sg-badge');
      if (badge) badge.classList.add('hidden');
    }
  }

  function maybeShowTeaser() {
    if (teaserDismissed() || state.isOpen || state.tokens.length > 0) return;
    try { sessionStorage.setItem(state.teaserKey, '1'); } catch { /* ignore */ }

    const teaser = document.createElement('div');
    teaser.className = 'sg-teaser';
    teaser.innerHTML = `
      <div class="sg-teaser-title"></div>
      <div class="sg-teaser-text"></div>
      <button class="sg-teaser-btn primary" id="sg-teaser-yes">I have a question</button>
      <button class="sg-teaser-btn secondary" id="sg-teaser-no">No, thanks</button>
    `;
    teaser.querySelector('.sg-teaser-title').textContent = state.title;
    teaser.querySelector('.sg-teaser-text').textContent = state.greeting;
    teaser.querySelector('#sg-teaser-yes').addEventListener('click', () => {
      dismissTeaser(true);
      if (!state.isOpen) togglePanel();
      startNewConversation();
    });
    teaser.querySelector('#sg-teaser-no').addEventListener('click', () => dismissTeaser(false));
    document.body.appendChild(teaser);
    state.teaserEl = teaser;

    const badge = document.getElementById('sg-badge');
    if (badge) {
      badge.textContent = '1';
      badge.classList.remove('hidden');
    }
    playChime();
  }

  /* ---------------- views ---------------- */

  function renderView() {
    const backBtn = document.getElementById('sg-back-btn');
    backBtn.classList.toggle('hidden', state.view === 'home');

    if (state.view === 'home') showHome();
    else if (state.view === 'form') showForm();
    else showChat();
  }

  function formatTime(at) {
    if (!at) return '';
    const d = new Date(String(at).includes('T') ? at : at + 'Z');
    if (isNaN(d)) return '';
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }

  function showHome() {
    const content = document.getElementById('sg-content');
    const initial = (state.title[0] || '?').toUpperCase();
    content.innerHTML = `
      <div class="sg-home">
        <div class="sg-home-hero">
          <div class="sg-avatar">${initial}</div>
          <div class="sg-home-sub">We'll respond as soon as we can.</div>
        </div>
        <div id="sg-recent-wrap"></div>
        <div class="sg-home-footer">
          <button class="sg-newmsg-btn" id="sg-newmsg">Send a Message</button>
        </div>
      </div>
    `;
    content.querySelector('#sg-newmsg').addEventListener('click', startNewConversation);

    if (state.tokens.length > 0) {
      renderRecentList();
    }
  }

  async function renderRecentList() {
    const wrap = document.getElementById('sg-recent-wrap');
    if (!wrap) return;
    const card = document.createElement('div');
    card.className = 'sg-recent';
    card.innerHTML = '<div class="sg-recent-title">Recent Conversations</div>';
    wrap.replaceChildren(card);

    // newest first
    const tokens = [...state.tokens].reverse();
    for (const token of tokens) {
      try {
        const resp = await fetch(`${state.apiBase}/api/c/${token}/messages`);
        if (resp.status === 404) {
          state.tokens = state.tokens.filter((t) => t !== token);
          saveTokens();
          continue;
        }
        if (!resp.ok) continue;
        const data = await resp.json();
        const msgs = data.messages || [];
        const last = msgs[msgs.length - 1];

        const item = document.createElement('button');
        item.className = 'sg-recent-item';
        item.innerHTML = `
          <div class="sg-recent-avatar">${(state.title[0] || '?').toUpperCase()}</div>
          <div class="sg-recent-main">
            <div class="sg-recent-name"></div>
            <div class="sg-recent-preview"></div>
          </div>
          <div class="sg-recent-time"></div>
        `;
        item.querySelector('.sg-recent-name').textContent = state.title;
        item.querySelector('.sg-recent-preview').textContent = last
          ? last.body
          : (data.status === 'closed' ? 'Conversation ended' : 'New conversation');
        item.querySelector('.sg-recent-time').textContent = last ? formatTime(last.at) : '';
        item.addEventListener('click', () => openConversation(token));
        card.appendChild(item);
      } catch { /* skip unreachable conversations */ }
    }
  }

  function openConversation(token) {
    state.token = token;
    state.messages = [];
    state.lastMessageId = null;
    state.conversationStatus = 'open';
    state.view = 'chat';
    renderView();
    fetchMessages();
    startPolling();
  }

  function startNewConversation() {
    stopPolling();
    state.token = null;
    state.messages = [];
    state.lastMessageId = null;
    state.conversationStatus = 'open';
    if (state.identified) {
      // Known visitor: no pre-chat form; conversation is created on first message.
      state.view = 'chat';
    } else {
      state.view = 'form';
    }
    renderView();
  }

  function adoptNewToken(token) {
    state.token = token;
    state.tokens.push(token);
    saveTokens();
  }

  /* ---------------- pre-chat form ---------------- */

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
    const errorDiv = document.getElementById('sg-error');

    submitBtn.addEventListener('click', async () => {
      const name = document.getElementById('sg-name').value.trim();
      const email = document.getElementById('sg-email').value.trim();
      const message = document.getElementById('sg-message').value.trim();

      if (!name) return showError('Name is required', errorDiv);
      if (!email || !email.includes('@')) return showError('Valid email is required', errorDiv);
      if (!message) return showError('Message is required', errorDiv);

      submitBtn.disabled = true;
      errorDiv.classList.add('hidden');

      try {
        const response = await fetch(`${state.apiBase}/api/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, name, email, pageUrl: location.href, message }),
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
        state.name = name;
        state.email = email;
        state.conversationStatus = data.status || 'open';
        state.messages = [];
        state.lastMessageId = null;
        state.unreadCount = 0;
        adoptNewToken(data.token);

        state.view = 'chat';
        renderView();
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

  /* ---------------- chat ---------------- */

  function showChat() {
    const content = document.getElementById('sg-content');
    content.innerHTML = `
      <div class="sg-messages" id="sg-messages"></div>
      <div class="sg-input-row">
        <textarea class="sg-input-row-textarea" id="sg-input" placeholder="Type a message..."></textarea>
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
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    });

    renderMessages();
  }

  function renderMessages() {
    const messagesDiv = document.getElementById('sg-messages');
    if (!messagesDiv) return;
    messagesDiv.innerHTML = '';

    state.messages.forEach((msg) => {
      const msgEl = document.createElement('div');
      const isOwn = msg.direction === 'in';
      msgEl.className = `sg-message ${isOwn ? 'sg-message-in' : 'sg-message-out'}`;

      if (!isOwn && msg.sender) {
        const sender = document.createElement('div');
        sender.className = 'sg-message-sender';
        sender.textContent = msg.sender;
        msgEl.appendChild(sender);
      }

      const bubble = document.createElement('div');
      bubble.className = 'sg-message-bubble';
      bubble.textContent = msg.body;
      msgEl.appendChild(bubble);
      messagesDiv.appendChild(msgEl);
    });

    if (state.conversationStatus === 'closed' && state.messages.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'sg-divider';
      divider.textContent = 'Conversation ended — send a message to reopen';
      messagesDiv.appendChild(divider);
    }

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  async function sendMessage() {
    const textarea = document.getElementById('sg-input');
    const text = textarea.value.trim();

    if (!text) return;
    if (!state.token && !state.identified) return;

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

    // Identified visitor with no conversation yet: first send creates it.
    if (!state.token) {
      try {
        const response = await fetch(`${state.apiBase}/api/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: state.key,
            name: state.name,
            email: state.email,
            pageUrl: location.href,
            message: text,
          }),
        });
        if (!response.ok) {
          state.messages = state.messages.filter((m) => m.id !== optimisticMsg.id);
          renderMessages();
          return;
        }
        const data = await response.json();
        state.conversationStatus = data.status || 'open';
        adoptNewToken(data.token);
        startPolling();
      } catch (err) {
        warn('Error starting conversation:', err);
        state.messages = state.messages.filter((m) => m.id !== optimisticMsg.id);
        renderMessages();
      }
      return;
    }

    try {
      const response = await fetch(`${state.apiBase}/api/c/${state.token}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        state.messages = state.messages.filter((m) => m.id !== optimisticMsg.id);
        renderMessages();
        return;
      }
      if (state.conversationStatus === 'closed') {
        state.conversationStatus = 'open';
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
    const token = state.token;

    try {
      const url = new URL(`${state.apiBase}/api/c/${token}/messages`);
      if (state.lastMessageId) {
        url.searchParams.append('after', state.lastMessageId);
      }

      const response = await fetch(url.toString());

      if (response.status === 404) {
        // Token invalid (purged or bad); drop it and go home.
        state.tokens = state.tokens.filter((t) => t !== token);
        saveTokens();
        state.token = null;
        state.messages = [];
        state.lastMessageId = null;
        stopPolling();
        if (state.isOpen) {
          state.view = 'home';
          renderView();
        }
        return;
      }

      if (!response.ok || state.token !== token) return;

      const data = await response.json();
      state.conversationStatus = data.status || 'open';

      if (Array.isArray(data.messages)) {
        let changed = false;
        data.messages.forEach((msg) => {
          if (!state.messages.find((m) => m.id === msg.id)) {
            // Reconcile optimistic sends: adopt the server id instead of duplicating the bubble.
            const temp = msg.direction === 'in'
              ? state.messages.find((m) => String(m.id).startsWith('temp-') && m.body === msg.body)
              : null;
            if (temp) {
              temp.id = msg.id;
              temp.at = msg.at;
            } else {
              state.messages.push(msg);
              changed = true;
              if (!state.isOpen && msg.direction === 'out') {
                state.unreadCount++;
              }
            }
            if (!state.lastMessageId || msg.id > state.lastMessageId) {
              state.lastMessageId = msg.id;
            }
          }
        });

        if (state.isOpen && state.view === 'chat') {
          if (changed) renderMessages();
          state.unreadCount = 0;
        }
        updateBadge();
      }
    } catch (err) {
      warn('Error fetching messages:', err);
    }
  }

  function updateBadge() {
    const badge = document.getElementById('sg-badge');
    if (!badge) return;
    if (state.unreadCount > 0) {
      badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
      badge.classList.remove('hidden');
    } else if (!state.teaserEl) {
      badge.classList.add('hidden');
    }
  }

  function startPolling() {
    stopPolling();
    const poll = () => {
      if (!document.hidden) fetchMessages();
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
      if (state.teaserEl) {
        state.teaserEl.remove();
        state.teaserEl = null;
      }
      panel.classList.remove('hidden');
      state.unreadCount = 0;
      updateBadge();
      renderView();
      if (state.view === 'chat' && state.token) {
        fetchMessages();
        startPolling();
      }
    } else {
      panel.classList.add('hidden');
      // Keep a slow background poll on the active conversation for the unread badge.
      if (state.token) {
        startPolling();
      } else {
        stopPolling();
      }
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
    if (!initializeState()) return;

    injectStyles();
    createLauncher();
    createPanel();

    // Resume the most recent conversation as the active one for background unread polling.
    if (state.tokens.length > 0) {
      state.token = state.tokens[state.tokens.length - 1];
      state.view = 'chat';
      fetchMessages();
      startPolling();
      state.view = 'home';
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    setTimeout(maybeShowTeaser, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
