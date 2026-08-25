# Changelog

## 2026-08-25

- Added the agent-only `/delete confirm` command to permanently remove a conversation, its VPS media files, and its Telegram topic.
- Added the Beijing-time customer service hours to the widget home screen.
- Added bidirectional image and video messaging between the website widget and Telegram, with media stored in `data/uploads`.
- Changed the proactive chat action label to `我要咨询`.
- Removed technical installation details from the public landing page.
- Translated all visitor- and agent-facing interface text into Chinese.
- Replaced the widget's interior avatars with the MAITG website logo while retaining the original chat launcher icon.
- Stored the local database in the deployment directory at `./data/supportgram.db`.
- Disabled the 90-day conversation and Telegram topic purge.
- Added a dependency-free Node.js server for self-hosting.
- Added Docker Compose installation and persistent local database storage.
- Added GitHub Actions publishing to `ghcr.io/16188/supportgram`.
- Fixed static assets such as `/widget.js` returning 404 from the VPS server.
