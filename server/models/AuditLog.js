const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
      index: true
    },
    adminName: {
      type: String,
      required: true
    },
    action: {
      type: String,
      required: true,
      enum: [
        'USER_BLOCKED',
        'USER_UNBLOCKED',
        'USER_VERIFIED',
        'USER_UNVERIFIED',
        'USER_DELETED',
        'USER_ROLE_CHANGED',
        'USER_STATUS_TOGGLED',
        'REQUEST_MODERATED',
        'REQUEST_FLAGGED',
        'REQUEST_UNFLAGGED',
        'REQUEST_CANCELLED',
        'REQUEST_PRIORITY_CHANGED',
        'COMPLAINT_RESOLVED',
        'COMPLAINT_REJECTED',
        'ADMIN_BROADCAST_SENT',
        'ADMIN_LOGIN_SUCCESS',
        'ADMIN_LOGIN_FAILED',
        'ADMIN_ACCESS_DENIED',
        'ADMIN_SETUP'
      ],
      index: true
    },
    targetType: {
      type: String,
      required: true,
      enum: ['User', 'BloodRequest', 'Complaint', 'Broadcast', 'System'],
      index: true
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },
    reason: {
      type: String,
      default: '',
      trim: true
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ipAddress: {
      type: String,
      default: ''
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

auditLogSchema.index({ targetType: 1, targetId: 1 });
auditLogSchema.index({ createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
