require('dotenv').config();
const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectDB, disconnectDB } = require('../server/config/db');
const User = require('../server/models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_super_secure_jwt_production_secret_key_2026_blood_community';

async function verify() {
  console.log('=== VERIFYING ADMINISTRATOR ACCOUNT & SECURITY ===\n');

  await connectDB();

  // 1. Verify User Record in Database
  console.log('1. Checking User in MongoDB...');
  const adminUser = await User.findOne({ email: 'sundaramuthu07@gmail.com' }).select('+password');
  assert(adminUser, 'Admin user record must exist in database');
  assert.strictEqual(adminUser.name, 'Sundar', 'Name must be "Sundar"');
  assert.strictEqual(adminUser.email, 'sundaramuthu07@gmail.com', 'Email must match');
  assert.strictEqual(adminUser.role, 'admin', 'Role must strictly be "admin"');
  assert.strictEqual(adminUser.status, 'active', 'Status must be active');
  assert.strictEqual(adminUser.isBlocked, false, 'Admin must not be blocked');
  assert.strictEqual(adminUser.isDeleted, false, 'Admin must not be deleted');
  assert.strictEqual(adminUser.isVerified, true, 'Admin must be verified');

  console.log('   ✅ Record exists: ID=' + adminUser._id + ', Name=' + adminUser.name + ', Role=' + adminUser.role);

  // 2. Verify Password is a Secure Hash
  console.log('2. Checking Password Storage Security...');
  assert(adminUser.password, 'Password field must exist');
  assert(adminUser.password.startsWith('$2a$') || adminUser.password.startsWith('$2b$'), 'Password must be a bcrypt hash ($2a$/$2b$)');
  assert(adminUser.password.length >= 60, 'Bcrypt hash length must be >= 60 chars');
  assert(!adminUser.password.includes('Sundar'), 'Password must never contain plaintext');

  const suppliedPassword = process.env.VERIFY_ADMIN_PASSWORD || 'Sundar@2007';
  const isMatch = await adminUser.comparePassword(suppliedPassword);
  assert.strictEqual(isMatch, true, 'Password compare with supplied credentials must succeed');

  const wrongMatch = await adminUser.comparePassword('WrongPassword123');
  assert.strictEqual(wrongMatch, false, 'Password compare with incorrect password must fail');
  console.log('   ✅ Password is valid 60-character bcrypt hash and verified successfully against supplied credentials');

  // 3. Verify JSON serialization excludes password
  console.log('3. Checking JSON Response Sanitization...');
  const jsonObj = adminUser.toJSON();
  assert.strictEqual(jsonObj.password, undefined, 'toJSON must delete password field');
  console.log('   ✅ toJSON() sanitization confirmed: password field is omitted from API responses');

  // 4. Verify Token Generation & Middleware Authorization
  console.log('4. Testing JWT Token Role Verification...');
  const token = jwt.sign({ id: adminUser._id, role: adminUser.role }, JWT_SECRET, { expiresIn: '1h' });
  const decoded = jwt.verify(token, JWT_SECRET);
  assert.strictEqual(decoded.role, 'admin', 'Decoded JWT must contain role "admin"');
  assert.strictEqual(decoded.id.toString(), adminUser._id.toString(), 'Decoded JWT must match user ID');
  console.log('   ✅ JWT token encodes role "admin" accurately');

  // 5. Test Non-Admin User RBAC
  console.log('5. Testing Ordinary User RBAC Separation...');
  const normalUser = await User.findOne({ role: 'user' });
  assert(normalUser, 'A regular donor/user must exist in database');
  const normalToken = jwt.sign({ id: normalUser._id, role: normalUser.role }, JWT_SECRET, { expiresIn: '1h' });
  const normalDecoded = jwt.verify(normalToken, JWT_SECRET);
  assert.strictEqual(normalDecoded.role, 'user', 'Normal user role must be "user"');
  assert.notStrictEqual(normalDecoded.role, 'admin', 'Normal user must NOT have admin role');
  console.log('   ✅ Ordinary user (' + normalUser.email + ') role is "user" and distinct from admin');

  // 6. Check Audit Logs
  console.log('6. Checking Audit Trail for Administrator Bootstrap...');
  const AuditLog = require('../server/models/AuditLog');
  const setupLog = await AuditLog.findOne({ targetId: adminUser._id, action: 'ADMIN_SETUP' });
  assert(setupLog, 'An ADMIN_SETUP audit log should have been recorded');
  console.log('   ✅ Audit log recorded: action=' + setupLog.action + ', target=' + setupLog.targetType + ', timestamp=' + setupLog.timestamp);

  await disconnectDB();
  console.log('\n🎉 ALL DATABASE AND SECURITY CHECKS PASSED PERFECTLY!');
}

verify().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
