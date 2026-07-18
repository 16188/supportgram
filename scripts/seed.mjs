#!/usr/bin/env node

import crypto from 'crypto';
import { config } from '../config.js';
import client, { initSchema } from '../db/index.js';
import { setWebhook, setMyCommands } from '../lib/telegramApi.js';

// Parse CLI arguments
const args = process.argv.slice(2);
const flags = {};
let currentFlag = null;

for (const arg of args) {
  if (arg.startsWith('--')) {
    currentFlag = arg.slice(2);
    flags[currentFlag] = true;
  } else if (currentFlag) {
    flags[currentFlag] = arg;
    currentFlag = null;
  }
}

await initSchema();

function toObjects(result) {
  return result.rows.map((row) => {
    const obj = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

if (flags.list) {
  // List all businesses and agents
  const businesses = toObjects(await client.execute('SELECT * FROM businesses'));
  if (businesses.length === 0) {
    console.log('No businesses found.');
    process.exit(0);
  }

  for (const biz of businesses) {
    console.log(`\nBusiness #${biz.id}: ${biz.name}`);
    console.log(`  Public Key: ${biz.public_key}`);
    console.log(`  Bot Token: ${biz.bot_token.slice(0, 10)}...`);
    console.log(`  Supergroup ID: ${biz.supergroup_id}`);
    console.log(`  Webhook Secret: ${biz.webhook_secret.slice(0, 6)}...`);
    console.log(`  Origin Allowlist: ${biz.origin_allowlist}`);
    console.log(`  Created: ${biz.created_at}`);

    const agents = toObjects(await client.execute({
      sql: 'SELECT * FROM agents WHERE business_id = ?',
      args: [biz.id],
    }));
    if (agents.length === 0) {
      console.log('  Agents: none');
    } else {
      console.log('  Agents:');
      for (const agent of agents) {
        console.log(`    #${agent.id}: ${agent.display_name} (tg_user_id=${agent.tg_user_id}, username=${agent.tg_username}, active=${agent.active}, rotation_order=${agent.rotation_order})`);
      }
    }
  }
  process.exit(0);
}

// Create new business
if (!flags.name || !flags['bot-token'] || !flags.supergroup || !flags.origins) {
  console.error('Usage:');
  console.error('  node scripts/seed.mjs --name "Business Name" --bot-token BOT_TOKEN --supergroup -100123 --origins "https://domain1.com,https://domain2.com" [--agents "user1:Display1:username1,user2:Display2:"]');
  console.error('  node scripts/seed.mjs --list');
  process.exit(1);
}

// Generate public key + webhook secret
const publicKey = 'pk_' + crypto.randomBytes(12).toString('hex');
const webhookSecret = crypto.randomBytes(16).toString('hex');

// Parse origins
const origins = flags.origins.split(',').map((o) => o.trim());
const originAllowlist = JSON.stringify(origins);

// Insert business
const bizResult = await client.execute({
  sql: `INSERT INTO businesses (name, public_key, bot_token, supergroup_id, webhook_secret, origin_allowlist)
        VALUES (?, ?, ?, ?, ?, ?)`,
  args: [flags.name, publicKey, flags['bot-token'], parseInt(flags.supergroup, 10), webhookSecret, originAllowlist],
});
const businessId = Number(bizResult.lastInsertRowid);

console.log(`Created business: ${flags.name}`);
console.log(`  ID: ${businessId}`);
console.log(`  Public Key: ${publicKey}`);
console.log(`  Webhook Secret: ${webhookSecret}`);

// Insert agents if provided
if (flags.agents) {
  const agentSpecs = flags.agents.split(',').map((s) => s.trim());

  for (let i = 0; i < agentSpecs.length; i++) {
    const parts = agentSpecs[i].split(':');
    const tgUserId = parseInt(parts[0], 10);
    const displayName = parts[1] || 'Agent';
    const tgUsername = parts[2] || null;

    await client.execute({
      sql: `INSERT INTO agents (business_id, tg_user_id, tg_username, display_name, rotation_order)
            VALUES (?, ?, ?, ?, ?)`,
      args: [businessId, tgUserId, tgUsername, displayName, i],
    });
    console.log(`  Added agent: ${displayName} (tg_user_id=${tgUserId})`);
  }
}

// Register Telegram webhook (https deployments only)
const webhookUrl = `${config.BASE_URL}/api/tg/${publicKey}`;
if (config.BASE_URL.startsWith('https://')) {
  try {
    const result = await setWebhook(flags['bot-token'], webhookUrl, webhookSecret);
    console.log(`  Webhook set: ${webhookUrl} → ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`  Webhook setup FAILED: ${err.message}`);
    console.error(`  Set it manually: setWebhook url=${webhookUrl} secret_token=${webhookSecret}`);
  }
} else {
  console.log(`  Skipping setWebhook — BASE_URL is not https (${config.BASE_URL}).`);
  console.log(`  When deployed, register: ${webhookUrl} with secret_token=${webhookSecret}`);
}

// Register agent commands for the "/" autocomplete menu
try {
  await setMyCommands(flags['bot-token']);
  console.log('  Agent commands registered (/close, /note)');
} catch (err) {
  console.error(`  setMyCommands FAILED: ${err.message}`);
}

console.log('\nBusiness created successfully.');
