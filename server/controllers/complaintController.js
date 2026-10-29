const Complaint = require('../models/Complaint');
const User = require('../models/User');
const { BloodRequest } = require('../models/BloodRequest');

/**
 * Submit a complaint or report a user / suspicious request
 * POST /api/complaints
 */
async function submitComplaint(req, res, next) {
  try {
    const { subject, description, reportedUserId, requestId } = req.body;

    if (!subject || subject.trim() === '' || !description || description.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Both subject and detailed description are required to submit a complaint.'
      });
    }

    // Optional validation of reported user
    if (reportedUserId) {
      const targetUser = await User.findById(reportedUserId);
      if (!targetUser) {
        return res.status(400).json({
          success: false,
          message: 'The reported user account does not exist.'
        });
      }
    }

    // Optional validation of reported request
    if (requestId) {
      const targetReq = await BloodRequest.findById(requestId);
      if (!targetReq) {
        return res.status(400).json({
          success: false,
          message: 'The reported blood request does not exist.'
        });
      }
    }

    const complaint = await Complaint.create({
      userId: req.user._id,
      subject: subject.trim(),
      description: description.trim(),
      reportedUserId: reportedUserId || null,
      requestId: requestId || null,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Your report/complaint has been submitted and queued for administrative review.',
      complaint
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get all complaints submitted by the logged in user
 * GET /api/complaints/my
 */
async function getMyComplaints(req, res, next) {
  try {
    const complaints = await Complaint.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('reportedUserId', 'name username')
      .populate('requestId', 'patientName requiredBloodGroup hospitalName')
      .select('-moderatorNotes') // Hide internal moderator notes from user
      .lean();

    res.json({
      success: true,
      count: complaints.length,
      complaints
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitComplaint,
  getMyComplaints
};
