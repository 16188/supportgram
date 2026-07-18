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

For visitors you've already identified (logged-in users), pass their identity and the pre-chat form is skipped — the conversation starts on their first message:

```html
<!-- Option A: data attributes -->
<script src="https://supportgram.vercel.app/widget.js" data-key="YOUR_PUBLIC_KEY"
        data-name="John Dealer" data-email="john@acme.com"></script>

<!-- Option B: settings object (set before the script tag; wins over data attributes) -->
<script>window.SupportgramSettings = { name: "John Dealer", email: "john@acme.com" };</script>
<script src="https://supportgram.vercel.app/widget.js" data-key="YOUR_PUBLIC_KEY"></script>
```

## Deploy

Runs on Vercel (serverless functions + cron) with a [Turso](https://turso.tech) database. Set env vars in the Vercel project: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BASE_URL`, `BREVO_API_KEY`, `CRON_SECRET`. Local development needs no cloud database — the default `TURSO_DATABASE_URL=file:data/local.db` uses a local file.

For full architecture and specification details, see [`docs/SPEC.md`](./docs/SPEC.md).
