#!/usr/bin/env node
/**
 * LifeLink Administrator Bootstrap & Recovery Utility
 *
 * Usage:
 *   node scripts/create-admin.js --email=admin@lifelink.org --password=YourSecurePassword123 --name="System Admin"
 *
 * Environment variables:
 *   ADMIN_EMAIL or ADMIN_BOOTSTRAP_EMAIL
 *   ADMIN_PASSWORD or ADMIN_BOOTSTRAP_PASSWORD
 *   ADMIN_NAME
 *   ADMIN_USERNAME
 *   ADMIN_PHONE
 */

require('dotenv').config();
const readline = require('readline');
const { connectDB, disconnectDB } = require('../server/config/db');
const User = require('../server/models/User');
const { logAdminAction } = require('../server/utils/auditLogger');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { reset: false, force: false };
  for (const arg of args) {
    if (arg.startsWith('--email=')) config.email = arg.split('=')[1].trim();
    if (arg.startsWith('--password=')) config.password = arg.split('=')[1];
    if (arg.startsWith('--name=')) config.name = arg.split('=')[1].trim();
    if (arg.startsWith('--username=')) config.username = arg.split('=')[1].trim();
    if (arg.startsWith('--phone=')) config.phone = arg.split('=')[1].trim();
    if (arg === '--reset' || arg === '--force') config.reset = true;
  }
  return config;
}

function prompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

async function main() {
  console.log('====================================================');
  console.log('🛡️  LIFELINK PRO - SECURE ADMIN BOOTSTRAP UTILITY');
  console.log('====================================================\n');

  const cliArgs = parseArgs();
  const email =
    cliArgs.email ||
    process.env.ADMIN_EMAIL ||
    process.env.ADMIN_BOOTSTRAP_EMAIL ||
    (process.stdin.isTTY ? await prompt('Admin Email address: ') : null);

  const password =
    cliArgs.password ||
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_BOOTSTRAP_PASSWORD ||
    (process.stdin.isTTY ? await prompt('Admin Password (min 8 chars): ') : null);

  const name =
    cliArgs.name ||
    process.env.ADMIN_NAME ||
    'System Administrator';

  const defaultUsername = email ? email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_') : 'admin';
  const username =
    cliArgs.username ||
    process.env.ADMIN_USERNAME ||
    defaultUsername;

  const phone =
    cliArgs.phone ||
    process.env.ADMIN_PHONE ||
    ('+91 9' + Math.floor(100000000 + Math.random() * 900000000));

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    console.error('❌ Error: A valid email address is required.');
    process.exit(1);
  }

  if (!password || password.length < 8) {
    console.error('❌ Error: A password of at least 8 characters is required for administrative security.');
    process.exit(1);
  }

  await connectDB();

  try {
    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { username: username.toLowerCase().trim() }]
    });

    if (existing) {
      if (existing.role === 'admin' && !cliArgs.reset) {
        console.log(`ℹ️ Administrator account already exists for ${existing.email} (@${existing.username}).`);
        console.log(`   To reset existing administrator credentials, re-run with --reset flag:`);
        console.log(`   node scripts/create-admin.js --email=${existing.email} --password=NEW_PASSWORD --reset`);
      } else {
        console.log(`ℹ️ Updating existing account ${existing.email} to administrator role...`);
        if (cliArgs.name || (process.env.ADMIN_NAME && process.env.ADMIN_NAME !== 'System Administrator')) {
          existing.name = name;
        }
        existing.role = 'admin';
        existing.password = password; // Hashed automatically by pre('save') hook
        existing.status = 'active';
        existing.isBlocked = false;
        existing.isVerified = true;
        existing.isDeleted = false;
        await existing.save();

        await logAdminAction({
          adminId: existing._id,
          adminName: existing.name,
          action: 'ADMIN_SETUP',
          targetType: 'User',
          targetId: existing._id,
          reason: 'Initial administrator credentials setup/reset via bootstrap CLI',
          details: { email: existing.email, username: existing.username }
        });

        console.log(`✅ Administrator access successfully configured for: ${existing.name} (${existing.email})`);
        console.log(`   Role: ${existing.role}`);
        console.log(`   Status: ${existing.status}`);
      }
    } else {
      const newAdmin = await User.create({
        name,
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        phone,
        password, // Hashed automatically by pre('save') hook
        age: 35,
        bloodGroup: 'O+',
        address: 'LifeLink Administrative Operations',
        city: 'Bangalore',
        location: {
          type: 'Point',
          coordinates: [77.6033, 12.9756] // [lng, lat]
        },
        role: 'admin',
        isAvailableToDonate: true,
        isVerified: true,
        status: 'active'
      });

      await logAdminAction({
        adminId: newAdmin._id,
        adminName: newAdmin.name,
        action: 'ADMIN_SETUP',
        targetType: 'User',
        targetId: newAdmin._id,
        reason: 'Initial administrator created via bootstrap CLI',
        details: { email: newAdmin.email, username: newAdmin.username }
      });

      console.log(`✅ New Administrator created successfully!`);
      console.log(`   ID: ${newAdmin._id}`);
      console.log(`   Name: ${newAdmin.name}`);
      console.log(`   Username: @${newAdmin.username}`);
      console.log(`   Email: ${newAdmin.email}`);
      console.log(`   Role: ${newAdmin.role}`);
    }
  } catch (err) {
    console.error(`❌ Failed to initialize administrator: ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDB();
    console.log('\n====================================================');
    process.exit(0);
  }
}

main().catch(console.error);
