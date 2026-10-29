require('dotenv').config();
const http = require('http');
const assert = require('assert');
const { connectDB, disconnectDB } = require('../server/config/db');
const User = require('../server/models/User');

// Express app setup from server.js
const express = require('express');
const cors = require('cors');
const authRoutes = require('../server/routes/authRoutes');
const adminRoutes = require('../server/routes/adminRoutes');
const errorHandler = require('../server/middleware/errorHandler');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use(errorHandler);

function request(server, options, postData) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const opt = {
      hostname: '127.0.0.1',
      port: address.port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(opt, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, text: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runHttpTests() {
  console.log('=== HTTP & API ENDPOINT VERIFICATION ===\n');
  await connectDB();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Server listening on port ${port} for integration tests\n`);

  try {
    const adminPassword = process.env.VERIFY_ADMIN_PASSWORD || 'Sundar@2007';

    // 1. Admin login via /api/auth/admin-login
    console.log('1. Testing POST /api/auth/admin-login with Sundar credentials...');
    const adminLoginRes = await request(server, { path: '/api/auth/admin-login', method: 'POST' }, {
      loginId: 'sundaramuthu07@gmail.com',
      password: adminPassword
    });

    assert.strictEqual(adminLoginRes.status, 200, `Expected 200 OK, got ${adminLoginRes.status}`);
    assert(adminLoginRes.body.token, 'Token must be returned');
    assert.strictEqual(adminLoginRes.body.user.role, 'admin', 'User role must be admin');
    assert.strictEqual(adminLoginRes.body.user.email, 'sundaramuthu07@gmail.com');
    assert.strictEqual(adminLoginRes.body.user.password, undefined, 'Password must not be in response body');
    const adminToken = adminLoginRes.body.token;
    console.log('   ✅ Admin login successful! Token received. Role = "admin".');

    // 2. Admin login via standard POST /api/auth/login
    console.log('2. Testing POST /api/auth/login (standard login) with Sundar credentials...');
    const standardLoginRes = await request(server, { path: '/api/auth/login', method: 'POST' }, {
      loginId: 'sundaramuthu07@gmail.com',
      password: adminPassword
    });
    assert.strictEqual(standardLoginRes.status, 200, `Expected 200 OK, got ${standardLoginRes.status}`);
    assert.strictEqual(standardLoginRes.body.user.role, 'admin', 'User role must be admin');
    console.log('   ✅ Standard login successful! Role = "admin".');

    // 3. Admin login with invalid password rejected
    console.log('3. Testing POST /api/auth/admin-login with incorrect password...');
    const badPassRes = await request(server, { path: '/api/auth/admin-login', method: 'POST' }, {
      loginId: 'sundaramuthu07@gmail.com',
      password: 'WrongPasswordXYZ'
    });
    assert.strictEqual(badPassRes.status, 401, `Expected 401 Unauthorized, got ${badPassRes.status}`);
    console.log('   ✅ Rejected invalid password with 401 Unauthorized.');

    // 4. Ordinary user attempting admin login rejected
    console.log('4. Testing POST /api/auth/admin-login with ordinary user credentials...');
    // Create/find normal user
    const normalUser = await User.findOne({ role: 'user' });
    const normalPassRes = await request(server, { path: '/api/auth/admin-login', method: 'POST' }, {
      loginId: normalUser.email,
      password: 'somePassword'
    });
    // Even if password was wrong or right, non-admin is rejected (401 or 403)
    assert([401, 403].includes(normalPassRes.status), `Expected 401 or 403, got ${normalPassRes.status}`);
    console.log(`   ✅ Non-admin login to admin portal correctly denied (${normalPassRes.status}).`);

    // 5. Accessing Admin Metrics with Admin Token
    console.log('5. Testing GET /api/admin/metrics with Admin Token...');
    const metricsRes = await request(server, {
      path: '/api/admin/metrics',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(metricsRes.status, 200, `Expected 200 OK, got ${metricsRes.status}`);
    assert(metricsRes.body.metrics, 'Metrics object must be returned');
    assert(typeof metricsRes.body.metrics.totalUsers === 'number', 'totalUsers must be a number');
    console.log(`   ✅ Admin metrics accessed: totalUsers=${metricsRes.body.metrics.totalUsers}, activeDonors=${metricsRes.body.metrics.activeDonors}`);

    // 6. Accessing Admin User List with Admin Token
    console.log('6. Testing GET /api/admin/users with Admin Token...');
    const usersRes = await request(server, {
      path: '/api/admin/users?limit=5',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(usersRes.status, 200, `Expected 200 OK, got ${usersRes.status}`);
    assert(Array.isArray(usersRes.body.users), 'users array must be returned');
    console.log(`   ✅ Admin users list retrieved: ${usersRes.body.users.length} users in response.`);

    // 7. Accessing Admin Requests with Admin Token
    console.log('7. Testing GET /api/admin/requests with Admin Token...');
    const requestsRes = await request(server, {
      path: '/api/admin/requests',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(requestsRes.status, 200, `Expected 200 OK, got ${requestsRes.status}`);
    console.log(`   ✅ Admin requests list retrieved: ${requestsRes.body.requests.length} requests on record.`);

    // 8. Accessing Admin Complaints with Admin Token
    console.log('8. Testing GET /api/admin/complaints with Admin Token...');
    const complaintsRes = await request(server, {
      path: '/api/admin/complaints',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(complaintsRes.status, 200, `Expected 200 OK, got ${complaintsRes.status}`);
    console.log(`   ✅ Admin complaints endpoint accessed successfully.`);

    // 9. Accessing Admin Audit Logs with Admin Token
    console.log('9. Testing GET /api/admin/audit-logs with Admin Token...');
    const auditRes = await request(server, {
      path: '/api/admin/audit-logs',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(auditRes.status, 200, `Expected 200 OK, got ${auditRes.status}`);
    console.log(`   ✅ Admin audit logs retrieved: ${auditRes.body.logs.length} log entries recorded.`);

    // 10. Non-Admin user attempting to access /api/admin/metrics (RBAC rejection)
    console.log('10. Testing GET /api/admin/metrics with Ordinary User Token (expect 403)...');
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_super_secure_jwt_production_secret_key_2026_blood_community';
    const ordinaryToken = jwt.sign({ id: normalUser._id, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

    const ordinaryMetricsRes = await request(server, {
      path: '/api/admin/metrics',
      method: 'GET',
      headers: { Authorization: `Bearer ${ordinaryToken}` }
    });
    assert.strictEqual(ordinaryMetricsRes.status, 403, `Expected 403 Forbidden, got ${ordinaryMetricsRes.status}`);
    console.log(`   ✅ Server-side RBAC enforced: ordinary user rejected with 403 Forbidden.`);

    // 11. Unauthenticated request to /api/admin/metrics (expect 401)
    console.log('11. Testing GET /api/admin/metrics without Token (expect 401)...');
    const anonMetricsRes = await request(server, {
      path: '/api/admin/metrics',
      method: 'GET'
    });
    assert.strictEqual(anonMetricsRes.status, 401, `Expected 401 Unauthorized, got ${anonMetricsRes.status}`);
    console.log(`   ✅ Unauthenticated request rejected with 401 Unauthorized.`);

    console.log('\n🎉 ALL HTTP ENDPOINTS & RBAC PROTECTIONS VERIFIED SUCCESSFULLY!');
  } finally {
    server.close();
    await disconnectDB();
  }
}

runHttpTests().catch((err) => {
  console.error('❌ HTTP Verification failed:', err);
  process.exit(1);
});
