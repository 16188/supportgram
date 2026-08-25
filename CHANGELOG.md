# Changelog

## 2026-08-25

- Translated all visitor- and agent-facing interface text into Chinese.
- Replaced the default widget avatars and launcher icon with the MAITG website logo.
- Stored the local database in the deployment directory at `./data/supportgram.db`.
- Disabled the 90-day conversation and Telegram topic purge.
- Added a dependency-free Node.js server for self-hosting.
- Added Docker Compose installation and persistent local database storage.
- Added GitHub Actions publishing to `ghcr.io/16188/supportgram`.
- Fixed static assets such as `/widget.js` returning 404 from the VPS server.
