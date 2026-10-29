const AuditLog = require('../models/AuditLog');

/**
 * Log an administrative action to the AuditLog collection
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.adminId
 * @param {string} params.adminName
 * @param {string} params.action
 * @param {string} params.targetType
 * @param {string|mongoose.Types.ObjectId} [params.targetId]
 * @param {string} [params.reason]
 * @param {object} [params.details]
 * @param {string} [params.ipAddress]
 */
async function logAdminAction({
  adminId,
  adminName,
  action,
  targetType,
  targetId = null,
  reason = '',
  details = {},
  ipAddress = ''
}) {
  try {
    const entry = await AuditLog.create({
      adminId,
      adminName,
      action,
      targetType,
      targetId,
      reason,
      details,
      ipAddress,
      timestamp: new Date()
    });
    return entry;
  } catch (err) {
    console.error('⚠️ Failed to write audit log entry:', err.message);
    return null;
  }
}

module.exports = {
  logAdminAction
};
