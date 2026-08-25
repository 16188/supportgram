# Supportgram — Proof-of-Concept Specification

**Website live chat, answered entirely from Telegram.**

| | |
|---|---|
| Status | Approved (interactive preview signed off 2026-07-18) |
| Repo | https://github.com/16188/supportgram |
| Domain | supportgram.io (register immediately; inquire on supportgram.com) |
| First tenant | Hotline HQ (hotlinehq.online) — live pilot with real US auto-dealer traffic |

---

## 1. Overview

Supportgram is a multi-tenant B2B SaaS: a business drops one script tag on its website, and every visitor conversation appears as a **forum topic in the business's own Telegram supergroup**. Support agents read, reply, and resolve without leaving Telegram — there is no agent web inbox, by design. The pitch: *your support desk is an app your team already has open.*

The product lives in its own repository, unrelated to the Hotline HQ codebase. Hotline HQ is tenant #1 and the proving ground.

The original concept — a pool of 12 bots providing 12 "conversation slots" per agent — was **dropped during spec review**: one Telegram bot already handles unlimited concurrent chats, bots cannot message users first (so slot handoff breaks), and forum topics provide per-conversation separation natively. Per-agent load limits, if ever needed, are a backend routing rule, not a bot-count problem.

## 2. Market position

The exact niche — "website chat answered from inside Telegram" — is **crowded at the bottom, empty at the top**:

- **Re:plain** (replain.cc), the only global incumbent ($8–17/mo): changelog frozen since March 2022; uses reply-routing, whose concurrent-conversation confusion is the niche's most-documented complaint.
- **GramDesk** (~$3/mo, minimal), **TeleReply** (semi-abandoned), a cluster of Russian-market freemium tools (U-CRM, КликЧат), and open-source projects (Intergram — abandoned; prog-time/tg-support-bot — active, self-hosted, RU docs).
- Every funded competitor (JivoChat, Crisp, Chatwoot, Callbell, Mava) deliberately pulls agents *out* of Telegram into their own inbox.

The forum-topics architecture is validated but commercially unclaimed: U-CRM and tg-support-bot both ship topic-per-visitor, yet no polished English-first SaaS does.

**Wedge:** English-first polish, the topics UX, US B2B posture, and team workflow (assignment; later SLA/CSAT/AI triage) that no direct competitor offers.

**Accepted risks:** the niche's price anchor is low ($3–17/mo); Telegram penetration among US support teams is far weaker than in CIS/crypto/dev circles. Positioning leans on "no new tool for your team," expanding to Telegram-native verticals (crypto, dev tools, agencies, e-commerce operators) after the pilot.

## 3. Name, domain & SEO

- **Name: Supportgram.** Primary domain `supportgram.io`. `supportgram.com` is registered to an unknown holder — worth a quiet purchase inquiry, not a blocker. Also register the `@supportgram` Telegram username/bot name.
- **Trademark rule** (Telegram API ToS): the word "Telegram" must not appear in an app's name or domain. "-gram" derivatives are the tolerated ecosystem norm (Livegram, Nicegram, GramDesk). "for Telegram" in page titles and copy is permitted — that's how the keyword gets captured: *"Supportgram — Telegram Live Chat Widget for Your Website."*
- **Head terms by intent:** "telegram chat widget" / "telegram live chat widget" → "telegram live chat for website" → "telegram ticket bot" → "telegram shared inbox". Avoid "telegram helpdesk" (SERP polluted by users contacting Telegram's own support).
- **Strategy:** rankings come from landing pages, not the name — one page per keyword (`/telegram-live-chat-widget`, `/telegram-shared-inbox`, …) plus comparison pages ("Intergram alternative", "Re:plain alternative"), disproportionately effective against stale incumbents.

## 4. Goals & non-goals

### POC success bar

The widget runs live on hotlinehq.online for 2–4 weeks; real dealer questions flow into the team's Telegram supergroup; agents handle them entirely in Telegram. **Success = real conversations resolved without anyone asking for a web inbox.**

### In scope

- Embeddable JS widget: pre-chat form, live chat pane, resume via email link
- Relay backend: widget ⇄ Telegram forum topics, one bot per tenant, webhooks (self-hosted Node.js)
- Hybrid assignment: round-robin @mention suggestion; any agent may answer
- Agent verbs in Telegram: reply, `/close`, `/note`, auto-posted customer info card
- Email notification with resume link when the customer is offline
- Multi-tenant schema with manual (SQL) tenant onboarding
- Security baseline: rate limiting, random resume tokens, per-tenant origin allowlist

### Out of scope (POC)

- Self-serve tenant onboarding, billing, any admin web UI
- Enforced per-agent concurrency caps, SLA timers, CSAT, canned replies
- Inbound email bridge, widget file uploads, AI auto-answers, WebSocket/SSE realtime (short-polling only)

## 5. Architecture

```
Visitor's browser                   VPS (Docker)                      Telegram
┌─────────────────┐   POST /msg    ┌──────────────────────┐  Bot API  ┌─────────────────────┐
│  widget.js       │ ─────────────▶ │  api/* functions     │ ────────▶ │ Tenant supergroup    │
│  (script tag)    │ ◀───────────── │  + Turso (libSQL DB) │ ◀──────── │ (Topics ON)          │
└─────────────────┘  poll ?after=  │  /api/tg/:key        │  webhook  │  1 topic = 1 convo   │
                                   └──────────────────────┘           │  agents reply here   │
        email "you have a reply" + resume link ◀── on offline reply   └─────────────────────┘
```

- **One bot per tenant**, created by the tenant via @BotFather and added as admin (with "Manage topics") to the tenant's supergroup. Bot token, supergroup ID, and a per-tenant webhook secret stored server-side.
- **Webhooks** (`setWebhook` → `/api/tg/:publicKey`, verified via `x-telegram-bot-api-secret-token`) are registered automatically by the seed script.
- **Widget transport:** `POST` to send, short-polling (`GET ?after=<id>`, every 3s while open, paused when the tab is hidden) to receive.
- **Stack:** self-hosted Node.js 20 in Docker, **Turso/libSQL** for the database (persistent local file by default), raw HTTPS calls to the Bot API (no SDK), widget in plain JS bundled with esbuild (<15 KB gzipped), and transactional email via SendGrid.

## 6. Conversation lifecycle & routing

1. Visitor opens widget → pre-chat form (name + email, both required) → conversation row created with a 128-bit resume token; token also stored in the browser's localStorage.
2. Server creates a forum topic named `{Name} — {Company/email domain}`, posts the pinned **info card** (name, email, page URL, prior conversation count), and @mentions the next agent in round-robin rotation as the *suggested* owner. Any agent may answer; first reply sets `assigned_agent`.
3. Messages relay both ways: visitor → topic (via API + webhook responses); agent's topic messages → widget via polling. Agent messages starting with `/note` stay internal and are never relayed.
4. If the visitor hasn't polled recently (offline heuristic: no poll in ~60s) when an agent replies, send one email — "You have a reply from {business}" — with the resume link (`https://…/c/{resume_token}`). At most one notification email per conversation per hour.
5. `/close` marks the conversation resolved, closes the Telegram topic, and shows "conversation ended" in the widget. A new message from the same visitor (same token) reopens the same topic; a new visit without a token starts a fresh conversation.

## 7. Data model

| Table | Key columns |
|---|---|
| `businesses` | `id`, `name`, `bot_token`, `supergroup_id`, `origin_allowlist` (JSON array), `created_at` |
| `agents` | `id`, `business_id`, `tg_user_id`, `display_name`, `active`, `rotation_order` |
| `conversations` | `id`, `business_id`, `customer_name`, `customer_email`, `page_url`, `topic_id`, `status` (open/closed), `assigned_agent_id`, `resume_token`, `last_activity_at`, `created_at` |
| `messages` | `id`, `conversation_id`, `direction` (in/out/note), `sender_label`, `body`, `tg_message_id`, `created_at` |

- Every row carries `business_id` from day one; adding a tenant is a manual INSERT plus BotFather setup. No signup UI, no billing tables.
- Conversations and messages remain in the database indefinitely; Telegram forum topics are not automatically deleted.

## 8. Security & privacy

Non-negotiable for pilot launch:

- **Rate limiting:** per-IP limits on conversation creation and message send, per-conversation message throttle, body-size cap. The widget endpoint is public and unauthenticated on a production domain.
- **Resume tokens:** ≥128-bit random, single-conversation scope, constant-time lookup. The emailed link grants access to chat history: tokens are never logged and never leak via referrers (the resume page immediately moves the token out of the URL).
- **Per-tenant origin allowlist:** widget requests validated against the tenant's registered domains (Origin/Referer check + CORS); embedding on an unlisted domain is rejected.
- **Secrets:** bot tokens live only in the server database; nothing secret ships in the widget bundle.

> **Accepted risk (by design):** every customer message, name, and email flows into Telegram's cloud — Telegram is a data processor for all tenants. Inherent to the product concept and must be disclosed to tenants.

**Retention:** indefinite. Operators are responsible for backups and any manual deletion required by their privacy policy.

## 9. Implementation order

1. **Repo + schema + tenant seed** — SQLite schema above; Hotline HQ inserted as tenant #1 with bot + supergroup created manually.
2. **Telegram side first** — per-tenant getUpdates poller; create topic, post info card, relay a hardcoded test message in/out. (Riskiest integration goes first.)
3. **Widget MVP** — script-tag embed, pre-chat form, POST send, SSE receive, localStorage resume.
4. **Agent verbs** — `/close`, `/note`, round-robin @mention, reopen-on-new-message.
5. **Email resume** — offline detection, SendGrid template, resume page.
6. **Hardening** — rate limits and origin allowlist. **Gate: no pilot traffic before this lands.**
7. **Pilot** — embed on hotlinehq.online, run 2–4 weeks, log every moment an agent wished for a feature Telegram couldn't provide (that list is the v1 roadmap).

**Dependencies:** 3 needs 2's relay API; 4–5 need 3; 6 blocks 7. Steps 2 and 3 parallelize once the schema (1) exists.

```
1 ──▶ 2 ──▶ 3 ──▶ 4 ──▶ 6 ──▶ 7
      └────▶ 3    5 ───▶ 6
```

## 10. Decisions log

| # | Decision | Pushback / rationale |
|---|---|---|
| 1 | Standalone product, separate repo | Owner call; Hotline HQ is tenant #1 only. Hotline patterns (raw Bot API calls, SQLite, SSE) reused as conventions, not code. |
| 2 | **12-bot pool rejected** → one bot + forum topics | Claude pushback, owner accepted: bots have no concurrency limit; bots can't DM first (slot handoff breaks); topics are the industry pattern; reply-routing confusion is Re:plain's #1 complaint. |
| 3 | Customer entry = web widget, not Telegram | Claude pushback, owner accepted: US dealers largely don't use Telegram; requiring it would sink the pilot. |
| 4 | Hybrid assignment (round-robin @mention, anyone answers) | Owner chose over claim-only (Claude's rec) and enforced caps. Soft ownership, no presence tracking. |
| 5 | Pre-chat name + email form | B2B context for agents + enables async email resume. |
| 6 | Email notification + resume link for offline customers | Makes it real async support, not just live chat. Full inbound email bridge deferred. |
| 7 | Multi-tenant schema, manual onboarding | Avoids single-tenant rewrite without building signup/billing now. |
| 8 | Agent verbs: /close, /note, info card; canned replies skipped | Keep "Telegram is the whole tool" honest with minimal command surface. |
| 9 | POC bar = live pilot on hotlinehq.online | Real traffic over demo; forces email + hardening into scope. |
| 10 | Security baseline non-negotiable | Rate limits, 128-bit resume tokens, origin allowlist — public endpoint on a production domain. |
| 11 | Indefinite retention in this fork | Automatic database and Telegram-topic deletion is disabled; operators own backup and privacy-policy compliance. |
| 12 | **Name: Supportgram** (supportgram.io) | Owner preference over Claude's rec (GramSupport, whose .com was free). Cost = living on .io; mitigation = inquiry on supportgram.com. |
| 13 | **Deploy on a VPS with Docker** | The native Node.js server keeps the existing API handlers and stores libSQL data in a persistent volume. |

## 11. Task checklist

- [ ] **Phase 1 — Foundation**
  - [ ] Register supportgram.io (+ @supportgram Telegram username/bot); inquire on supportgram.com
  - [ ] Node project scaffold: Express, better-sqlite3, esbuild, pm2 ecosystem file
  - [ ] SQLite schema: `businesses`, `agents`, `conversations`, `messages`
  - [ ] Create Hotline HQ bot via BotFather; create supergroup with Topics; seed tenant row + agents
- [ ] **Phase 2 — Telegram relay**
  - [ ] Per-tenant `getUpdates` long-poll loop (Map of pollers, resilient restart)
  - [ ] Topic creation + pinned info card on new conversation
  - [ ] Inbound relay: topic messages → conversation store
- [ ] **Phase 3 — Widget**
  - [ ] Embeddable `widget.js` (<15 KB): launcher, pre-chat form, chat pane
  - [ ] `POST /api/conversations` + `POST /api/messages` + SSE stream endpoint
  - [ ] localStorage resume token handling
- [ ] **Phase 4 — Agent verbs**
  - [ ] `/close` (resolve + close topic + widget "ended" state), reopen on new message
  - [ ] `/note` internal messages (never relayed)
  - [ ] Round-robin @mention suggestion; first reply sets assignee
- [ ] **Phase 5 — Email resume**
  - [ ] Offline detection (no active SSE) + SendGrid "you have a reply" template (1/conversation/hour)
  - [ ] Resume page at `/c/{token}` (token moved out of URL immediately)
- [ ] **Phase 6 — Hardening (pilot gate)**
  - [ ] Rate limits: per-IP create/send, per-conversation throttle, body-size cap
  - [ ] Per-tenant origin allowlist enforcement (Origin/Referer + CORS)
  - [ ] Back up the persistent database volume
- [ ] **Phase 7 — Pilot**
  - [ ] Embed on hotlinehq.online; announce to dealers
  - [ ] Run 2–4 weeks; keep a "wished Telegram could…" log → v1 roadmap
