const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'NEW_BLOOD_REQUEST',
  'EMERGENCY_REQUEST',
  'REQUEST_ACCEPTED',
  'REQUEST_REJECTED',
  'REQUEST_CANCELLED',
  'DONATION_FULFILLED',
  'REQUEST_FULFILLED',
  'CHAT_MESSAGE',
  'ADMIN_BROADCAST',
  'COMPLAINT_UPDATE',
  'SYSTEM'
];

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient ID is required'],
      index: true
    },
    type: {
      type: String,
      enum: {
        values: NOTIFICATION_TYPES,
        message: '{VALUE} is not a valid notification type'
      },
      required: true
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BloodRequest',
      default: null,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    urgency: {
      type: String,
      default: 'Normal'
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    emailSent: {
      type: Boolean,
      default: false
    },
    emailStatus: {
      type: String,
      default: 'pending' // 'sent', 'failed', 'skipped'
    },
    emailError: {
      type: String,
      default: ''
    },
    emailPreviewUrl: {
      type: String,
      default: null
    },
    emailHtml: {
      type: String,
      default: null
    },
    emailText: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for querying unread notifications for a user sorted by date
notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = {
  Notification,
  NOTIFICATION_TYPES
};
