const express = require('express');
const router = express.Router();
const {
  getDashboardMetrics,
  getAllUsers,
  blockUser,
  unblockUser,
  verifyUser,
  deleteUser,
  changeUserRole,
  toggleUserStatus,
  sendBroadcast,
  getBroadcastLogs,
  getAllRequests,
  flagRequest,
  unflagRequest,
  moderateCancelRequest,
  updateRequestPriority,
  exportUsersCSV,
  exportRequestsCSV,
  getComplaints,
  resolveComplaint,
  rejectComplaint,
  getAuditLogs
} = require('../controllers/adminController');
const { protect, authorizeAdmin } = require('../middleware/authMiddleware');

// Protect all admin endpoints with authentication and admin role authorization
router.use(protect);
router.use(authorizeAdmin);

// Analytics
router.get('/metrics', getDashboardMetrics);

// User Management (/api/v1/admin/users)
router.get('/users', getAllUsers);
router.patch('/users/:id/block', blockUser);
router.patch('/users/:id/unblock', unblockUser);
router.patch('/users/:id/verify', verifyUser);
router.patch('/users/:id/role', changeUserRole);
router.delete('/users/:id', deleteUser);
router.patch('/users/:id/status', toggleUserStatus);

// Administrative Broadcast Control (/api/v1/admin/broadcast)
router.post('/broadcast', sendBroadcast);
router.get('/broadcasts', getBroadcastLogs);
router.get('/broadcast-logs', getBroadcastLogs);

// Emergency Requests Oversight & Moderation
router.get('/requests', getAllRequests);
router.patch('/requests/:id/flag', flagRequest);
router.patch('/requests/:id/unflag', unflagRequest);
router.patch('/requests/:id/cancel', moderateCancelRequest);
router.patch('/requests/:id/priority', updateRequestPriority);

// Export Data
router.get('/export/users-csv', exportUsersCSV);
router.get('/export/requests-csv', exportRequestsCSV);

// Complaints & Moderation
router.get('/complaints', getComplaints);
router.patch('/complaints/:id/resolve', resolveComplaint);
router.patch('/complaints/:id/reject', rejectComplaint);

// Administrative Audit Logs
router.get('/audit-logs', getAuditLogs);

module.exports = router;
