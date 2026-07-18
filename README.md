# Supportgram

Website live chat, answered entirely from Telegram.

Supportgram is a multi-tenant B2B SaaS: drop a script tag on your website, and visitor conversations appear as forum topics in your Telegram supergroup. Support agents read, reply, and resolve entirely in Telegram — no separate web inbox.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your settings:
   ```bash
   cp .env.example .env
   ```

3. Seed a test business and agents:
   ```bash
   npm run seed -- --name "Test Business" --bot-token "YOUR_BOT_TOKEN" --supergroup -100123456789 --origins "https://example.com" --agents "123456:Alice:alice_tg,789012:Bob:"
   ```

4. Build the widget and run locally (requires the Vercel CLI):
   ```bash
   npm run build:widget
   vercel dev        # then open http://localhost:3000/test.html (put your public_key in data-key)
   ```

## Embedding

```html
<script src="https://supportgram.vercel.app/widget.js" data-key="YOUR_PUBLIC_KEY"></script>
```

Optional attributes (each also settable via `SupportgramSettings`):

- `data-color="#d92d20"` — widget accent color (hex only)
- `data-title="Acme Corp"` — header/teaser title (default "Contact Us")
- `data-greeting="Questions? We're here."` — proactive teaser text shown once to new visitors, with "I have a question" / "No, thanks" buttons

The widget opens to a home view with a Recent Conversations list; visitors can hold multiple conversations, scoped per identity in the browser.

For visitors you've already identified (logged-in users), pass their identity and the pre-chat form is skipped — the conversation starts on their first message:

```html
<!-- Option A: data attributes -->
<script src="https://supportgram.vercel.app/widget.js" data-key="YOUR_PUBLIC_KEY"
        data-name="John Dealer" data-email="john@acme.com"></script>

<!-- Option B: settings object (set before the script tag; wins over data attributes) -->
<script>window.SupportgramSettings = { name: "John Dealer", email: "john@acme.com" };</script>
<script src="https://supportgram.vercel.app/widget.js" data-key="YOUR_PUBLIC_KEY"></script>
```

## Tenant administration (CLI)

There is no admin panel in the POC — tenants are managed with the seed CLI (run from the repo with a configured `.env`):

```bash
# List all tenants: public key, bot, supergroup, origins, agents
npm run seed -- --list

# Create a tenant (also registers the Telegram webhook when BASE_URL is https)
npm run seed -- \
  --name "Acme Corp" \
  --bot-token "123456:ABC..." \
  --supergroup -100123456789 \
  --origins "https://acme.com,https://www.acme.com" \
  --agents "123456:Alice:alice_tg,789012:Bob:"
```

- `--agents` format: `tg_user_id:DisplayName:tg_username` (username optional), comma-separated. Get a user's ID from the bot's `getUpdates` after they message the group.
- The printed **Public Key** (`pk_…`) is what goes in the widget's `data-key`.
- Adding an agent to an existing tenant currently requires a manual `INSERT` into the `agents` table (CLI flag planned).

## Deploy

Runs on Vercel (serverless functions + cron) with a [Turso](https://turso.tech) database. Set env vars in the Vercel project: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BASE_URL`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `CRON_SECRET`. Local development needs no cloud database — the default `TURSO_DATABASE_URL=file:data/local.db` uses a local file.

For full architecture and specification details, see [`docs/SPEC.md`](./docs/SPEC.md).
