// Schema as individual CREATE statements — libsql executes one statement at a time.
export const statements = [
  `CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    bot_token TEXT NOT NULL,
    supergroup_id INTEGER NOT NULL,
    webhook_secret TEXT NOT NULL,
    origin_allowlist TEXT NOT NULL DEFAULT '[]',
    identity_secret TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    tg_user_id INTEGER NOT NULL,
    tg_username TEXT,
    display_name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    rotation_order INTEGER DEFAULT 0,
    last_suggested_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    page_url TEXT,
    ip_hash TEXT,
    topic_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    assigned_agent_id INTEGER,
    resume_token TEXT NOT NULL UNIQUE,
    last_email_at TEXT,
    last_seen_at TEXT,
    last_activity_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    direction TEXT NOT NULL,
    sender_label TEXT,
    body TEXT NOT NULL,
    tg_message_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_conversations_resume_token ON conversations(resume_token)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_business_email ON conversations(business_id, customer_email)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_business_topic ON conversations(business_id, topic_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_business_active ON agents(business_id, active)`,
];

// Additive migrations for databases created before these columns existed.
// "duplicate column" errors are expected and ignored by the runner.
export const migrations = [
  `ALTER TABLE businesses ADD COLUMN identity_secret TEXT`,
];
