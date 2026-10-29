const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
  {
    donorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Donor ID is required'],
      index: true
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BloodRequest',
      required: [true, 'Blood Request ID is required'],
      index: true
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient ID is required']
    },
    patientName: {
      type: String,
      required: true,
      trim: true
    },
    hospitalName: {
      type: String,
      required: true,
      trim: true
    },
    hospitalAddress: {
      type: String,
      default: '',
      trim: true
    },
    bloodGroup: {
      type: String,
      required: true
    },
    unitsDonated: {
      type: Number,
      required: true,
      default: 1,
      min: 1
    },
    donationDate: {
      type: Date,
      default: Date.now
    },
    certificateId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    verificationCode: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

// Helper to generate unique certificate identifier
donationSchema.statics.generateCertificateId = function () {
  const year = new Date().getFullYear();
  const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `LL-${year}-${randomChars}`;
};

const Donation = mongoose.model('Donation', donationSchema);

module.exports = Donation;
