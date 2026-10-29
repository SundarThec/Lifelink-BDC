const mongoose = require('mongoose');

const broadcastLogSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: [true, 'Broadcast title is required'],
      trim: true,
      maxlength: 150
    },
    message: {
      type: String,
      required: [true, 'Broadcast message content is required'],
      trim: true,
      maxlength: 2000
    },
    targetCriteria: {
      bloodGroups: {
        type: [String],
        default: []
      },
      region: {
        center: {
          type: [Number], // [lng, lat]
          default: null
        },
        radiusKm: {
          type: Number,
          default: null
        }
      },
      availableOnly: {
        type: Boolean,
        default: false
      }
    },
    recipientCount: {
      type: Number,
      default: 0
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

const BroadcastLog = mongoose.model('BroadcastLog', broadcastLogSchema);

module.exports = BroadcastLog;
