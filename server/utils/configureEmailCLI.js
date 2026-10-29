const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../../.env');

// Ensure .env is loaded
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const {
  isRealSmtpConfigured,
  verifySmtpConnection,
  getEmailDiagnostics,
  sendTestEmailNotification,
  resetTransporter
} = require('../config/email');

function updateEnvFile(updates) {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  } else {
    content = '';
  }

  const lines = content.split(/\r?\n/);
  const updatedKeys = new Set();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) return line;

    const key = line.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Append any keys that weren't found
  for (const [k, v] of Object.entries(updates)) {
    if (!updatedKeys.has(k)) {
      newLines.push(`${k}=${v}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\r\n'), 'utf8');

  // Reload process.env
  for (const [k, v] of Object.entries(updates)) {
    process.env[k] = v;
  }
  resetTransporter();
}

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function runStatus() {
  const isConfigured = isRealSmtpConfigured();
  if (isConfigured) {
    const user = process.env.SMTP_USER || '';
    const service = process.env.SMTP_SERVICE || (process.env.SMTP_HOST ? process.env.SMTP_HOST : 'SMTP');
    console.log(`STATUS:CONFIGURED|${user}|${service}`);
  } else {
    console.log('STATUS:UNCONFIGURED');
  }
}

async function runInteractiveSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n============================================================');
  console.log('       LifeLink Real-World Email Notification Setup');
  console.log('============================================================');
  console.log('To send real blood emergency alerts to nearby donors, LifeLink');
  console.log('needs an authentic SMTP email service.\n');

  console.log('Select your email provider:');
  console.log('  1. Gmail (Recommended - 16-character App Password)');
  console.log('  2. Custom / Transactional SMTP (SendGrid, Mailgun, Brevo, Outlook)');
  console.log('  3. Skip setup for now (Continue with in-app alerts only)\n');

  const choice = await prompt(rl, 'Enter choice (1, 2, or 3) [Default 1]: ');

  if (choice === '3') {
    console.log('\nSkipping email configuration. Server will run with in-app alerts.');
    rl.close();
    return;
  }

  if (choice === '2') {
    // Custom SMTP
    console.log('\n--- Custom SMTP Configuration ---');
    const host = await prompt(rl, 'SMTP Host (e.g. smtp-relay.brevo.com / smtp.office365.com): ');
    const port = (await prompt(rl, 'SMTP Port [587]: ')) || '587';
    const secure = (await prompt(rl, 'Use SSL/TLS (true/false) [false]: ')) || 'false';
    const user = await prompt(rl, 'SMTP Username / Email: ');
    const pass = await prompt(rl, 'SMTP Password / API Key: ');
    const from = (await prompt(rl, `Sender Email Address ["LifeLink Emergency Alerts" <${user}>]: `)) || `"LifeLink Emergency Alerts" <${user}>`;

    if (!user || !pass) {
      console.log('❌ Error: Username and password cannot be empty. Setup aborted.');
      rl.close();
      return;
    }

    updateEnvFile({
      SMTP_SERVICE: '',
      SMTP_HOST: host,
      SMTP_PORT: port,
      SMTP_SECURE: secure,
      SMTP_USER: user,
      SMTP_PASS: pass,
      EMAIL_FROM: from,
      ALLOW_ETHEREAL_TEST: 'false'
    });
  } else {
    // Gmail setup (Default)
    console.log('\n--- Gmail Setup Instructions ---');
    console.log('1. Go to your Google Account (myaccount.google.com).');
    console.log('2. Ensure 2-Step Verification is turned ON.');
    console.log('3. Search for "App Passwords" in the Google Account search box.');
    console.log('4. Create an app password named "LifeLink" and copy the 16 characters.');
    console.log('------------------------------------------------------------\n');

    const email = await prompt(rl, 'Enter your Gmail address (e.g. yourname@gmail.com): ');
    if (!email || !email.includes('@')) {
      console.log('❌ Invalid email address. Setup aborted.');
      rl.close();
      return;
    }

    const appPass = await prompt(rl, 'Enter your 16-character Google App Password: ');
    if (!appPass) {
      console.log('❌ Password cannot be empty. Setup aborted.');
      rl.close();
      return;
    }

    // Clean up spaces from copied app password (e.g., "abcd efgh ijkl mnop" -> "abcdefghijklmnop")
    const cleanPass = appPass.replace(/\s+/g, '');

    updateEnvFile({
      SMTP_SERVICE: 'gmail',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: email,
      SMTP_PASS: cleanPass,
      EMAIL_FROM: `"LifeLink Emergency Alerts" <${email}>`,
      ALLOW_ETHEREAL_TEST: 'false'
    });
  }

  console.log('\n[INFO] Testing SMTP connection...');
  const testConn = await verifySmtpConnection();

  if (testConn.success) {
    console.log('✅ [SUCCESS] SMTP credentials verified successfully!');
    console.log('   Real-world email notifications are now ACTIVE.');

    const sendTest = await prompt(rl, '\nWould you like to send a test verification email to your address? (Y/N) [Y]: ');
    if (sendTest.toLowerCase() !== 'n') {
      const recipient = process.env.SMTP_USER;
      console.log(`[INFO] Sending test email to ${recipient}...`);
      const testRes = await sendTestEmailNotification(recipient, 'LifeLink Administrator');
      if (testRes.success) {
        console.log(`🎉 Test email sent successfully! Please check your inbox at: ${recipient}`);
      } else {
        console.log(`⚠️ Test email send issue: ${testRes.error}`);
      }
    }
  } else {
    console.log(`\n❌ [WARNING] Connection check failed: ${testConn.error}`);
    console.log('   Please check your credentials in .env and try again.');
  }

  console.log('\n============================================================\n');
  rl.close();
}

async function main() {
  const mode = process.argv[2] || 'status';
  if (mode === 'status') {
    await runStatus();
  } else if (mode === 'setup') {
    await runInteractiveSetup();
  } else if (mode === 'test') {
    const targetEmail = process.argv[3] || process.env.SMTP_USER;
    if (!targetEmail) {
      console.log('ERROR: No recipient email specified.');
      process.exit(1);
    }
    const res = await sendTestEmailNotification(targetEmail, 'LifeLink Member');
    console.log(JSON.stringify(res));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
