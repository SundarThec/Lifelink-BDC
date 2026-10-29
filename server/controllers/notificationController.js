const { Notification } = require('../models/Notification');
const { getEmailDiagnostics, sendTestEmailNotification } = require('../config/email');

/**
 * Get current user's notifications with unread count
 * GET /api/notifications
 */
async function getUserNotifications(req, res, next) {
  try {
    const notifications = await Notification.find({ recipientId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('requestId', 'patientName requiredBloodGroup hospitalName urgency requestStatus');

    const unreadCount = await Notification.countDocuments({
      recipientId: req.user._id,
      isRead: false
    });

    res.json({
      success: true,
      unreadCount,
      count: notifications.length,
      notifications
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Mark a single notification as read
 * PATCH /api/notifications/:id/read
 */
async function markNotificationRead(req, res, next) {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const unreadCount = await Notification.countDocuments({
      recipientId: req.user._id,
      isRead: false
    });

    res.json({
      success: true,
      notification,
      unreadCount
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Mark all notifications as read for current user
 * PATCH /api/notifications/mark-all-read
 */
async function markAllRead(req, res, next) {
  try {
    await Notification.updateMany(
      { recipientId: req.user._id, isRead: false },
      { isRead: true }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read',
      unreadCount: 0
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get Email Service Diagnostics
 * GET /api/notifications/diagnostics
 */
async function getDiagnostics(req, res, next) {
  try {
    const diagnostics = await getEmailDiagnostics();
    res.json(diagnostics);
  } catch (err) {
    next(err);
  }
}

/**
 * Send a verification test email
 * POST /api/notifications/test-email
 */
async function sendTestEmail(req, res, next) {
  try {
    const recipientEmail = (req.body && req.body.email ? req.body.email.trim() : req.user.email);
    const recipientName = req.user.name || 'LifeLink Member';

    console.log(`📨 Triggering test email dispatch to: ${recipientEmail}...`);
    const result = await sendTestEmailNotification(recipientEmail, recipientName);

    // Also record a notification in DB for traceability
    const notif = await Notification.create({
      recipientId: req.user._id,
      type: 'SYSTEM',
      title: '🔔 Test Email Notification Dispatched',
      message: `A test email notification was dispatched to ${recipientEmail}. Delivery status: ${result.success ? 'Delivered' : 'Failed'}.`,
      urgency: 'Normal',
      emailSent: result.success,
      emailStatus: result.success ? 'sent' : 'failed',
      emailError: result.error || '',
      emailPreviewUrl: result.previewUrl || null,
      emailHtml: result.html || null,
      isRead: false
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${req.user._id}`).emit('notification_updated', {
        notificationId: notif._id,
        emailSent: result.success,
        emailStatus: result.success ? 'sent' : 'failed',
        emailPreviewUrl: result.previewUrl || null
      });
    }

    res.json({
      success: result.success,
      message: result.success
        ? `Test email notification dispatched successfully to ${recipientEmail}!`
        : `Test email dispatch encountered an issue: ${result.error}`,
      recipientEmail,
      previewUrl: result.previewUrl || null,
      error: result.error || null,
      notification: notif
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get rendered HTML preview for a specific notification
 * GET /api/notifications/:id/email-preview
 */
async function getEmailPreview(req, res, next) {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipientId: req.user._id
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({
      success: true,
      title: notification.title,
      emailStatus: notification.emailStatus,
      emailSent: notification.emailSent,
      emailError: notification.emailError,
      emailPreviewUrl: notification.emailPreviewUrl,
      emailHtml: notification.emailHtml || `<div style="font-family:sans-serif;padding:20px;"><h3>${notification.title}</h3><p>${notification.message}</p></div>`
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getUserNotifications,
  markNotificationRead,
  markAllRead,
  getDiagnostics,
  sendTestEmail,
  getEmailPreview
};
