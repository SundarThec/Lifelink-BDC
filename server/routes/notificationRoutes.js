const express = require('express');
const router = express.Router();
const {
  getUserNotifications,
  markNotificationRead,
  markAllRead,
  getDiagnostics,
  sendTestEmail,
  getEmailPreview
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getUserNotifications);
router.get('/diagnostics', getDiagnostics);
router.post('/test-email', sendTestEmail);
router.patch('/mark-all-read', markAllRead);
router.get('/:id/email-preview', getEmailPreview);
router.patch('/:id/read', markNotificationRead);

module.exports = router;
