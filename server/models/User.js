const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { BLOOD_GROUPS } = require('../utils/bloodCompatibility');
const { isValidCoordinates } = require('../utils/geoDistance');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [70, 'Name cannot exceed 70 characters']
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters long'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
      match: [/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores']
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    phone: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
      trim: true,
      match: [/^\+?[0-9\s\-]{7,15}$/, 'Please provide a valid mobile number']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters']
    },
    age: {
      type: Number,
      required: [true, 'Age is required'],
      min: [18, 'Donors must be at least 18 years of age'],
      max: [70, 'Maximum donor age is 70 years']
    },
    bloodGroup: {
      type: String,
      required: [true, 'Blood group is required'],
      enum: {
        values: BLOOD_GROUPS,
        message: '{VALUE} is not a valid blood group'
      }
    },
    address: {
      type: String,
      required: [true, 'Human-readable address or locality is required'],
      trim: true
    },
    city: {
      type: String,
      default: '',
      trim: true
    },
    // GeoJSON Point for 2dsphere spatial queries
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
    isAvailableToDonate: {
      type: Boolean,
      default: true
    },
    isOnline: {
      type: Boolean,
      default: false
    },
    lastActive: {
      type: Date,
      default: Date.now
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active'
    },
    isBlocked: {
      type: Boolean,
      default: false,
      index: true
    },
    isVerified: {
      type: Boolean,
      default: false,
      index: true
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },
    avatar: {
      type: String,
      default: ''
    },
    totalDonations: {
      type: Number,
      default: 0
    },
    totalRequests: {
      type: Number,
      default: 0
    },
    lastDonationDate: {
      type: Date,
      default: null
    },
    medicalNotes: {
      type: String,
      default: '',
      maxlength: 500,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

// 2dsphere index on location for geospatial queries ($near, $geoWithin)
userSchema.index({ location: '2dsphere' });

// Compound index for optimal proximity + blood group queries
userSchema.index({ bloodGroup: 1, location: '2dsphere' });

// Index for active unblocked donor queries
userSchema.index({ status: 1, isBlocked: 1, isDeleted: 1, isAvailableToDonate: 1 });

// Password hashing before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Exclude password from json response
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
