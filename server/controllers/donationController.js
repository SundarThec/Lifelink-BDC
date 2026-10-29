const Donation = require('../models/Donation');
const { BloodRequest } = require('../models/BloodRequest');

/**
 * Get current user's completed donation history
 * GET /api/donations/my-donations
 */
async function getUserDonations(req, res, next) {
  try {
    const donations = await Donation.find({ donorId: req.user._id })
      .sort({ donationDate: -1 })
      .populate('recipientId', 'name')
      .populate('requestId', 'patientName hospitalName urgency')
      .lean();

    // 90-day cooldown calculation for whole blood donation
    let nextEligibleDate = null;
    let daysUntilEligible = 0;

    if (donations.length > 0) {
      const lastDonation = new Date(donations[0].donationDate);
      nextEligibleDate = new Date(lastDonation.getTime() + 90 * 24 * 60 * 60 * 1000);
      const diffTime = nextEligibleDate.getTime() - Date.now();
      daysUntilEligible = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }

    res.json({
      success: true,
      totalDonations: donations.length,
      estimatedLivesSaved: donations.length * 3,
      nextEligibleDate,
      daysUntilEligible,
      donations
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get single donation record & certificate details
 * GET /api/donations/certificate/:id
 */
async function getDonationCertificate(req, res, next) {
  try {
    const donation = await Donation.findById(req.params.id)
      .populate('donorId', 'name username email bloodGroup')
      .populate('recipientId', 'name')
      .populate('requestId', 'patientName hospitalName hospitalAddress');

    if (!donation) {
      return res.status(404).json({ success: false, message: 'Donation certificate not found.' });
    }

    // Access control: donor, recipient, or admin
    const isDonor = donation.donorId._id.toString() === req.user._id.toString();
    const isRecipient = donation.recipientId._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isDonor && !isRecipient && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You can only view certificates associated with your own donations.'
      });
    }

    res.json({
      success: true,
      donation
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get current user's requested blood emergency history
 * GET /api/donations/my-requests
 */
async function getUserRequestsHistory(req, res, next) {
  try {
    const requests = await BloodRequest.find({ requesterId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('acceptedDonors.donorId', 'name username phone bloodGroup avatar')
      .populate('primaryDonor', 'name username phone bloodGroup avatar')
      .lean();

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getUserDonations,
  getDonationCertificate,
  getUserRequestsHistory
};
