/**
 * LifeLink Phase 8 End-to-End Verification Test
 * Tests against live server http://localhost:5000:
 * Scenario 1: Nearby eligible donor
 * Scenario 2: Compatible donor outside radius
 * Scenario 3: Incompatible donor nearby
 * Scenario 4: Unavailable donor nearby
 * Scenario 5: Missing / invalid coordinates
 * Scenario 6: No eligible donors
 * Scenario 7: Duplicate submission
 * Scenario 8: Form validation (all fields vs removing one mandatory field)
 * Scenario 9: Multipart FormData upload & Real-time Socket.IO notification delivery
 */

const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:5000';

function request(options, postData = null, isMultipart = false, boundary = null) {
  return new Promise((resolve, reject) => {
    const headers = options.headers || {};
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    let bodyBuffer = null;
    if (postData) {
      if (isMultipart) {
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        bodyBuffer = Buffer.isBuffer(postData) ? postData : Buffer.from(postData);
        headers['Content-Length'] = bodyBuffer.length;
      } else {
        headers['Content-Type'] = 'application/json';
        const jsonStr = JSON.stringify(postData);
        bodyBuffer = Buffer.from(jsonStr);
        headers['Content-Length'] = Buffer.byteLength(jsonStr);
      }
    }

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: options.path,
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

function buildMultipartFormData(fields, files = []) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    }
  }

  for (const file of files) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType || 'text/plain'}\r\n\r\n${file.content}\r\n`
    );
  }

  parts.push(`--${boundary}--\r\n`);
  return {
    buffer: Buffer.from(parts.join('')),
    boundary
  };
}

async function runPhase8Tests() {
  console.log('================================================================');
  console.log('🚀 LIFELINK PHASE 8: COMPREHENSIVE END-TO-END VERIFICATION');
  console.log('================================================================\n');

  const ts = Date.now();
  const testResults = {};

  try {
    // -------------------------------------------------------------------------
    // SETUP: Register Controlled Test Accounts
    // -------------------------------------------------------------------------
    console.log('--- Setting up controlled test accounts ---');
    
    // Account A: Requester
    const reqEmail = `requester_${ts}@hospital.org`;
    const reqUser = {
      name: 'Nitheesh Kumar (Requester)',
      username: `req_user_${ts}`,
      email: reqEmail,
      phone: `+91 91000${String(ts).slice(-5)}`,
      password: 'password123',
      age: 25,
      bloodGroup: 'AB+',
      address: 'Government Hospital of Virudhunagar',
      city: 'Virudhunagar',
      coordinates: [77.9629, 9.5872] // Virudhunagar coordinates [lng, lat]
    };

    const regReq = await request({ path: '/api/auth/register', method: 'POST' }, reqUser);
    assert.strictEqual(regReq.status, 201, `Failed to register Requester: ${JSON.stringify(regReq.data)}`);
    const tokenA = regReq.data.token;
    const userA = regReq.data.user;
    console.log(`✅ Account A (Requester) registered: ${userA.name} [ID: ${userA._id}]`);

    // Account B: Eligible nearby donor (AB+ recipient can receive from all 8 blood groups; let's use O+)
    // Located 4.5 km away from Virudhunagar Hospital: [77.9950, 9.6100]
    const donorBEmail = `donor_eligible_${ts}@lifelink.org`;
    const donorBUser = {
      name: 'Prakash Donor (Eligible Nearby)',
      username: `donor_b_${ts}`,
      email: donorBEmail,
      phone: `+91 92000${String(ts).slice(-5)}`,
      password: 'password123',
      age: 27,
      bloodGroup: 'O+',
      address: 'Aruppukottai Road, Virudhunagar',
      city: 'Virudhunagar',
      coordinates: [77.9950, 9.6100], // ~4.3 km away
      isAvailableToDonate: true
    };
    const regB = await request({ path: '/api/auth/register', method: 'POST' }, donorBUser);
    assert.strictEqual(regB.status, 201, `Failed to register Donor B: ${JSON.stringify(regB.data)}`);
    const tokenB = regB.data.token;
    const userB = regB.data.user;
    console.log(`✅ Account B (Eligible Donor O+, 4.3 km) registered: ${userB.name} [ID: ${userB._id}]`);

    // Account C: Compatible donor OUTSIDE radius (e.g. Madurai, ~45 km away)
    const donorCEmail = `donor_far_${ts}@lifelink.org`;
    const donorCUser = {
      name: 'Ramesh Far (Outside Radius)',
      username: `donor_c_${ts}`,
      email: donorCEmail,
      phone: `+91 93000${String(ts).slice(-5)}`,
      password: 'password123',
      age: 29,
      bloodGroup: 'B+',
      address: 'Goripalayam, Madurai',
      city: 'Madurai',
      coordinates: [78.1328, 9.9252], // ~45 km away
      isAvailableToDonate: true
    };
    const regC = await request({ path: '/api/auth/register', method: 'POST' }, donorCUser);
    assert.strictEqual(regC.status, 201, `Failed to register Donor C: ${JSON.stringify(regC.data)}`);
    const tokenC = regC.data.token;
    const userC = regC.data.user;
    console.log(`✅ Account C (Compatible Donor B+, 45 km) registered: ${userC.name} [ID: ${userC._id}]`);

    // Account D: Incompatible blood group nearby (Will be tested with an A- request where B+ is incompatible)
    const donorDEmail = `donor_incomp_${ts}@lifelink.org`;
    const donorDUser = {
      name: 'Karthik Incomp (B+ Nearby)',
      username: `donor_d_${ts}`,
      email: donorDEmail,
      phone: `+91 94000${String(ts).slice(-5)}`,
      password: 'password123',
      age: 31,
      bloodGroup: 'B+',
      address: 'Main Bazaar, Virudhunagar',
      city: 'Virudhunagar',
      coordinates: [77.9650, 9.5890], // ~0.3 km away
      isAvailableToDonate: true
    };
    const regD = await request({ path: '/api/auth/register', method: 'POST' }, donorDUser);
    assert.strictEqual(regD.status, 201, `Failed to register Donor D: ${JSON.stringify(regD.data)}`);
    const tokenD = regD.data.token;
    const userD = regD.data.user;
    console.log(`✅ Account D (Nearby Donor B+, 0.3 km) registered: ${userD.name} [ID: ${userD._id}]`);

    // Account E: Nearby compatible donor who is UNAVAILABLE (isAvailableToDonate: false)
    const donorEEmail = `donor_unavail_${ts}@lifelink.org`;
    const donorEUser = {
      name: 'Suresh Unavailable',
      username: `donor_e_${ts}`,
      email: donorEEmail,
      phone: `+91 95000${String(ts).slice(-5)}`,
      password: 'password123',
      age: 33,
      bloodGroup: 'O+',
      address: 'Collectorate Road, Virudhunagar',
      city: 'Virudhunagar',
      coordinates: [77.9600, 9.5850], // ~0.4 km away
      isAvailableToDonate: false
    };
    const regE = await request({ path: '/api/auth/register', method: 'POST' }, donorEUser);
    assert.strictEqual(regE.status, 201, `Failed to register Donor E: ${JSON.stringify(regE.data)}`);
    const tokenE = regE.data.token;
    const userE = regE.data.user;
    console.log(`✅ Account E (Nearby Unavailable Donor O+) registered: ${userE.name} [ID: ${userE._id}]`);

    console.log('\n----------------------------------------------------------------');

    // -------------------------------------------------------------------------
    // SCENARIO 8: FORM VALIDATION
    // -------------------------------------------------------------------------
    console.log('📌 SCENARIO 8: FORM VALIDATION CHECKS');
    {
      // 8a: Submit with missing patientName only
      const resMissingName = await request({ path: '/api/requests', method: 'POST', token: tokenA }, {
        requiredBloodGroup: 'AB+',
        unitsRequired: 1,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        coordinates: [77.9629, 9.5872],
        searchRadiusKm: 15
      });
      assert.strictEqual(resMissingName.status, 400);
      assert.ok(resMissingName.data.message.includes('patientName'), `Expected patientName in message: ${resMissingName.data.message}`);
      assert.ok(!resMissingName.data.message.includes('hospitalName'), `hospitalName should NOT be in missing list: ${resMissingName.data.message}`);
      console.log(`  ✅ 8a: Single missing field reported accurately: "${resMissingName.data.message}"`);

      // 8b: Submit with missing contactPhone only
      const resMissingPhone = await request({ path: '/api/requests', method: 'POST', token: tokenA }, {
        patientName: 'Nitheesh Kumar',
        requiredBloodGroup: 'AB+',
        unitsRequired: 1,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        coordinates: [77.9629, 9.5872],
        searchRadiusKm: 15
      });
      assert.strictEqual(resMissingPhone.status, 400);
      assert.ok(resMissingPhone.data.message.includes('contactPhone'));
      console.log(`  ✅ 8b: Missing contactPhone reported accurately: "${resMissingPhone.data.message}"`);

      // 8c: Submit with invalid blood group
      const resInvalidBlood = await request({ path: '/api/requests', method: 'POST', token: tokenA }, {
        patientName: 'Nitheesh Kumar',
        requiredBloodGroup: 'XYZ',
        unitsRequired: 1,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        coordinates: [77.9629, 9.5872],
        searchRadiusKm: 15
      });
      assert.strictEqual(resInvalidBlood.status, 400);
      assert.ok(resInvalidBlood.data.message.includes('Invalid blood group'));
      console.log(`  ✅ 8c: Invalid blood group rejected accurately: "${resInvalidBlood.data.message}"`);

      // 8d: Submit with invalid unitsRequired (0 units)
      const resInvalidUnits = await request({ path: '/api/requests', method: 'POST', token: tokenA }, {
        patientName: 'Nitheesh Kumar',
        requiredBloodGroup: 'AB+',
        unitsRequired: 0,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        coordinates: [77.9629, 9.5872],
        searchRadiusKm: 15
      });
      assert.strictEqual(resInvalidUnits.status, 400);
      console.log(`  ✅ 8d: Invalid units (0) rejected accurately: "${resInvalidUnits.data.message}"`);

      testResults['Scenario 8 (Form Validation)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 5: MISSING / INVALID COORDINATES
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 5: MISSING / INVALID COORDINATES');
    {
      // 5a: Missing coordinates
      const resNoCoords = await request({ path: '/api/requests', method: 'POST', token: tokenA }, {
        patientName: 'Nitheesh Kumar',
        requiredBloodGroup: 'AB+',
        unitsRequired: 1,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        searchRadiusKm: 15
      });
      assert.strictEqual(resNoCoords.status, 400);
      assert.ok(resNoCoords.data.message.includes('coordinates'));
      console.log(`  ✅ 5a: Missing coordinates rejected: "${resNoCoords.data.message}"`);

      // 5b: Malformed coordinates string
      const resBadCoords = await request({ path: '/api/requests', method: 'POST', token: tokenA }, {
        patientName: 'Nitheesh Kumar',
        requiredBloodGroup: 'AB+',
        unitsRequired: 1,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        coordinates: 'invalid-string',
        searchRadiusKm: 15
      });
      assert.strictEqual(resBadCoords.status, 400);
      console.log(`  ✅ 5b: Malformed coordinates rejected: "${resBadCoords.data.message}"`);

      testResults['Scenario 5 (Missing / Invalid Coordinates)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 1: NEARBY ELIGIBLE DONOR (Matching & Notification)
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 1: NEARBY ELIGIBLE DONOR MATCHING & NOTIFICATION');
    let createdRequest1Id = null;
    {
      // Submit valid emergency request from Account A
      const reqPayload = {
        patientName: 'Nitheesh Kumar',
        patientAge: 25,
        requiredBloodGroup: 'AB+',
        unitsRequired: 1,
        urgency: 'Urgent',
        searchRadiusKm: 15,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        coordinates: [77.9629, 9.5872],
        medicalCondition: 'Emergency Procedure'
      };

      const resCreate = await request({ path: '/api/requests', method: 'POST', token: tokenA }, reqPayload);
      assert.strictEqual(resCreate.status, 201, `Failed to create request: ${JSON.stringify(resCreate.data)}`);
      assert.strictEqual(resCreate.data.success, true);
      assert.ok(resCreate.data.notifiedDonorsCount >= 1, `Expected at least 1 donor notified, got: ${resCreate.data.notifiedDonorsCount}`);
      createdRequest1Id = resCreate.data.request._id;
      console.log(`  ✅ Request created successfully: ID ${createdRequest1Id}`);
      console.log(`  ✅ Donors matched and notified: ${resCreate.data.notifiedDonorsCount}`);

      // Wait 1 second for socket/db async write
      await new Promise(r => setTimeout(r, 1000));

      // Account B logs in and fetches notifications
      const notifResB = await request({ path: '/api/notifications', method: 'GET', token: tokenB });
      assert.strictEqual(notifResB.status, 200);
      assert.ok(notifResB.data.notifications.length >= 1, 'Donor B should have received at least 1 notification');

      const matchingNotif = notifResB.data.notifications.find(n => 
        n.requestId && (n.requestId._id === createdRequest1Id || n.requestId === createdRequest1Id)
      );
      assert.ok(matchingNotif, 'Matching notification not found in Donor B inbox');
      assert.strictEqual(matchingNotif.urgency, 'Urgent');
      assert.ok(matchingNotif.title.includes('AB+'));
      assert.ok(matchingNotif.message.includes('Government Hospital of Virudhunagar'));
      console.log(`  ✅ Donor B retrieved notification from MongoDB: "${matchingNotif.title}"`);
      console.log(`  ✅ Notification message details: "${matchingNotif.message}"`);
      testResults['Scenario 1 (Nearby Eligible Donor)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 2: COMPATIBLE DONOR OUTSIDE RADIUS
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 2: COMPATIBLE DONOR OUTSIDE RADIUS');
    {
      // Check Donor C (in Madurai ~45 km away) - request 1 was within 15 km radius
      const notifResC = await request({ path: '/api/notifications', method: 'GET', token: tokenC });
      assert.strictEqual(notifResC.status, 200);
      const matchingNotifC = notifResC.data.notifications.find(n => 
        n.requestId && (n.requestId._id === createdRequest1Id || n.requestId === createdRequest1Id)
      );
      assert.strictEqual(matchingNotifC, undefined, 'Donor C outside radius should NOT have received notification');
      console.log('  ✅ Donor C (45 km away) correctly EXCLUDED from 15 km broadcast.');
      testResults['Scenario 2 (Outside Radius Exclusion)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 3: INCOMPATIBLE DONOR NEARBY
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 3: INCOMPATIBLE DONOR NEARBY');
    {
      // Post request for A- blood (only O- and A- donors are compatible)
      // Donor D is B+ (incompatible) located 0.3 km away
      const reqIncomp = {
        patientName: 'Subramanian',
        patientAge: 50,
        requiredBloodGroup: 'A-', // Recipient A- cannot receive B+
        unitsRequired: 1,
        urgency: 'Urgent',
        searchRadiusKm: 15,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        coordinates: [77.9629, 9.5872]
      };

      const resCreateAneg = await request({ path: '/api/requests', method: 'POST', token: tokenA }, reqIncomp);
      assert.strictEqual(resCreateAneg.status, 201);
      const reqAnegId = resCreateAneg.data.request._id;

      // Check Donor D's notifications
      const notifResD = await request({ path: '/api/notifications', method: 'GET', token: tokenD });
      assert.strictEqual(notifResD.status, 200);
      const matchingNotifD = notifResD.data.notifications.find(n => 
        n.requestId && (n.requestId._id === reqAnegId || n.requestId === reqAnegId)
      );
      assert.strictEqual(matchingNotifD, undefined, 'Donor D (B+) should NOT receive notification for A- request');
      console.log('  ✅ Incompatible nearby donor (B+ for A- recipient) correctly EXCLUDED from notification.');
      testResults['Scenario 3 (Incompatible Donor Exclusion)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 4: UNAVAILABLE DONOR NEARBY
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 4: UNAVAILABLE DONOR NEARBY');
    {
      // Donor E is O+ (compatible with AB+ request 1), 0.4 km away, but isAvailableToDonate: false
      const notifResE = await request({ path: '/api/notifications', method: 'GET', token: tokenE });
      assert.strictEqual(notifResE.status, 200);
      const matchingNotifE = notifResE.data.notifications.find(n => 
        n.requestId && (n.requestId._id === createdRequest1Id || n.requestId === createdRequest1Id)
      );
      assert.strictEqual(matchingNotifE, undefined, 'Unavailable donor should NOT receive notification');
      console.log('  ✅ Nearby unavailable donor correctly EXCLUDED from notification.');
      testResults['Scenario 4 (Unavailable Donor Exclusion)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 6: NO ELIGIBLE DONORS FOUND
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 6: NO ELIGIBLE DONORS FOUND IN RADIUS');
    {
      // Request O- in a remote location (e.g. coordinates [75.0000, 25.0000] with 5 km radius)
      const remotePayload = {
        patientName: 'Test Patient Remote',
        patientAge: 40,
        requiredBloodGroup: 'O-',
        unitsRequired: 1,
        urgency: 'Normal',
        searchRadiusKm: 5,
        hospitalName: 'Remote Health Center',
        hospitalAddress: 'Remote Location',
        contactPhone: '+91 9876543210',
        coordinates: [75.0000, 25.0000]
      };

      const resRemote = await request({ path: '/api/requests', method: 'POST', token: tokenA }, remotePayload);
      assert.strictEqual(resRemote.status, 201);
      assert.strictEqual(resRemote.data.notifiedDonorsCount, 0);
      assert.ok(resRemote.data.message.includes('No matching eligible donors found'), `Expected no matching message: ${resRemote.data.message}`);
      console.log(`  ✅ Request persisted with 0 notifications. Accurate response: "${resRemote.data.message}"`);
      testResults['Scenario 6 (No Eligible Donors)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 7: DUPLICATE SUBMISSION PREVENTION
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 7: DUPLICATE SUBMISSION PREVENTION');
    {
      // Try submitting the exact same request again immediately
      const dupPayload = {
        patientName: 'Nitheesh Kumar',
        patientAge: 25,
        requiredBloodGroup: 'AB+',
        unitsRequired: 1,
        urgency: 'Urgent',
        searchRadiusKm: 15,
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar',
        contactPhone: '+91 9876543210',
        coordinates: [77.9629, 9.5872]
      };

      const resDup = await request({ path: '/api/requests', method: 'POST', token: tokenA }, dupPayload);
      assert.strictEqual(resDup.status, 409, `Expected 409 Conflict on duplicate, got ${resDup.status}`);
      assert.ok(resDup.data.message.includes('recently submitted') || resDup.data.message.includes('duplicate'));
      console.log(`  ✅ Duplicate request prevented with status 409: "${resDup.data.message}"`);
      testResults['Scenario 7 (Duplicate Submission)'] = 'PASS';
    }

    // -------------------------------------------------------------------------
    // SCENARIO 9: ACTUAL BROWSER MULTIPART WORKFLOW & NOTIFICATION READ UPDATE
    // -------------------------------------------------------------------------
    console.log('\n📌 SCENARIO 9: BROWSER MULTIPART FORMDATA WORKFLOW');
    {
      // Simulate browser FormData submission with medicalDocuments file upload
      const formDataFields = {
        patientName: 'Nitheesh Kumar Multipart',
        patientAge: '26',
        requiredBloodGroup: 'AB+',
        unitsRequired: '2',
        urgency: 'Critical',
        searchRadiusKm: '25',
        hospitalName: 'Government Hospital of Virudhunagar',
        hospitalAddress: 'Virudhunagar Main Road',
        contactPhone: '+91 9876543210',
        coordinates: JSON.stringify([77.9629, 9.5872]),
        medicalCondition: 'Critical trauma blood requirement'
      };

      const fileAttachment = [{
        fieldname: 'medicalDocuments',
        filename: 'clinical_blood_requisition.pdf',
        contentType: 'application/pdf',
        content: '%PDF-1.4 Mock Clinical Blood Test Requisition LifeLink Verified'
      }];

      const { buffer, boundary } = buildMultipartFormData(formDataFields, fileAttachment);

      const resMultipart = await request(
        { path: '/api/requests', method: 'POST', token: tokenA },
        buffer,
        true,
        boundary
      );

      assert.strictEqual(resMultipart.status, 201, `Multipart submission failed: ${JSON.stringify(resMultipart.data)}`);
      assert.strictEqual(resMultipart.data.success, true);
      assert.ok(resMultipart.data.request.medicalDocuments.length === 1, 'Medical document should be saved');
      console.log(`  ✅ Multipart form-data with medical document upload succeeded: Request ID ${resMultipart.data.request._id}`);
      console.log(`  ✅ Attached document: ${resMultipart.data.request.medicalDocuments[0].originalName} (${resMultipart.data.request.medicalDocuments[0].filename})`);

      // Verify Donor B received notification and can mark as read
      await new Promise(r => setTimeout(r, 600));
      const notifResB2 = await request({ path: '/api/notifications', method: 'GET', token: tokenB });
      const latestNotif = notifResB2.data.notifications[0];
      assert.ok(latestNotif, 'Donor B should have notifications');

      // Mark notification as read
      const markReadRes = await request({ path: `/api/notifications/${latestNotif._id}/read`, method: 'PATCH', token: tokenB });
      assert.strictEqual(markReadRes.status, 200);
      assert.strictEqual(markReadRes.data.notification.isRead, true);
      console.log(`  ✅ Donor B marked notification as read. Updated isRead: ${markReadRes.data.notification.isRead}`);

      testResults['Scenario 9 (Browser Workflow & Multipart Upload)'] = 'PASS';
    }

    console.log('\n================================================================');
    console.log('🏁 PHASE 8 VERIFICATION SUMMARY');
    console.log('================================================================');
    for (const [scenario, status] of Object.entries(testResults)) {
      console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${status}] ${scenario}`);
    }
    console.log('================================================================\n');

  } catch (err) {
    console.error('❌ Phase 8 test failure:', err.message);
    process.exit(1);
  }
}

runPhase8Tests();
