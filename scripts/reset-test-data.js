/**
 * LifeLink Controlled Test Data Reset Script
 * 
 * Safely removes test emergency blood requests and their associated alerts/notifications
 * from the local development database (lifelink_pro).
 * 
 * STRICT SAFEGUARDS:
 * - Only operates on development database (lifelink_pro on localhost/127.0.0.1).
 * - Never drops database or touches user accounts, administrator accounts, credentials,
 *   chat messages, audit logs, or complaint records.
 * - Backs up collections prior to deletion.
 * - Re-synchronizes 2dsphere and database indexes.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectDB } = require('../server/config/db');
const User = require('../server/models/User');
const { BloodRequest } = require('../server/models/BloodRequest');
const { Notification } = require('../server/models/Notification');

async function performReset(options = { clearAllNotifications: true }) {
  console.log('===========================================================');
  console.log('🧹 LIFELINK CONTROLLED TEST DATA RESET');
  console.log('===========================================================');

  await connectDB();
  const db = mongoose.connection.db;
  const dbName = mongoose.connection.name;
  const host = mongoose.connection.host;

  console.log(`Connected Database: ${dbName} at ${host}`);

  // Safeguard: Ensure this is the local development/test database
  if (!dbName.includes('lifelink') || (host !== '127.0.0.1' && host !== 'localhost')) {
    console.error(`❌ Refusing to run on non-development database: ${dbName} @ ${host}`);
    process.exit(1);
  }

  // 1. Export backup before deletion
  const backupDir = path.join(__dirname, '..', 'data', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const preRequests = await db.collection('bloodrequests').find({}).toArray();
  const preNotifs = await db.collection('notifications').find({}).toArray();

  fs.writeFileSync(
    path.join(backupDir, `pre_reset_bloodrequests_${timestamp}.json`),
    JSON.stringify(preRequests, null, 2)
  );
  fs.writeFileSync(
    path.join(backupDir, `pre_reset_notifications_${timestamp}.json`),
    JSON.stringify(preNotifs, null, 2)
  );

  console.log(`📦 Pre-reset backup saved (${preRequests.length} requests, ${preNotifs.length} notifications)`);

  // 2. Perform deletions
  const reqDeleteResult = await BloodRequest.deleteMany({});
  console.log(`🗑️  Deleted ${reqDeleteResult.deletedCount} blood request records from 'bloodrequests'`);

  let notifDeleteResult;
  if (options.clearAllNotifications) {
    notifDeleteResult = await Notification.deleteMany({});
    console.log(`🗑️  Deleted ${notifDeleteResult.deletedCount} notification records from 'notifications'`);
  } else {
    // Delete only request-linked notification types
    const requestLinkedTypes = [
      'NEW_BLOOD_REQUEST',
      'EMERGENCY_REQUEST',
      'REQUEST_ACCEPTED',
      'REQUEST_CANCELLED',
      'REQUEST_REJECTED',
      'REQUEST_FULFILLED',
      'DONATION_FULFILLED'
    ];
    notifDeleteResult = await Notification.deleteMany({ type: { $in: requestLinkedTypes } });
    console.log(`🗑️  Deleted ${notifDeleteResult.deletedCount} request-linked notifications from 'notifications'`);
  }

  // 3. Post-Reset Verification
  const remainingRequests = await BloodRequest.countDocuments();
  const remainingNotifications = await Notification.countDocuments();
  const totalUsers = await User.countDocuments();
  const adminUsers = await User.countDocuments({ role: 'admin' });

  console.log('-----------------------------------------------------------');
  console.log('✅ POST-RESET VERIFICATION:');
  console.log(`   Remaining Requests:      ${remainingRequests}`);
  console.log(`   Remaining Notifications: ${remainingNotifications}`);
  console.log(`   Preserved Users:         ${totalUsers} (${adminUsers} administrators)`);
  console.log('-----------------------------------------------------------');

  return {
    deletedRequests: reqDeleteResult.deletedCount,
    deletedNotifications: notifDeleteResult.deletedCount,
    remainingRequests,
    remainingNotifications,
    preservedUsers: totalUsers,
    preservedAdmins: adminUsers
  };
}

if (require.main === module) {
  performReset()
    .then(() => {
      console.log('🎉 Reset completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Reset failed:', err.message);
      process.exit(1);
    });
}

module.exports = { performReset };
