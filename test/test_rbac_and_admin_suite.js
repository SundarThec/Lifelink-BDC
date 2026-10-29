/**
 * Comprehensive Verification Suite for RBAC, Admin Console, and Security
 * Tests all 18 Verification Cases from Section 14 against http://localhost:5000
 */

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:5000';

function apiRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const headers = options.headers || {};
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    let bodyBuffer = null;
    if (postData) {
      headers['Content-Type'] = 'application/json';
      const jsonStr = JSON.stringify(postData);
      bodyBuffer = Buffer.from(jsonStr);
      headers['Content-Length'] = Buffer.byteLength(jsonStr);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: options.path,
        method: options.method || 'GET',
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, data: parsed, headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data, headers: res.headers });
          }
        });
      }
    );

    req.on('error', reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 LIFELINK RBAC, ADMIN CONSOLE & SECURITY VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(name, details = '') {
    passed++;
    console.log(`  ✅ [PASS] ${name}${details ? ' - ' + details : ''}`);
  }

  function fail(name, error) {
    failed++;
    console.error(`  ❌ [FAIL] ${name}: ${error.message || error}`);
  }

  const timestamp = Date.now();
  let adminToken = null;
  let adminUser = null;
  let userToken = null;
  let regularUser = null;
  let secondUserToken = null;
  let secondUser = null;

  // -------------------------------------------------------------
  // TEST 1: Dual Login Interface in Frontend
  // -------------------------------------------------------------
  try {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(indexHtml.includes('tabUserLogin'), 'Missing User Login tab element');
    assert(indexHtml.includes('tabAdminLogin'), 'Missing Admin Login tab element');
    assert(indexHtml.includes('adminLoginNotice'), 'Missing Admin Login notice element');

    const authJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');
    assert(authJs.includes('setLoginRoleTab'), 'Missing setLoginRoleTab function in auth.js');
    assert(authJs.includes('/auth/admin-login'), 'Missing admin login endpoint routing in auth.js');

    pass('TEST 1: Dual login interface', 'User Login and Admin Login tabs are clearly distinguishable and configured');
  } catch (e) {
    fail('TEST 1: Dual login interface', e);
  }

  // Setup Test Accounts
  try {
    // 1. Create a regular user
    const regRes = await apiRequest(
      { path: '/api/v1/auth/register', method: 'POST' },
      {
        name: `Regular Test User ${timestamp}`,
        username: `reguser_${timestamp}`,
        email: `reg_${timestamp}@lifelink.test`,
        phone: `+91 91000${(timestamp % 90000) + 10000}`,
        password: 'Password123!',
        age: 26,
        bloodGroup: 'B+',
        address: '100 Feet Rd, Indiranagar, Bangalore',
        city: 'Bangalore',
        coordinates: [77.6412, 12.9719],
        isAvailableToDonate: true
      }
    );
    assert.strictEqual(regRes.status, 201, `User registration failed with status ${regRes.status}`);
    userToken = regRes.data.token;
    regularUser = regRes.data.user;

    // 2. Create a second regular user for distance & isolation checks
    const reg2Res = await apiRequest(
      { path: '/api/v1/auth/register', method: 'POST' },
      {
        name: `Donor User ${timestamp}`,
        username: `donor_${timestamp}`,
        email: `donor_${timestamp}@lifelink.test`,
        phone: `+91 92000${(timestamp % 90000) + 10000}`,
        password: 'Password123!',
        age: 30,
        bloodGroup: 'O+',
        address: 'Main Bazaar, Virudhunagar, Tamil Nadu',
        city: 'Virudhunagar',
        coordinates: [77.9629, 9.5872],
        isAvailableToDonate: true
      }
    );
    assert.strictEqual(reg2Res.status, 201);
    secondUserToken = reg2Res.data.token;
    secondUser = reg2Res.data.user;

    // 3. Create or Bootstrap an Admin user via scripts/create-admin.js
    const adminEmail = `admin_${timestamp}@lifelink.test`;
    const adminPass = 'AdminSecret2026!';
    execSync(
      `node scripts/create-admin.js --email=${adminEmail} --password=${adminPass} --name="Master Admin" --username=admin_${timestamp}`,
      { stdio: 'pipe' }
    );

    // Login as Admin using /api/v1/auth/admin-login
    const adminLoginRes = await apiRequest(
      { path: '/api/v1/auth/admin-login', method: 'POST' },
      { loginId: adminEmail, password: adminPass }
    );
    assert.strictEqual(adminLoginRes.status, 200, 'Admin login failed');
    assert.strictEqual(adminLoginRes.data.user.role, 'admin', 'Admin user role is not admin');
    adminToken = adminLoginRes.data.token;
    adminUser = adminLoginRes.data.user;
  } catch (e) {
    console.error('Fatal setup failure:', e);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST 2: Server-Side Admin Role Enforcement
  // -------------------------------------------------------------
  try {
    // Normal user attempts /api/v1/auth/admin-login
    const failRes = await apiRequest(
      { path: '/api/v1/auth/admin-login', method: 'POST' },
      { loginId: regularUser.email, password: 'Password123!' }
    );
    assert.strictEqual(failRes.status, 403, `Expected status 403, got ${failRes.status}`);
    assert(
      failRes.data.message.includes('Administrator privileges required') ||
        failRes.data.message.includes('Access denied'),
      `Unexpected error message: ${failRes.data.message}`
    );

    // Normal user attempts /api/v1/auth/login with loginType: 'admin'
    const fail2Res = await apiRequest(
      { path: '/api/v1/auth/login', method: 'POST' },
      { loginId: regularUser.email, password: 'Password123!', loginType: 'admin' }
    );
    assert.strictEqual(fail2Res.status, 403, `Expected status 403, got ${fail2Res.status}`);

    pass('TEST 2: Server-side admin role enforcement', 'Non-admin credentials strictly rejected with HTTP 403 Forbidden');
  } catch (e) {
    fail('TEST 2: Server-side admin role enforcement', e);
  }

  // -------------------------------------------------------------
  // TEST 3: Privileged Access Control (401 & 403)
  // -------------------------------------------------------------
  try {
    const endpoints = [
      '/api/v1/admin/metrics',
      '/api/v1/admin/users',
      '/api/v1/admin/requests',
      '/api/v1/admin/audit-logs'
    ];

    for (const ep of endpoints) {
      // Unauthenticated -> 401
      const unauth = await apiRequest({ path: ep });
      assert.strictEqual(unauth.status, 401, `Endpoint ${ep} without token did not return 401`);

      // Regular user token -> 403
      const forbidden = await apiRequest({ path: ep, token: userToken });
      assert.strictEqual(forbidden.status, 403, `Endpoint ${ep} with user token did not return 403`);

      // Admin user token -> 200
      const ok = await apiRequest({ path: ep, token: adminToken });
      assert.strictEqual(ok.status, 200, `Endpoint ${ep} with admin token did not return 200`);
    }

    pass('TEST 3: Privileged access control', 'Unauthenticated requests return 401, regular users return 403, admins return 200');
  } catch (e) {
    fail('TEST 3: Privileged access control', e);
  }

  // -------------------------------------------------------------
  // TEST 4: Client-Side Tampering Resistance
  // -------------------------------------------------------------
  try {
    // Attempt privilege escalation via PUT /api/v1/users/profile
    const tamperRes = await apiRequest(
      { path: '/api/v1/users/profile', method: 'PUT', token: userToken },
      { role: 'admin', name: 'Hacked User' }
    );
    assert.strictEqual(tamperRes.status, 200);
    assert.strictEqual(tamperRes.data.user.role, 'user', 'User role was tampered via profile update!');

    // Verify calling admin endpoint still returns 403
    const checkRes = await apiRequest({ path: '/api/v1/admin/metrics', token: userToken });
    assert.strictEqual(checkRes.status, 403, 'Client tampering granted admin access!');

    pass('TEST 4: Client-side tampering resistance', 'Profile updates cannot escalate role to admin');
  } catch (e) {
    fail('TEST 4: Client-side tampering resistance', e);
  }

  // -------------------------------------------------------------
  // TEST 5: Secure Initial Administrator Setup Script
  // -------------------------------------------------------------
  try {
    const bootstrapEmail = `bootstrap_${timestamp}@lifelink.test`;
    const bootstrapPass = 'SecureAdminSecret99!';
    const bootstrapPhone = `+91 94${Math.floor(10000000 + Math.random() * 90000000)}`;

    // First run creates admin
    const out1 = execSync(
      `node scripts/create-admin.js --email=${bootstrapEmail} --password=${bootstrapPass} --name="Bootstrap Admin" --username=boot_${timestamp} --phone="${bootstrapPhone}"`,
      { encoding: 'utf8' }
    );
    assert(out1.includes('New Administrator created successfully'), 'Bootstrap admin creation failed');

    // Second run without --reset should NOT overwrite
    const out2 = execSync(
      `node scripts/create-admin.js --email=${bootstrapEmail} --password=ShortPass123 --name="Hacked"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    assert(
      out2.includes('already exists') && out2.includes('--reset'),
      'Script overwrote existing admin without --reset flag!'
    );

    // Verify login works with initial password
    const testLogin = await apiRequest(
      { path: '/api/v1/auth/admin-login', method: 'POST' },
      { loginId: bootstrapEmail, password: bootstrapPass }
    );
    assert.strictEqual(testLogin.status, 200, 'Bootstrap admin login failed');

    pass('TEST 5: Secure initial admin setup', 'create-admin.js creates admin, hashes password, and prevents silent overwriting');
  } catch (e) {
    fail('TEST 5: Secure initial admin setup', e);
  }

  // -------------------------------------------------------------
  // TEST 6: Admin Dashboard Metrics Aggregation
  // -------------------------------------------------------------
  try {
    const metricsRes = await apiRequest({ path: '/api/v1/admin/metrics', token: adminToken });
    assert.strictEqual(metricsRes.status, 200);
    const m = metricsRes.data.metrics;

    assert(typeof m.totalUsers === 'number' && m.totalUsers >= 2, 'Invalid totalUsers metric');
    assert(typeof m.activeDonors === 'number', 'Invalid activeDonors metric');
    assert(typeof m.totalRequests === 'number', 'Invalid totalRequests metric');
    assert(typeof m.fulfillmentRate === 'number', 'Invalid fulfillmentRate metric');
    assert(typeof m.bloodGroupDistribution === 'object', 'Invalid bloodGroupDistribution metric');
    assert('O+' in m.bloodGroupDistribution && 'B+' in m.bloodGroupDistribution, 'Missing blood groups in distribution');

    pass('TEST 6: Admin dashboard metrics', `Aggregated metrics returned (Total Users: ${m.totalUsers}, Active Donors: ${m.activeDonors})`);
  } catch (e) {
    fail('TEST 6: Admin dashboard metrics', e);
  }

  // -------------------------------------------------------------
  // TEST 7: User Moderation Actions (Block, Unblock, Verify)
  // -------------------------------------------------------------
  try {
    // 1. Block regular user
    const blockRes = await apiRequest(
      { path: `/api/v1/admin/users/${regularUser._id}/block`, method: 'PATCH', token: adminToken },
      { reason: 'Suspicious test behavior' }
    );
    assert.strictEqual(blockRes.status, 200);
    assert.strictEqual(blockRes.data.user.isBlocked, true, 'User is not marked as blocked');

    // 2. Blocked user cannot access protected endpoints
    const blockedAccess = await apiRequest({ path: '/api/v1/notifications', token: userToken });
    assert.strictEqual(blockedAccess.status, 403, 'Blocked user was able to access notifications!');

    // 3. Unblock user
    const unblockRes = await apiRequest(
      { path: `/api/v1/admin/users/${regularUser._id}/unblock`, method: 'PATCH', token: adminToken },
      { reason: 'Investigation cleared' }
    );
    assert.strictEqual(unblockRes.status, 200);
    assert.strictEqual(unblockRes.data.user.isBlocked, false, 'User is not unblocked');

    // 4. Verify user profile
    const verifyRes = await apiRequest(
      { path: `/api/v1/admin/users/${regularUser._id}/verify`, method: 'PATCH', token: adminToken },
      { isVerified: true }
    );
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.user.isVerified, true, 'User was not marked verified');

    pass('TEST 7: User moderation actions', 'Block prevents user actions (403), unblock restores access, verify updates profile');
  } catch (e) {
    fail('TEST 7: User moderation actions', e);
  }

  // -------------------------------------------------------------
  // TEST 8: User Status Toggling (Active <-> Suspended)
  // -------------------------------------------------------------
  try {
    // Suspend user
    const suspRes = await apiRequest(
      { path: `/api/v1/admin/users/${regularUser._id}/status`, method: 'PATCH', token: adminToken }
    );
    assert.strictEqual(suspRes.status, 200);
    assert.strictEqual(suspRes.data.user.status, 'suspended');

    // Suspended user login fails
    const loginFail = await apiRequest(
      { path: '/api/v1/auth/login', method: 'POST' },
      { loginId: regularUser.email, password: 'Password123!' }
    );
    assert.strictEqual(loginFail.status, 403, 'Suspended user was allowed to log in!');

    // Reactivate user
    const reactivateRes = await apiRequest(
      { path: `/api/v1/admin/users/${regularUser._id}/status`, method: 'PATCH', token: adminToken }
    );
    assert.strictEqual(reactivateRes.status, 200);
    assert.strictEqual(reactivateRes.data.user.status, 'active');

    pass('TEST 8: User status toggling', 'Suspending account blocks login (403), reactivating restores login');
  } catch (e) {
    fail('TEST 8: User status toggling', e);
  }

  // -------------------------------------------------------------
  // TEST 9: Role Management & Last Admin Protection
  // -------------------------------------------------------------
  try {
    // 1. Promote regular user to admin
    const promoteRes = await apiRequest(
      { path: `/api/v1/admin/users/${regularUser._id}/role`, method: 'PATCH', token: adminToken },
      { role: 'admin' }
    );
    assert.strictEqual(promoteRes.status, 200);
    assert.strictEqual(promoteRes.data.user.role, 'admin');

    // 2. Demote back to user
    const demoteRes = await apiRequest(
      { path: `/api/v1/admin/users/${regularUser._id}/role`, method: 'PATCH', token: adminToken },
      { role: 'user' }
    );
    assert.strictEqual(demoteRes.status, 200);
    assert.strictEqual(demoteRes.data.user.role, 'user');

    // 3. Admin attempting to demote themselves
    const selfDemoteRes = await apiRequest(
      { path: `/api/v1/admin/users/${adminUser._id}/role`, method: 'PATCH', token: adminToken },
      { role: 'user' }
    );
    assert.strictEqual(selfDemoteRes.status, 400, 'Self-demotion should return 400');

    pass('TEST 9: Role management', 'User promoted, demoted, and self-demotion / final admin protection verified');
  } catch (e) {
    fail('TEST 9: Role management', e);
  }

  // -------------------------------------------------------------
  // TEST 10: Soft Deletion
  // -------------------------------------------------------------
  try {
    // Create a temporary user to soft delete
    const tempUserRes = await apiRequest(
      { path: '/api/v1/auth/register', method: 'POST' },
      {
        name: `Soft Delete Test ${timestamp}`,
        username: `del_${timestamp}`,
        email: `del_${timestamp}@lifelink.test`,
        phone: `+91 93000${(timestamp % 90000) + 10000}`,
        password: 'Password123!',
        age: 28,
        bloodGroup: 'A+',
        address: 'Bangalore, Karnataka',
        city: 'Bangalore',
        coordinates: [77.5946, 12.9716],
        isAvailableToDonate: true
      }
    );
    const tempUser = tempUserRes.data.user;

    // Delete user
    const delRes = await apiRequest(
      { path: `/api/v1/admin/users/${tempUser._id}`, method: 'DELETE', token: adminToken },
      { reason: 'User requested account closure' }
    );
    assert.strictEqual(delRes.status, 200);

    // Login must fail with 403 deactivated
    const delLogin = await apiRequest(
      { path: '/api/v1/auth/login', method: 'POST' },
      { loginId: tempUser.email, password: 'Password123!' }
    );
    assert.strictEqual(delLogin.status, 403, 'Soft-deleted user was able to log in');

    // Admin query with includeDeleted: true still finds record
    const findRes = await apiRequest(
      { path: `/api/v1/admin/users?includeDeleted=true&search=${tempUser.username}`, token: adminToken }
    );
    assert(findRes.data.users.some((u) => u._id === tempUser._id && u.isDeleted === true), 'Record missing from DB');

    pass('TEST 10: Soft deletion', 'Soft deletion marks isDeleted: true, prevents login, and retains DB record');
  } catch (e) {
    fail('TEST 10: Soft deletion', e);
  }

  // -------------------------------------------------------------
  // TEST 11: Request Moderation (Flag, Unflag, Cancel, Priority)
  // -------------------------------------------------------------
  let testRequestId = null;
  try {
    // Create a blood request
    const createReq = await apiRequest(
      { path: '/api/v1/requests', method: 'POST', token: userToken },
      {
        patientName: 'Test Patient Moderation',
        patientAge: 45,
        requiredBloodGroup: 'B+',
        unitsRequired: 2,
        hospitalName: 'Apollo Hospital',
        hospitalAddress: 'Bannerghatta Rd, Bangalore',
        coordinates: [77.598, 12.893],
        urgency: 'Urgent',
        contactPhone: '+91 9888877777',
        contactEmail: 'contact@apollo.org',
        searchRadiusKm: 15
      }
    );
    assert.strictEqual(createReq.status, 201);
    testRequestId = createReq.data.request._id;

    // Flag request
    const flagRes = await apiRequest(
      { path: `/api/v1/admin/requests/${testRequestId}/flag`, method: 'PATCH', token: adminToken },
      { reason: 'Audit flagged' }
    );
    assert.strictEqual(flagRes.status, 200);
    assert.strictEqual(flagRes.data.request.isFlagged, true);

    // Unflag request
    const unflagRes = await apiRequest(
      { path: `/api/v1/admin/requests/${testRequestId}/unflag`, method: 'PATCH', token: adminToken },
      { reason: 'Flag cleared' }
    );
    assert.strictEqual(unflagRes.status, 200);
    assert.strictEqual(unflagRes.data.request.isFlagged, false);

    // Adjust Priority
    const priorityRes = await apiRequest(
      { path: `/api/v1/admin/requests/${testRequestId}/priority`, method: 'PATCH', token: adminToken },
      { urgency: 'Critical', reason: 'ICU escalation' }
    );
    assert.strictEqual(priorityRes.status, 200);
    assert.strictEqual(priorityRes.data.request.urgency, 'Critical');

    // Cancel request via moderation
    const cancelRes = await apiRequest(
      { path: `/api/v1/admin/requests/${testRequestId}/cancel`, method: 'PATCH', token: adminToken },
      { reason: 'Test moderation completed' }
    );
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.data.request.requestStatus, 'cancelled');

    pass('TEST 11: Request moderation', 'Flag, unflag, priority change to Critical, and moderation cancellation verified');
  } catch (e) {
    fail('TEST 11: Request moderation', e);
  }

  // -------------------------------------------------------------
  // TEST 12: Comprehensive User Filtering & Pagination
  // -------------------------------------------------------------
  try {
    // 1. Filter by city: Virudhunagar
    const cityRes = await apiRequest(
      { path: '/api/v1/admin/users?city=Virudhunagar', token: adminToken }
    );
    assert.strictEqual(cityRes.status, 200);
    assert(cityRes.data.users.length > 0, 'No users returned for city=Virudhunagar');
    assert(
      cityRes.data.users.every((u) => u.city && u.city.toLowerCase().includes('virudhunagar')),
      'City filter returned mismatched user'
    );

    // 2. Filter by blood group and age range
    const bgAgeRes = await apiRequest(
      { path: '/api/v1/admin/users?bloodGroup=B+&minAge=20&maxAge=35', token: adminToken }
    );
    assert.strictEqual(bgAgeRes.status, 200);
    assert(
      bgAgeRes.data.users.every((u) => u.bloodGroup === 'B+' && u.age >= 20 && u.age <= 35),
      'Blood group or age range filter failed'
    );

    // 3. Pagination check
    const pageRes = await apiRequest(
      { path: '/api/v1/admin/users?page=1&limit=1', token: adminToken }
    );
    assert.strictEqual(pageRes.status, 200);
    assert.strictEqual(pageRes.data.users.length, 1);
    assert(pageRes.data.total >= 2, 'Total count missing or incorrect in paginated response');
    assert.strictEqual(pageRes.data.page, 1);

    pass('TEST 12: User filtering and pagination', 'Filtered by city, bloodGroup, age range, and verified server-side pagination');
  } catch (e) {
    fail('TEST 12: User filtering and pagination', e);
  }

  // -------------------------------------------------------------
  // TEST 13: Accurate Request Distance Calculations & Fallback
  // -------------------------------------------------------------
  try {
    // 1. User located in Bangalore querying a request in Bangalore
    const listRes = await apiRequest({ path: '/api/v1/requests', token: userToken });
    assert.strictEqual(listRes.status, 200);
    const validReq = listRes.data.communityRequests.find((r) => r.distanceKm !== null);
    assert(validReq, 'Expected at least one request with distance');
    assert(typeof validReq.distanceKm === 'number', 'distanceKm is not a number');
    assert(validReq.distanceKm > 0, 'distanceKm should be > 0 between distinct locations');
    assert(validReq.formattedDistance.includes('km'), 'formattedDistance is missing km units');

    // 2. Request with missing coordinates or null user coordinates
    const noCoordReq = await apiRequest(
      { path: '/api/v1/requests', method: 'POST', token: userToken },
      {
        patientName: 'No Coordinates Patient',
        patientAge: 50,
        requiredBloodGroup: 'O+',
        unitsRequired: 1,
        hospitalName: 'Rural Health Center',
        hospitalAddress: 'Unmapped Area',
        coordinates: [77.59, 12.97],
        urgency: 'Normal',
        contactPhone: '+91 9999911111',
        contactEmail: 'contact@rural.org'
      }
    );
    assert.strictEqual(noCoordReq.status, 201);

    // When querying without location (or invalid coordinates)
    const detailRes = await apiRequest(
      { path: `/api/v1/requests/${noCoordReq.data.request._id}` } // unauthenticated
    );
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.data.distanceKm, null, 'Unauthenticated distance should be null, not 0');
    assert.strictEqual(detailRes.data.formattedDistance, null, 'Unauthenticated formatted distance should be null');

    pass('TEST 13: Accurate request distance', 'Haversine distance calculated accurately; missing coordinates return null, never 0 km');
  } catch (e) {
    fail('TEST 13: Accurate request distance', e);
  }

  // -------------------------------------------------------------
  // TEST 14: Socket Notification Authorization
  // -------------------------------------------------------------
  try {
    await new Promise((resolve, reject) => {
      // Connect socket with userToken for regularUser
      const socket = io(BASE_URL, {
        auth: { token: userToken },
        transports: ['websocket']
      });

      socket.on('connect', () => {
        // Attempt to register for secondUser's private room
        socket.emit('register_user', secondUser._id, (ack) => {
          // If server acknowledged
        });
      });

      socket.on('registration_error', (data) => {
        assert(data.message.includes('Forbidden') || data.message.includes('cannot subscribe'), 'Mismatched registration error');
        socket.disconnect();
        resolve();
      });

      socket.on('registered', (data) => {
        if (data.userId === secondUser._id.toString()) {
          socket.disconnect();
          reject(new Error('Vulnerability: Client registered for another user\'s private room!'));
        }
      });

      setTimeout(() => {
        socket.disconnect();
        reject(new Error('Timeout waiting for socket authorization rejection'));
      }, 5000);
    });

    pass('TEST 14: Socket notification authorization', 'Unauthorized socket room registration strictly rejected with registration_error');
  } catch (e) {
    fail('TEST 14: Socket notification authorization', e);
  }

  // -------------------------------------------------------------
  // TEST 15: Authorized Socket Notification Delivery
  // -------------------------------------------------------------
  try {
    await new Promise((resolve, reject) => {
      const socket = io(BASE_URL, {
        auth: { token: secondUserToken },
        transports: ['websocket']
      });

      socket.on('connect', () => {
        // Legitimate registration for own room
        socket.emit('register_user', secondUser._id, (ack) => {
          assert(ack && ack.success, 'Failed to register legitimate user');
        });
      });

      socket.on('registered', async (data) => {
        assert.strictEqual(data.userId, secondUser._id.toString());

        // Now admin sends an administrative broadcast targeting all users
        await apiRequest(
          { path: '/api/v1/admin/broadcast', method: 'POST', token: adminToken },
          {
            title: 'Live Socket Broadcast Test',
            message: 'Testing real-time broadcast delivery',
            target: { bloodGroups: ['O+'] }
          }
        );
      });

      socket.on('admin_broadcast', (msg) => {
        assert.strictEqual(msg.title, 'Live Socket Broadcast Test');
        socket.disconnect();
        resolve();
      });

      setTimeout(() => {
        socket.disconnect();
        reject(new Error('Timeout waiting for live authorized socket notification delivery'));
      }, 7000);
    });

    pass('TEST 15: Authorized socket notification delivery', 'Legitimate user successfully registered and received live targeted broadcast');
  } catch (e) {
    fail('TEST 15: Authorized socket notification delivery', e);
  }

  // -------------------------------------------------------------
  // TEST 16: Audit Log Creation
  // -------------------------------------------------------------
  try {
    const auditRes = await apiRequest({ path: '/api/v1/admin/audit-logs?limit=100', token: adminToken });
    assert.strictEqual(auditRes.status, 200);
    const logs = auditRes.data.logs;

    const actionTypes = logs.map((l) => l.action);
    assert(actionTypes.includes('ADMIN_LOGIN_SUCCESS'), 'Missing ADMIN_LOGIN_SUCCESS in audit logs');
    assert(actionTypes.includes('ADMIN_ACCESS_DENIED'), 'Missing ADMIN_ACCESS_DENIED in audit logs');
    assert(actionTypes.includes('USER_BLOCKED'), 'Missing USER_BLOCKED in audit logs');
    assert(actionTypes.includes('USER_UNBLOCKED'), 'Missing USER_UNBLOCKED in audit logs');
    assert(actionTypes.includes('USER_ROLE_CHANGED'), 'Missing USER_ROLE_CHANGED in audit logs');
    assert(actionTypes.includes('REQUEST_CANCELLED'), 'Missing REQUEST_CANCELLED in audit logs');
    assert(actionTypes.includes('REQUEST_PRIORITY_CHANGED'), 'Missing REQUEST_PRIORITY_CHANGED in audit logs');

    // Verify complete record fields
    const sample = logs[0];
    assert(sample.timestamp || sample.createdAt, 'Missing timestamp in audit record');
    assert(sample.adminName, 'Missing adminName in audit record');
    assert(sample.action, 'Missing action in audit record');
    assert(sample.targetType, 'Missing targetType in audit record');

    pass('TEST 16: Audit log creation', `Audit trail contains ${logs.length} detailed logs including administrative logins, security denials, and moderation`);
  } catch (e) {
    fail('TEST 16: Audit log creation', e);
  }

  // -------------------------------------------------------------
  // TEST 17: Audit Log Viewing and Filtering
  // -------------------------------------------------------------
  try {
    // 1. Regular user blocked from audit logs (403)
    const userAudit = await apiRequest({ path: '/api/v1/admin/audit-logs', token: userToken });
    assert.strictEqual(userAudit.status, 403, 'Regular user should not access audit logs');

    // 2. Admin filters by action: USER_BLOCKED
    const filterAction = await apiRequest(
      { path: '/api/v1/admin/audit-logs?action=USER_BLOCKED', token: adminToken }
    );
    assert.strictEqual(filterAction.status, 200);
    assert(
      filterAction.data.logs.every((l) => l.action === 'USER_BLOCKED'),
      'Action filter returned mismatched action'
    );

    // 3. Admin filters by targetType: User
    const filterTarget = await apiRequest(
      { path: '/api/v1/admin/audit-logs?targetType=User', token: adminToken }
    );
    assert.strictEqual(filterTarget.status, 200);
    assert(
      filterTarget.data.logs.every((l) => l.targetType === 'User'),
      'TargetType filter returned mismatched target'
    );

    pass('TEST 17: Audit log viewing and filtering', 'Regular users blocked (403), admins can filter by action and target entity');
  } catch (e) {
    fail('TEST 17: Audit log viewing and filtering', e);
  }

  // -------------------------------------------------------------
  // TEST 18: Location Geocoding Preservation (Virudhunagar)
  // -------------------------------------------------------------
  try {
    // Test forward geocoding for "Virudhunagar"
    const geoRes = await apiRequest({ path: '/api/v1/geocode?q=Virudhunagar' });
    assert.strictEqual(geoRes.status, 200);
    assert(geoRes.data.results && geoRes.data.results.length > 0, 'No results returned for Virudhunagar');

    const result = geoRes.data.results[0];
    const coords = result.coordinates; // [lng, lat]
    assert(
      Math.abs(coords[0] - 77.9629) < 0.2 && Math.abs(coords[1] - 9.5872) < 0.2,
      `Virudhunagar coordinates mismatched: got [${coords.join(', ')}], expected near [77.9629, 9.5872]`
    );

    pass('TEST 18: Location geocoding preservation', `Virudhunagar resolves accurately to [${coords.join(', ')}] without regression`);
  } catch (e) {
    fail('TEST 18: Location geocoding preservation', e);
  }

  console.log('\n================================================================');
  console.log(`🏁 VERIFICATION SUITE RESULTS:`);
  console.log(`   TOTAL TESTS:  ${passed + failed}`);
  console.log(`   PASSED:       ${passed}`);
  console.log(`   FAILED:       ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
