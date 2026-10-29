const express = require('express');
const router = express.Router();
const {
  getUserDonations,
  getDonationCertificate,
  getUserRequestsHistory
} = require('../controllers/donationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/my-donations', getUserDonations);
router.get('/my-requests', getUserRequestsHistory);
router.get('/certificate/:id', getDonationCertificate);

module.exports = router;
