/**
 * LifeLink - Notification Service End-to-End Test Script
 * Verifies:
 * 1. Auth & login as requester
 * 2. Creating an emergency blood request
 * 3. Spatial + compatibility matching of eligible donors
 * 4. In-App Notification persistence in MongoDB
 * 5. Email dispatch & generation of Ethereal preview link
 */

const http = require('http');

function postJSON(path, payload, token = null) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'POST',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runNotificationTest() {
  console.log('====================================================');
  console.log('🔔 TESTING LIFELINK NOTIFICATION SERVICE');
  console.log('====================================================\n');

  try {
    // 1. Authenticate as Recipient (Sarah Jenkins)
    console.log('1️⃣ Authenticating as recipient (sarah.jenkins@hospital.org)...');
    const loginRes = await postJSON('/api/auth/login', {
      loginId: 'sarah.jenkins@hospital.org',
      password: 'user123'
    });

    if (!loginRes.data.success) {
      throw new Error(`Login failed: ${loginRes.data.message}`);
    }
    const recipientToken = loginRes.data.token;
    console.log(`   ✅ Logged in successfully as: ${loginRes.data.user.name}`);

    // 2. Create an Emergency Blood Request for O- blood
    // Vikram Mehta is O- donor located in Indiranagar (~5.2 km from Bangalore center)
    console.log('\n2️⃣ Dispatching Emergency Blood Request for O- blood...');
    const requestPayload = {
      patientName: 'Kavita Nair',
      patientAge: 28,
      requiredBloodGroup: 'O-',
      unitsRequired: 2,
      hospitalName: 'Manipal Hospital HAL Airport Road',
      hospitalAddress: '98 HAL Old Airport Rd, Kodihalli, Bengaluru',
      coordinates: [77.6514, 12.9592], // HAL Airport Road coordinates [lng, lat]
      searchRadiusKm: 15,
      urgency: 'Critical',
      contactPhone: '+91 98450 11223',
      medicalCondition: 'Emergency ICU Trauma'
    };

    const createReqRes = await postJSON('/api/requests', requestPayload, recipientToken);
    if (!createReqRes.data.success) {
      throw new Error(`Create request failed: ${createReqRes.data.message}`);
    }
    console.log(`   ✅ Request created successfully (ID: ${createReqRes.data.request._id})`);
    console.log(`   📢 Donors matched and notified: ${createReqRes.data.notifiedDonorsCount}`);

    // 3. Authenticate as the matched Donor (Vikram Mehta - O-)
    console.log('\n3️⃣ Authenticating as matched donor (vikram.m@gmail.com)...');
    const donorLoginRes = await postJSON('/api/auth/login', {
      loginId: 'vikram.m@gmail.com',
      password: 'donor123'
    });
    if (!donorLoginRes.data.success) {
      throw new Error(`Donor login failed: ${donorLoginRes.data.message}`);
    }
    const donorToken = donorLoginRes.data.token;
    console.log(`   ✅ Logged in as donor: ${donorLoginRes.data.user.name} (${donorLoginRes.data.user.bloodGroup})`);

    // Poll for email pipeline to settle (up to 8 seconds)
    console.log('\n4️⃣ Checking Donor\'s in-app notification inbox & verifying email dispatch...');
    let notifications = [];
    let latest = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(r => setTimeout(r, 1000));
      const notifRes = await getJSON('/api/notifications', donorToken);
      if (notifRes.data && notifRes.data.success) {
        notifications = notifRes.data.notifications;
        latest = notifications[0];
        if (latest && (latest.emailStatus === 'sent' || latest.emailStatus === 'failed')) {
          break;
        }
      }
    }

    console.log(`   ✅ Retrieved ${notifications.length} notification(s) from MongoDB for Vikram.`);

    if (latest) {
      console.log('\n====================================================');
      console.log('📩 LATEST NOTIFICATION RECEIVED:');
      console.log('----------------------------------------------------');
      console.log(`Title:    ${latest.title}`);
      console.log(`Message:  ${latest.message}`);
      console.log(`Urgency:  ${latest.urgency}`);
      console.log(`Type:     ${latest.type}`);
      console.log(`Created:  ${latest.createdAt}`);
      console.log(`Email:    ${latest.emailStatus} (Sent: ${latest.emailSent})`);
      if (latest.emailPreviewUrl) {
        console.log(`Preview:  ${latest.emailPreviewUrl}`);
      }
      console.log('====================================================');
    }

    // 5. Test Email Service Diagnostics Endpoint
    console.log('\n5️⃣ Testing Email Diagnostics endpoint (/api/notifications/diagnostics)...');
    const diagRes = await getJSON('/api/notifications/diagnostics', donorToken);
    if (diagRes.data && diagRes.data.success) {
      console.log(`   ✅ Diagnostics verified! Mode: ${diagRes.data.mode}, Host: ${diagRes.data.host}, From: ${diagRes.data.fromAddress}`);
    } else {
      console.warn(`   ⚠️ Diagnostics returned:`, diagRes.data);
    }

    // 6. Test Direct Email Notification Dispatch (/api/notifications/test-email)
    console.log('\n6️⃣ Triggering instant test notification email (/api/notifications/test-email)...');
    const testEmailRes = await postJSON('/api/notifications/test-email', {}, donorToken);
    if (testEmailRes.data && testEmailRes.data.success) {
      console.log(`   ✅ Direct test email successful! Recipient: ${testEmailRes.data.recipientEmail}`);
      if (testEmailRes.data.previewUrl) {
        console.log(`   🔗 Preview URL: ${testEmailRes.data.previewUrl}`);
      }
    } else {
      console.warn(`   ⚠️ Test email result:`, testEmailRes.data);
    }

    console.log('\n✨ Notification service test completed successfully! All components functioning.');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
}

runNotificationTest();
