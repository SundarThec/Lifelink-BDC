const express = require('express');
const router = express.Router();
const { submitComplaint, getMyComplaints } = require('../controllers/complaintController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/', submitComplaint);
router.get('/my', getMyComplaints);

module.exports = router;
