const nodemailer = require('nodemailer');

let transporterInstance = null;
let transporterPromise = null;

/**
 * Reset transporter cache to allow configuration reload
 */
function resetTransporter() {
  transporterInstance = null;
  transporterPromise = null;
}

/**
 * Check whether real production/custom SMTP credentials are provided in environment
 */
function isRealSmtpConfigured() {
  const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
  const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '';
  return smtpUser !== '' && smtpPass !== '';
}

/**
 * Determine a valid and deliverable From address
 */
function getFromAddress() {
  const configuredFrom = process.env.EMAIL_FROM ? process.env.EMAIL_FROM.trim() : '';
  const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';

  // If EMAIL_FROM contains default placeholder but user has real SMTP credentials configured
  if (smtpUser && (!configuredFrom || configuredFrom.includes('alerts@lifelink.org'))) {
    return `"LifeLink Emergency Alerts" <${smtpUser}>`;
  }

  if (configuredFrom) {
    return configuredFrom;
  }

  if (smtpUser) {
    return `"LifeLink Emergency Alerts" <${smtpUser}>`;
  }

  return '"LifeLink Emergency Alerts" <alerts@lifelink.org>';
}

/**
 * Get or initialize Nodemailer transporter
 */
async function getTransporter() {
  if (transporterInstance) {
    return transporterInstance;
  }
  if (transporterPromise) {
    try {
      return await transporterPromise;
    } catch (e) {
      transporterPromise = null;
    }
  }

  transporterPromise = (async () => {
    const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '';
    let smtpHost = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : '';
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpService = process.env.SMTP_SERVICE ? process.env.SMTP_SERVICE.trim().toLowerCase() : '';
    const smtpSecure = process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== ''
      ? (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1')
      : (smtpPort === 465);

    // If real SMTP credentials are provided
    if (smtpUser !== '' && smtpPass !== '') {
      const isGmail = smtpService === 'gmail' || smtpHost.includes('gmail') || smtpUser.endsWith('@gmail.com');
      const isOutlook = smtpService === 'outlook' || smtpHost.includes('outlook') || smtpHost.includes('office365') || smtpUser.endsWith('@outlook.com') || smtpUser.endsWith('@hotmail.com');

      if (isGmail) {
        console.log(`📧 Configured Gmail SMTP transport for account: ${smtpUser}`);
        transporterInstance = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass
          },
          tls: {
            rejectUnauthorized: false
          }
        });
        return transporterInstance;
      }

      if (isOutlook) {
        console.log(`📧 Configured Outlook/Hotmail SMTP transport for account: ${smtpUser}`);
        transporterInstance = nodemailer.createTransport({
          service: 'hotmail',
          auth: {
            user: smtpUser,
            pass: smtpPass
          },
          tls: {
            rejectUnauthorized: false
          }
        });
        return transporterInstance;
      }

      // Generic Custom SMTP (SendGrid, Mailgun, Brevo, AWS SES, private mail server)
      if (!smtpHost) {
        smtpHost = 'smtp.ethereal.email';
      }

      console.log(`📧 Configured custom SMTP transport with host: ${smtpHost}:${smtpPort} (secure: ${smtpSecure})`);
      transporterInstance = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      return transporterInstance;
    }

    // When real credentials are NOT configured:
    // Do NOT silently use Ethereal in production or when ALLOW_ETHEREAL_TEST is not explicitly true.
    const allowEthereal = process.env.ALLOW_ETHEREAL_TEST === 'true';
    if (!allowEthereal) {
      const configErrMsg = 'SMTP_NOT_CONFIGURED: Real email delivery requires valid SMTP_USER and SMTP_PASS credentials in .env.';
      console.warn(`⚠️ ${configErrMsg}`);
      const err = new Error(configErrMsg);
      err.code = 'SMTP_NOT_CONFIGURED';
      throw err;
    }

    // In isolated development/test environments where ALLOW_ETHEREAL_TEST is explicitly enabled:
    console.log('📧 Setting up local Ethereal test mailer (ALLOW_ETHEREAL_TEST=true)...');
    try {
      const testAccount = await nodemailer.createTestAccount();
      console.log(`✉️ Ethereal SMTP active. User: ${testAccount.user}`);
      transporterInstance = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      return transporterInstance;
    } catch (err) {
      console.warn(`Could not create Ethereal test account (${err.message}). Using JSON transporter.`);
      transporterInstance = nodemailer.createTransport({
        jsonTransport: true
      });
      return transporterInstance;
    }
  })();

  try {
    return await transporterPromise;
  } catch (err) {
    transporterPromise = null;
    throw err;
  }
}

/**
 * Test SMTP connection and authentication status
 */
async function verifySmtpConnection() {
  if (!isRealSmtpConfigured()) {
    return {
      success: false,
      configured: false,
      error: 'SMTP_NOT_CONFIGURED: SMTP_USER and SMTP_PASS are missing in environment variables.'
    };
  }

  try {
    const transporter = await getTransporter();
    await transporter.verify();
    return {
      success: true,
      configured: true,
      message: 'SMTP connection and authentication verified successfully.'
    };
  } catch (err) {
    return {
      success: false,
      configured: true,
      error: `SMTP connection verification failed: ${err.message}`
    };
  }
}

/**
 * Get Email Diagnostics Status
 */
async function getEmailDiagnostics() {
  try {
    const isCustom = isRealSmtpConfigured();
    const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const smtpHost = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : '';
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpSecure = process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== ''
      ? (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1')
      : (smtpPort === 465);
    const fromAddress = getFromAddress();

    const maskedUser = smtpUser
      ? smtpUser.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.min(b.length, 5))}${c}`)
      : 'not_configured';

    let connectionStatus = 'UNCONFIGURED';
    let verifyError = null;

    if (isCustom) {
      try {
        const transporter = await getTransporter();
        await transporter.verify();
        connectionStatus = 'CONNECTED';
      } catch (err) {
        connectionStatus = 'AUTH_OR_CONNECTION_ERROR';
        verifyError = err.message;
      }
    }

    return {
      success: true,
      isRealSMTP: isCustom,
      credentialsConfigured: isCustom,
      mode: isCustom ? 'production_smtp' : (process.env.ALLOW_ETHEREAL_TEST === 'true' ? 'ethereal_preview' : 'unconfigured'),
      host: smtpHost || (process.env.SMTP_SERVICE ? `${process.env.SMTP_SERVICE} service` : 'none'),
      port: smtpPort,
      secure: smtpSecure,
      user: maskedUser,
      fromAddress,
      connectionStatus,
      verifyError
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Send emergency blood request notification email to a matched donor
 */
async function sendEmergencyBloodAlert(donorUser, requestDoc, distanceKm) {
  // Validate recipient donor email
  if (!donorUser || !donorUser.email || !/^\S+@\S+\.\S+$/.test(donorUser.email.trim())) {
    return {
      success: false,
      error: 'Recipient donor has no valid email address configured.',
      accepted: [],
      rejected: donorUser && donorUser.email ? [donorUser.email] : [],
      isRealDelivery: isRealSmtpConfigured(),
      previewUrl: null,
      html: null,
      text: null
    };
  }

  const recipientEmail = donorUser.email.trim();
  const donorName = donorUser.name || 'LifeLink Donor';
  const fromAddress = getFromAddress();
  const urgency = requestDoc.urgency || 'Urgent';
  const units = requestDoc.unitsRequired || 1;
  const distText = typeof distanceKm === 'number' ? distanceKm.toFixed(1) : (distanceKm || 'Nearby');
  const appUrl = process.env.APP_URL || 'http://localhost:5000';

  const emailSubject = `🚨 URGENT: Blood Donation Request Near Your Location – LifeLink (${requestDoc.requiredBloodGroup})`;

  // Plain-text alternative for text-only clients and anti-spam verification
  const textContent = [
    `🚨 URGENT: BLOOD DONATION REQUEST NEAR YOUR LOCATION – LIFELINK`,
    `================================================================`,
    ``,
    `Dear ${donorName},`,
    ``,
    `A patient within your community is in urgent need of compatible blood. You have been identified as an eligible nearby donor in LifeLink.`,
    ``,
    `EMERGENCY DETAILS:`,
    `------------------`,
    `* Required Blood Group: ${requestDoc.requiredBloodGroup}`,
    `* Patient Name: ${requestDoc.patientName}${requestDoc.patientAge ? ` (Age: ${requestDoc.patientAge})` : ''}`,
    `* Units Needed: ${units} Unit(s)`,
    `* Urgency Level: ${urgency}`,
    `* Hospital Name: ${requestDoc.hospitalName}`,
    `* Hospital Address: ${requestDoc.hospitalAddress || 'Local Hospital'}`,
    `* Approximate Distance: ~${distText} km from your registered location`,
    `* Contact Phone: ${requestDoc.contactPhone || 'Available upon acceptance in LifeLink app'}`,
    ``,
    `HOW TO RESPOND:`,
    `---------------`,
    `Please log in to your LifeLink dashboard to accept this request and coordinate directly with the requester:`,
    `${appUrl}/#requests`,
    ``,
    `----------------------------------------------------------------`,
    `This is an automated emergency alert dispatched because your profile indicates active donor availability within this radius.`
  ].join('\n');

  // Accessible, high-contrast HTML content
  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #fecaca; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #dc2626; color: #ffffff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px; letter-spacing: 0.5px;">🚨 URGENT BLOOD REQUIREMENT</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 14px;">LifeLink Emergency Alert System</p>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <p style="font-size: 16px; margin-top: 0;">Dear <strong>${donorName}</strong>,</p>
        <p style="line-height: 1.6;">
          A patient within your registered community radius is in urgent need of compatible blood. You have been identified as an eligible donor nearby.
        </p>

        <div style="background: #f8fafc; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0; border-radius: 0 6px 6px 0;">
          <div style="margin-bottom: 10px;">
            <span style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: bold;">Requested Blood Group</span>
            <div style="font-size: 26px; font-weight: 800; color: #dc2626;">${requestDoc.requiredBloodGroup}</div>
          </div>
          <p style="margin: 4px 0;"><strong>Patient:</strong> ${requestDoc.patientName} ${requestDoc.patientAge ? `(Age: ${requestDoc.patientAge})` : ''}</p>
          <p style="margin: 4px 0;"><strong>Urgency Level:</strong> <span style="color: #b91c1c; font-weight: bold; text-transform: uppercase;">${urgency}</span></p>
          <p style="margin: 4px 0;"><strong>Units Needed:</strong> ${units} Unit(s)</p>
          <p style="margin: 4px 0;"><strong>Hospital:</strong> ${requestDoc.hospitalName}</p>
          <p style="margin: 4px 0;"><strong>Location:</strong> ${requestDoc.hospitalAddress || 'Local Hospital'}</p>
          <p style="margin: 4px 0;"><strong>Estimated Distance:</strong> ~${distText} km from your location</p>
          <p style="margin: 4px 0;"><strong>Contact Phone:</strong> ${requestDoc.contactPhone || 'Available upon acceptance'}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <p style="color: #64748b; font-size: 14px; margin-bottom: 12px;">Please log in to your LifeLink dashboard to accept this request and coordinate directly:</p>
          <a href="${appUrl}/#requests" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px;">
            Respond in LifeLink App
          </a>
        </div>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 0;">
          This email was sent automatically by LifeLink because your profile indicates active blood donor availability in this geographic radius.
        </p>
      </div>
    </div>
  `;

  // Check if SMTP is configured before sending
  if (!isRealSmtpConfigured() && process.env.ALLOW_ETHEREAL_TEST !== 'true') {
    const errorMsg = 'SMTP credentials not configured. Please set SMTP_USER and SMTP_PASS in .env for real email delivery.';
    console.warn(`⚠️ [Email Warning] ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
      accepted: [],
      rejected: [recipientEmail],
      isRealDelivery: false,
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject: emailSubject,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`🔗 [Email Preview] Alert to ${recipientEmail}: ${previewUrl}`);
    } else {
      console.log(`✉️ [Email Accepted] Dispatched to ${recipientEmail} | Message ID: ${info.messageId}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted && info.accepted.length > 0 ? info.accepted : [recipientEmail],
      rejected: info.rejected || [],
      response: info.response || '250 OK Message accepted for delivery',
      isRealDelivery: isRealSmtpConfigured(),
      previewUrl: previewUrl || null,
      html: htmlContent,
      text: textContent
    };
  } catch (err) {
    console.error(`❌ Failed to send blood alert email to ${recipientEmail}:`, err.message);
    return {
      success: false,
      error: err.message,
      accepted: [],
      rejected: [recipientEmail],
      isRealDelivery: isRealSmtpConfigured(),
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }
}

/**
 * Send notification email to requester when a donor accepts their request
 */
async function sendRequestAcceptedAlert(requesterUser, donorUser, requestDoc) {
  if (!requesterUser || !requesterUser.email) {
    return {
      success: false,
      error: 'Requester does not have a valid email address configured.',
      previewUrl: null,
      html: null,
      text: null
    };
  }

  const fromAddress = getFromAddress();
  const recipientEmail = requesterUser.email.trim();
  const appUrl = process.env.APP_URL || 'http://localhost:5000';

  const textContent = [
    `🎉 DONOR ACCEPTED YOUR BLOOD REQUEST – LIFELINK`,
    `==============================================`,
    ``,
    `Dear ${requesterUser.name || 'LifeLink Member'},`,
    ``,
    `A donor has stepped forward to pledge blood for patient ${requestDoc.patientName} (${requestDoc.requiredBloodGroup}).`,
    ``,
    `DONOR DETAILS:`,
    `* Donor Name: ${donorUser.name}`,
    `* Blood Group: ${donorUser.bloodGroup}`,
    `* Donor Phone: ${donorUser.phone || 'Available in chat'}`,
    `* Hospital: ${requestDoc.hospitalName}`,
    ``,
    `You can now coordinate securely via the LifeLink chat room: ${appUrl}/#chat`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #bbf7d0; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #16a34a; color: #ffffff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">🎉 DONOR ACCEPTED YOUR REQUEST</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 14px;">LifeLink Emergency Alert System</p>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <p style="font-size: 16px; margin-top: 0;">Dear <strong>${requesterUser.name || 'LifeLink Member'}</strong>,</p>
        <p style="line-height: 1.6;">
          A donor has stepped forward to pledge blood for patient <strong>${requestDoc.patientName}</strong> (${requestDoc.requiredBloodGroup}).
        </p>
        <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; margin: 20px 0; border-radius: 0 6px 6px 0;">
          <p style="margin: 4px 0;"><strong>Donor Name:</strong> ${donorUser.name}</p>
          <p style="margin: 4px 0;"><strong>Blood Group:</strong> ${donorUser.bloodGroup}</p>
          <p style="margin: 4px 0;"><strong>Donor Phone:</strong> ${donorUser.phone || 'Available in chat'}</p>
          <p style="margin: 4px 0;"><strong>Hospital:</strong> ${requestDoc.hospitalName}</p>
        </div>
        <p style="line-height: 1.6;">You can now communicate securely via the real-time LifeLink chat coordination room.</p>
      </div>
    </div>
  `;

  if (!isRealSmtpConfigured() && process.env.ALLOW_ETHEREAL_TEST !== 'true') {
    return {
      success: false,
      error: 'SMTP credentials not configured in .env',
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject: `✅ Donor Confirmed for Blood Request (${requestDoc.requiredBloodGroup})`,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      html: htmlContent,
      text: textContent
    };
  } catch (err) {
    console.error(`❌ Failed to send accept alert email to ${recipientEmail}:`, err.message);
    return {
      success: false,
      error: err.message,
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }
}

/**
 * Send notification email when a blood request is cancelled
 */
async function sendRequestCancelledAlert(donorUser, requesterUser, requestDoc, reason) {
  if (!donorUser || !donorUser.email) {
    return {
      success: false,
      error: 'Donor does not have a valid email address configured.',
      previewUrl: null,
      html: null,
      text: null
    };
  }

  const fromAddress = getFromAddress();
  const recipientEmail = donorUser.email.trim();

  const textContent = [
    `ℹ️ NOTICE: BLOOD REQUEST CANCELLED – LIFELINK`,
    `=============================================`,
    ``,
    `Dear ${donorUser.name || 'LifeLink Donor'},`,
    ``,
    `The emergency blood request for patient ${requestDoc.patientName} (${requestDoc.requiredBloodGroup}) at ${requestDoc.hospitalName} has been cancelled.`,
    ``,
    `Reason: ${reason || 'Cancelled by requester'}`,
    ``,
    `Thank you for your willingness to help your community. You remain available for other nearby emergencies.`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #64748b; color: #ffffff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 22px;">ℹ️ Blood Request Cancelled</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 14px;">LifeLink Emergency Alert System</p>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <p style="font-size: 16px; margin-top: 0;">Dear <strong>${donorUser.name || 'LifeLink Donor'}</strong>,</p>
        <p style="line-height: 1.6;">
          The emergency blood request for patient <strong>${requestDoc.patientName}</strong> (${requestDoc.requiredBloodGroup}) at ${requestDoc.hospitalName} has been cancelled.
        </p>
        <div style="background: #f8fafc; border-left: 4px solid #64748b; padding: 14px; margin: 18px 0; border-radius: 0 6px 6px 0;">
          <p style="margin: 4px 0;"><strong>Reason:</strong> ${reason || 'Cancelled by requester'}</p>
        </div>
        <p style="line-height: 1.6;">Thank you for your willingness to help your community. You remain available for other nearby emergencies.</p>
      </div>
    </div>
  `;

  if (!isRealSmtpConfigured() && process.env.ALLOW_ETHEREAL_TEST !== 'true') {
    return {
      success: false,
      error: 'SMTP credentials not configured in .env',
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject: `ℹ️ Notice: Blood Request for ${requestDoc.patientName} Cancelled`,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      html: htmlContent,
      text: textContent
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }
}

/**
 * Send notification email when a blood donation is fulfilled & certificate issued
 */
async function sendDonationFulfilledAlert(donorUser, requestDoc, donationDoc) {
  if (!donorUser || !donorUser.email) {
    return {
      success: false,
      error: 'Donor does not have a valid email address configured.',
      previewUrl: null,
      html: null,
      text: null
    };
  }

  const fromAddress = getFromAddress();
  const recipientEmail = donorUser.email.trim();

  const textContent = [
    `🎖️ HERO OF LIFELINK - DONATION COMPLETED`,
    `========================================`,
    ``,
    `Dear ${donorUser.name},`,
    ``,
    `Your blood donation for patient ${requestDoc.patientName} at ${requestDoc.hospitalName} has been successfully completed and verified!`,
    ``,
    `DIGITAL CERTIFICATE OF APPRECIATION:`,
    `* Certificate ID: ${donationDoc.certificateId || 'LL-CERT'}`,
    `* Units Donated: ${donationDoc.unitsDonated || 1} Unit(s)`,
    `* Date: ${new Date().toLocaleDateString()}`,
    ``,
    `Your generosity has saved a life today. You can view and download your official certificate anytime from your profile.`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #fde68a; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #d97706; color: #ffffff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">🎖️ HERO OF LIFELINK - DONATION COMPLETED</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 14px;">LifeLink Digital Certificate of Appreciation</p>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <p style="font-size: 16px; margin-top: 0;">Dear <strong>${donorUser.name}</strong>,</p>
        <p style="line-height: 1.6;">
          Your blood donation for patient <strong>${requestDoc.patientName}</strong> at <strong>${requestDoc.hospitalName}</strong> has been successfully completed and verified!
        </p>
        <div style="background: #fffbeb; border: 2px dashed #d97706; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center;">
          <h2 style="margin: 0 0 8px 0; color: #b45309; font-size: 20px;">Digital Appreciation Certificate</h2>
          <p style="margin: 4px 0; font-size: 14px; color: #78350f;"><strong>Certificate ID:</strong> ${donationDoc.certificateId || 'LL-CERT'}</p>
          <p style="margin: 4px 0; font-size: 14px; color: #78350f;"><strong>Units Donated:</strong> ${donationDoc.unitsDonated || 1} Unit(s)</p>
          <p style="margin: 4px 0; font-size: 14px; color: #78350f;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        <p style="line-height: 1.6;">Your generosity has saved a life today. You can view and download your official certificate anytime from your profile.</p>
      </div>
    </div>
  `;

  if (!isRealSmtpConfigured() && process.env.ALLOW_ETHEREAL_TEST !== 'true') {
    return {
      success: false,
      error: 'SMTP credentials not configured in .env',
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject: `🎖️ Donation Fulfilled! Your LifeLink Certificate is Ready`,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      html: htmlContent,
      text: textContent
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }
}

/**
 * Send admin broadcast email to targeted community member
 */
async function sendBroadcastAlert(user, title, message) {
  if (!user || !user.email) {
    return {
      success: false,
      error: 'User has no valid email address configured.',
      previewUrl: null,
      html: null,
      text: null
    };
  }

  const fromAddress = getFromAddress();
  const recipientEmail = user.email.trim();

  const textContent = [
    `📢 LIFELINK COMMUNITY ANNOUNCEMENT: ${title}`,
    `============================================`,
    ``,
    `Dear ${user.name || 'Member'},`,
    ``,
    `${message}`,
    ``,
    `This administrative broadcast was dispatched to registered members of LifeLink.`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #1e293b; color: #ffffff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 22px;">📢 LifeLink Community Announcement</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 13px;">Official Notification from LifeLink Administration</p>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <p style="font-size: 16px; margin-top: 0;">Dear <strong>${user.name || 'Member'}</strong>,</p>
        <h3 style="color: #0f172a; margin: 16px 0 8px 0;">${title}</h3>
        <div style="background: #f1f5f9; padding: 16px; border-radius: 6px; line-height: 1.6; margin: 16px 0;">
          ${message}
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">This administrative broadcast was dispatched to registered members of LifeLink.</p>
      </div>
    </div>
  `;

  if (!isRealSmtpConfigured() && process.env.ALLOW_ETHEREAL_TEST !== 'true') {
    return {
      success: false,
      error: 'SMTP credentials not configured in .env',
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject: `📢 LifeLink Announcement: ${title}`,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      html: htmlContent,
      text: textContent
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }
}

/**
 * Send instant test email to verify notification service
 */
async function sendTestEmailNotification(recipientEmail, recipientName = 'LifeLink Member') {
  if (!recipientEmail || !recipientEmail.trim()) {
    return {
      success: false,
      error: 'Recipient email address is required.',
      previewUrl: null,
      html: null,
      text: null
    };
  }

  const fromAddress = getFromAddress();
  const timestamp = new Date().toLocaleString();
  const cleanEmail = recipientEmail.trim();

  const textContent = [
    `🔔 LIFELINK NOTIFICATION TEST`,
    `=============================`,
    ``,
    `Hello ${recipientName},`,
    ``,
    `Your LifeLink Email Notification System is verified and operational.`,
    ``,
    `* Recipient: ${cleanEmail}`,
    `* Sender: ${fromAddress}`,
    `* Dispatched At: ${timestamp}`,
    ``,
    `You will reliably receive emergency blood requests, donor pledge updates, and certification notices at this address.`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #93c5fd; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #2563eb; color: #ffffff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">🔔 LifeLink Notification Test</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.95; font-size: 14px;">Diagnostic & Delivery Verification</p>
      </div>
      <div style="padding: 24px; color: #1e293b;">
        <p style="font-size: 16px; margin-top: 0;">Hello <strong>${recipientName}</strong>,</p>
        <p style="line-height: 1.6;">
          Your LifeLink Email Notification System is <strong>working properly and connected</strong>.
        </p>
        <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin: 20px 0; border-radius: 0 6px 6px 0;">
          <p style="margin: 4px 0;"><strong>Status:</strong> <span style="color: #16a34a; font-weight: bold;">✅ Verified & Operational</span></p>
          <p style="margin: 4px 0;"><strong>Recipient:</strong> ${cleanEmail}</p>
          <p style="margin: 4px 0;"><strong>Dispatched At:</strong> ${timestamp}</p>
          <p style="margin: 4px 0;"><strong>Sender:</strong> ${fromAddress}</p>
        </div>
        <p style="line-height: 1.6;">You will reliably receive emergency blood requests, donor pledge updates, and certification notices at this address.</p>
      </div>
    </div>
  `;

  if (!isRealSmtpConfigured() && process.env.ALLOW_ETHEREAL_TEST !== 'true') {
    return {
      success: false,
      error: 'SMTP credentials not configured in .env',
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: fromAddress,
      to: cleanEmail,
      subject: `🔔 LifeLink Notification System: Test Email Verified (${timestamp})`,
      text: textContent,
      html: htmlContent
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`🔗 [Email Preview] Test Email to ${cleanEmail}: ${previewUrl}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
      html: htmlContent,
      text: textContent
    };
  } catch (err) {
    console.error(`❌ Test email failed to ${cleanEmail}:`, err.message);
    return {
      success: false,
      error: err.message,
      previewUrl: null,
      html: htmlContent,
      text: textContent
    };
  }
}

module.exports = {
  getTransporter,
  resetTransporter,
  getFromAddress,
  getEmailDiagnostics,
  isRealSmtpConfigured,
  verifySmtpConnection,
  sendEmergencyBloodAlert,
  sendRequestAcceptedAlert,
  sendRequestCancelledAlert,
  sendDonationFulfilledAlert,
  sendBroadcastAlert,
  sendTestEmailNotification
};
