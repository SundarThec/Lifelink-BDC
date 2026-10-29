const express = require('express');
const router = express.Router();
const {
  createRequest,
  getRequests,
  getRequestById,
  acceptRequest,
  rejectRequest,
  fulfillRequest,
  cancelRequest,
  downloadMedicalDocument
} = require('../controllers/requestController');
const { protect } = require('../middleware/authMiddleware');
const { uploadDocuments } = require('../middleware/uploadMiddleware');

// Optional auth helper for GET routes
const optionalAuth = (req, res, next) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return protect(req, res, next);
  }
  next();
};

router.post('/', protect, uploadDocuments.array('medicalDocuments', 5), createRequest);
router.get('/', optionalAuth, getRequests);
router.get('/:id', optionalAuth, getRequestById);
router.put('/:id/accept', protect, acceptRequest);
router.put('/:id/reject', protect, rejectRequest);
router.put('/:id/fulfill', protect, fulfillRequest);
router.put('/:id/cancel', protect, cancelRequest);
router.get('/:id/documents/:filename', protect, downloadMedicalDocument);

module.exports = router;
