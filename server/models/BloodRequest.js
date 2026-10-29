const mongoose = require('mongoose');
const { BLOOD_GROUPS } = require('../utils/bloodCompatibility');
const { isValidCoordinates } = require('../utils/geoDistance');

const REQUEST_STATUSES = ['open', 'accepted', 'fulfilled', 'cancelled', 'rejected'];
const URGENCY_LEVELS = ['Normal', 'Urgent', 'Critical'];

const medicalDocumentSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

const bloodRequestSchema = new mongoose.Schema(
  {
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Requester ID is required'],
      index: true
    },
    patientName: {
      type: String,
      required: [true, 'Patient name is required'],
      trim: true
    },
    patientAge: {
      type: Number,
      required: [true, 'Patient age is required'],
      min: [0, 'Age cannot be negative'],
      max: [120, 'Please enter a realistic age']
    },
    requiredBloodGroup: {
      type: String,
      required: [true, 'Required blood group is required'],
      enum: {
        values: BLOOD_GROUPS,
        message: '{VALUE} is not a valid blood group'
      }
    },
    unitsRequired: {
      type: Number,
      required: [true, 'Units required is mandatory'],
      min: [1, 'At least 1 unit of blood must be requested'],
      max: [20, 'Maximum 20 units can be requested at once']
    },
    unitsFulfilled: {
      type: Number,
      default: 0
    },
    hospitalName: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true
    },
    hospitalAddress: {
      type: String,
      required: [true, 'Hospital address/location is required'],
      trim: true
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
        required: true
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: [true, 'Geographic coordinates [longitude, latitude] are required'],
        validate: {
          validator: isValidCoordinates,
          message: 'Coordinates must be valid [longitude (-180..180), latitude (-90..90)]'
        }
      }
    },
    searchRadiusKm: {
      type: Number,
      default: 5,
      min: [1, 'Search radius must be at least 1 km'],
      max: [150, 'Search radius cannot exceed 150 km']
    },
    // Automatic Radius Escalation History & Trigger Schedule
    radiusHistory: [
      {
        radiusKm: {
          type: Number,
          required: true
        },
        triggeredAt: {
          type: Date,
          default: Date.now
        },
        donorsNotified: {
          type: Number,
          default: 0
        }
      }
    ],
    nextEscalationAt: {
      type: Date,
      default: null,
      index: true
    },
    urgency: {
      type: String,
      enum: {
        values: URGENCY_LEVELS,
        message: '{VALUE} is not a valid urgency level'
      },
      default: 'Urgent'
    },
    requiredByDate: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000)
    },
    contactPhone: {
      type: String,
      required: [true, 'Contact phone number is required'],
      trim: true
    },
    contactEmail: {
      type: String,
      required: [true, 'Contact email is required'],
      trim: true,
      lowercase: true
    },
    medicalCondition: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1000, 'Medical condition description cannot exceed 1000 characters']
    },
    medicalDocuments: [medicalDocumentSchema],
    requestStatus: {
      type: String,
      enum: {
        values: REQUEST_STATUSES,
        message: '{VALUE} is not a valid request status'
      },
      default: 'open',
      index: true
    },
    primaryDonor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    acceptedDonors: [
      {
        donorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        acceptedAt: {
          type: Date,
          default: Date.now
        },
        pledgedUnits: {
          type: Number,
          default: 1
        }
      }
    ],
    notifiedDonorsCount: {
      type: Number,
      default: 0
    },
    fulfilledAt: {
      type: Date,
      default: null
    },
    cancelledReason: {
      type: String,
      default: ''
    },
    rejectedReason: {
      type: String,
      default: ''
    },
    isFlagged: {
      type: Boolean,
      default: false,
      index: true
    },
    flagReason: {
      type: String,
      default: '',
      trim: true
    },
    moderationNotes: {
      type: String,
      default: '',
      trim: true
    },
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// 2dsphere index for geospatial proximity search on blood requests
bloodRequestSchema.index({ location: '2dsphere' });

// Compound index to filter open requests by status and blood group
bloodRequestSchema.index({ requestStatus: 1, requiredBloodGroup: 1 });

// Index for escalation cron queries
bloodRequestSchema.index({ requestStatus: 1, nextEscalationAt: 1 });

const BloodRequest = mongoose.model('BloodRequest', bloodRequestSchema);

module.exports = {
  BloodRequest,
  REQUEST_STATUSES,
  URGENCY_LEVELS
};
