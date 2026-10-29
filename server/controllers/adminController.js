const User = require('../models/User');
const { BloodRequest } = require('../models/BloodRequest');
const Donation = require('../models/Donation');
const Complaint = require('../models/Complaint');
const BroadcastLog = require('../models/BroadcastLog');
const AuditLog = require('../models/AuditLog');
const { Notification } = require('../models/Notification');
const { BLOOD_GROUPS } = require('../utils/bloodCompatibility');
const { calculateHaversineDistance } = require('../utils/geoDistance');
const { logAdminAction } = require('../utils/auditLogger');
const { sendBroadcastAlert } = require('../config/email');

/**
 * Get comprehensive admin metrics & analytics
 * GET /api/v1/admin/metrics
 */
async function getDashboardMetrics(req, res, next) {
  try {
    const [
      totalUsers,
      activeDonors,
      totalRequests,
      fulfilledRequests,
      openRequests,
      flaggedRequests,
      totalDonationsCount,
      complaintsCount,
      broadcastsCount,
      auditLogsCount
    ] = await Promise.all([
      User.countDocuments({ isDeleted: { $ne: true } }),
      User.countDocuments({ status: 'active', isBlocked: { $ne: true }, isDeleted: { $ne: true }, isAvailableToDonate: true }),
      BloodRequest.countDocuments(),
      BloodRequest.countDocuments({ requestStatus: 'fulfilled' }),
      BloodRequest.countDocuments({ requestStatus: 'open' }),
      BloodRequest.countDocuments({ isFlagged: true }),
      Donation.countDocuments(),
      Complaint.countDocuments({ status: 'pending' }),
      BroadcastLog.countDocuments(),
      AuditLog.countDocuments()
    ]);

    // Blood group breakdown across community
    const bloodGroupDistribution = {};
    for (const bg of BLOOD_GROUPS) {
      bloodGroupDistribution[bg] = await User.countDocuments({
        bloodGroup: bg,
        status: 'active',
        isBlocked: { $ne: true },
        isDeleted: { $ne: true }
      });
    }

    const fulfillmentRate = totalRequests > 0 ? Math.round((fulfilledRequests / totalRequests) * 100) : 0;
    const estimatedLivesSaved = totalDonationsCount * 3;

    res.json({
      success: true,
      metrics: {
        totalUsers,
        activeDonors,
        totalRequests,
        fulfilledRequests,
        openRequests,
        fulfillmentRate,
        totalDonationsCount,
        estimatedLivesSaved,
        pendingComplaints: complaintsCount,
        totalBroadcasts: broadcastsCount,
        flaggedRequests,
        totalAuditLogs: auditLogsCount,
        bloodGroupDistribution
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List all users with filtering
 * GET /api/v1/admin/users
 */
async function getAllUsers(req, res, next) {
  try {
    const {
      bloodGroup,
      status,
      availability,
      search,
      role,
      isBlocked,
      isVerified,
      includeDeleted,
      city,
      minAge,
      maxAge,
      isOnline,
      page,
      limit
    } = req.query;

    const query = {};

    // Exclude soft-deleted by default unless requested
    if (includeDeleted !== 'true') {
      query.isDeleted = { $ne: true };
    }

    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (status) query.status = status;
    if (role) query.role = role;

    if (availability !== undefined && availability !== '') {
      query.isAvailableToDonate = availability === 'true' || availability === true;
    }

    if (isBlocked !== undefined && isBlocked !== '') {
      query.isBlocked = isBlocked === 'true' || isBlocked === true;
    }

    if (isVerified !== undefined && isVerified !== '') {
      query.isVerified = isVerified === 'true' || isVerified === true;
    }

    if (isOnline !== undefined && isOnline !== '') {
      query.isOnline = isOnline === 'true' || isOnline === true;
    }

    if (city && city.trim() !== '') {
      query.city = new RegExp(city.trim(), 'i');
    }

    if ((minAge !== undefined && minAge !== '') || (maxAge !== undefined && maxAge !== '')) {
      query.age = {};
      if (minAge !== undefined && minAge !== '') query.age.$gte = Number(minAge);
      if (maxAge !== undefined && maxAge !== '') query.age.$lte = Number(maxAge);
    }

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: regex }, { username: regex }, { email: regex }, { phone: regex }, { city: regex }];
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const total = await User.countDocuments(query);

    let queryBuilder = User.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    if (!isNaN(pageNum) && pageNum > 0 && !isNaN(limitNum) && limitNum > 0) {
      queryBuilder = queryBuilder.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const users = await queryBuilder.lean();

    res.json({
      success: true,
      total,
      count: users.length,
      page: !isNaN(pageNum) ? pageNum : 1,
      pages: !isNaN(limitNum) && limitNum > 0 ? Math.ceil(total / limitNum) : 1,
      users
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Block a user (sets isBlocked: true)
 * PATCH /api/v1/admin/users/:id/block
 */
async function blockUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot block administrator accounts.' });
    }

    const reason = req.body.reason || 'Blocked by administrator';
    user.isBlocked = true;
    user.isOnline = false;
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'USER_BLOCKED',
      targetType: 'User',
      targetId: user._id,
      reason,
      details: { username: user.username, email: user.email },
      ipAddress: req.ip
    });

    // Disconnect user socket room
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${user._id}`).emit('account_blocked', {
        message: 'Your account has been blocked by an administrator.'
      });
    }

    res.json({
      success: true,
      message: `User ${user.name} (@${user.username}) has been blocked.`,
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Unblock a user (sets isBlocked: false)
 * PATCH /api/v1/admin/users/:id/unblock
 */
async function unblockUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isBlocked = false;
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'USER_UNBLOCKED',
      targetType: 'User',
      targetId: user._id,
      reason: req.body.reason || 'Unblocked by administrator',
      details: { username: user.username, email: user.email },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `User ${user.name} (@${user.username}) has been unblocked.`,
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Manually verify a user's profile
 * PATCH /api/v1/admin/users/:id/verify
 */
async function verifyUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Toggle or set verified
    const newStatus = typeof req.body.isVerified === 'boolean' ? req.body.isVerified : !user.isVerified;
    user.isVerified = newStatus;
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: newStatus ? 'USER_VERIFIED' : 'USER_UNVERIFIED',
      targetType: 'User',
      targetId: user._id,
      reason: req.body.reason || 'Profile verification updated',
      details: { username: user.username, isVerified: newStatus },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `User ${user.name} profile verification status set to: ${user.isVerified ? 'Verified' : 'Unverified'}`,
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Soft-delete a user (sets isDeleted: true)
 * DELETE /api/v1/admin/users/:id
 */
async function deleteUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Admin accounts cannot be deleted directly.' });
    }

    // Perform soft-delete
    user.isDeleted = true;
    user.isOnline = false;
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'USER_DELETED',
      targetType: 'User',
      targetId: user._id,
      reason: req.body.reason || 'Soft-deleted by administrator',
      details: { username: user.username },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `User account for ${user.name} has been deactivated (soft-deleted).`
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Change a user's role (user <-> admin)
 * PATCH /api/v1/admin/users/:id/role
 */
async function changeUserRole(req, res, next) {
  try {
    const { role, reason } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be user or admin.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot modify your own administrative role.' });
    }

    // Protect final remaining administrator
    if (user.role === 'admin' && role !== 'admin') {
      const activeAdminCount = await User.countDocuments({
        role: 'admin',
        isDeleted: { $ne: true },
        isBlocked: { $ne: true },
        status: { $ne: 'suspended' }
      });
      if (activeAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the last remaining active administrator.'
        });
      }
    }

    const oldRole = user.role;
    user.role = role;
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'USER_ROLE_CHANGED',
      targetType: 'User',
      targetId: user._id,
      reason: reason || `Role updated from ${oldRole} to ${role}`,
      details: { oldRole, newRole: role, username: user.username },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `User ${user.name} role changed to: ${role}`,
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Toggle user account status (active <-> suspended)
 * PATCH /api/v1/admin/users/:id/status
 */
async function toggleUserStatus(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin' && user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot suspend your own admin account.' });
    }

    if (user.role === 'admin' && user.status === 'active') {
      const activeAdminCount = await User.countDocuments({
        role: 'admin',
        isDeleted: { $ne: true },
        isBlocked: { $ne: true },
        status: 'active'
      });
      if (activeAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot suspend the last remaining active administrator.'
        });
      }
    }

    user.status = user.status === 'active' ? 'suspended' : 'active';
    await user.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'USER_STATUS_TOGGLED',
      targetType: 'User',
      targetId: user._id,
      reason: `Status changed to ${user.status}`,
      details: { newStatus: user.status, username: user.username },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `User status changed to: ${user.status}`,
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Send an administrative broadcast / announcement to users
 * POST /api/v1/admin/broadcast
 */
async function sendBroadcast(req, res, next) {
  try {
    const { title, message, target = {} } = req.body;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Both title and message are required for an administrative broadcast.'
      });
    }

    // Build recipient matching query
    const query = {
      isDeleted: { $ne: true },
      isBlocked: { $ne: true },
      status: 'active'
    };

    if (target.bloodGroups && Array.isArray(target.bloodGroups) && target.bloodGroups.length > 0) {
      query.bloodGroup = { $in: target.bloodGroups };
    }

    if (target.availableOnly) {
      query.isAvailableToDonate = true;
    }

    const hasRegionFilter =
      target.region &&
      Array.isArray(target.region.center) &&
      target.region.center.length === 2 &&
      target.region.radiusKm > 0;

    if (hasRegionFilter) {
      const radiusRadians = target.region.radiusKm / 6378.137;
      query.location = {
        $geoWithin: {
          $centerSphere: [target.region.center, radiusRadians]
        }
      };
    }

    const candidateUsers = await User.find(query).select('_id name email phone location');

    // Fine-grained circular boundary check if region filter provided
    const recipients = [];
    if (hasRegionFilter) {
      for (const u of candidateUsers) {
        if (u.location && u.location.coordinates) {
          const dist = calculateHaversineDistance(target.region.center, u.location.coordinates);
          if (dist <= target.region.radiusKm) {
            recipients.push(u);
          }
        }
      }
    } else {
      recipients.push(...candidateUsers);
    }

    const io = req.app.get('io');
    const now = new Date();

    // Create notifications and emit live socket alerts
    for (const recipient of recipients) {
      try {
        const notif = await Notification.create({
          recipientId: recipient._id,
          type: 'ADMIN_BROADCAST',
          title: `📢 ${title.trim()}`,
          message: message.trim(),
          urgency: 'Normal',
          isRead: false
        });

        if (io) {
          io.to(`user_${recipient._id}`).emit('admin_broadcast', {
            notification: notif,
            title: title.trim(),
            message: message.trim(),
            sentAt: now
          });
        }

        if (recipient.email) {
          sendBroadcastAlert(recipient, title.trim(), message.trim()).then(async (emailRes) => {
            await Notification.findByIdAndUpdate(notif._id, {
              emailSent: emailRes.success,
              emailStatus: emailRes.success ? 'sent' : 'failed',
              emailError: emailRes.error || '',
              emailPreviewUrl: emailRes.previewUrl || null,
              emailHtml: emailRes.html || null
            });
            if (io) {
              io.to(`user_${recipient._id}`).emit('notification_updated', {
                notificationId: notif._id,
                emailSent: emailRes.success,
                emailStatus: emailRes.success ? 'sent' : 'failed',
                emailPreviewUrl: emailRes.previewUrl || null
              });
            }
          }).catch(() => {});
        }
      } catch (e) {
        console.error(`Error notifying recipient ${recipient._id}:`, e.message);
      }
    }

    // Record in BroadcastLog
    const broadcastLog = await BroadcastLog.create({
      senderId: req.user._id,
      title: title.trim(),
      message: message.trim(),
      targetCriteria: {
        bloodGroups: target.bloodGroups || [],
        region: target.region || null,
        availableOnly: !!target.availableOnly
      },
      recipientCount: recipients.length,
      sentAt: now
    });

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'ADMIN_BROADCAST_SENT',
      targetType: 'Broadcast',
      targetId: broadcastLog._id,
      reason: title.trim(),
      details: { recipientCount: recipients.length },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      message: `Broadcast successfully sent to ${recipients.length} community member(s).`,
      recipientCount: recipients.length,
      broadcastLog
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve past admin broadcast logs
 * GET /api/v1/admin/broadcasts
 */
async function getBroadcastLogs(req, res, next) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [total, logs] = await Promise.all([
      BroadcastLog.countDocuments(),
      BroadcastLog.find()
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate('senderId', 'name username email')
        .lean()
    ]);

    res.json({
      success: true,
      total,
      count: logs.length,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      logs
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Flag a blood request for investigation
 * PATCH /api/v1/admin/requests/:id/flag
 */
async function flagRequest(req, res, next) {
  try {
    const { reason = 'Suspicious or duplicate request activity flagged' } = req.body;
    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.isFlagged = true;
    request.flagReason = reason;
    request.moderatedBy = req.user._id;
    await request.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'REQUEST_FLAGGED',
      targetType: 'BloodRequest',
      targetId: request._id,
      reason,
      details: { patientName: request.patientName, hospitalName: request.hospitalName },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Request for ${request.patientName} has been flagged for investigation.`,
      request
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Unflag a blood request
 * PATCH /api/v1/admin/requests/:id/unflag
 */
async function unflagRequest(req, res, next) {
  try {
    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.isFlagged = false;
    request.flagReason = '';
    await request.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'REQUEST_UNFLAGGED',
      targetType: 'BloodRequest',
      targetId: request._id,
      reason: req.body.reason || 'Investigation flag cleared',
      details: { patientName: request.patientName },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Flag cleared for request ${request.patientName}.`,
      request
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Moderation cancellation of fraudulent/abusive request
 * PATCH /api/v1/admin/requests/:id/cancel
 */
async function moderateCancelRequest(req, res, next) {
  try {
    const { reason = 'Cancelled by administrator due to moderation review', moderationNotes = '' } = req.body;
    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.requestStatus = 'cancelled';
    request.cancelledReason = reason;
    request.moderationNotes = moderationNotes;
    request.moderatedBy = req.user._id;
    request.nextEscalationAt = null;
    await request.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'REQUEST_CANCELLED',
      targetType: 'BloodRequest',
      targetId: request._id,
      reason,
      details: { patientName: request.patientName, moderationNotes },
      ipAddress: req.ip
    });

    // Notify requester
    await Notification.create({
      recipientId: request.requesterId,
      type: 'REQUEST_CANCELLED',
      requestId: request._id,
      title: '⚠️ Blood Request Cancelled by Administrator',
      message: `Your blood request for ${request.patientName} was cancelled by administrator. Reason: ${reason}`
    });

    res.json({
      success: true,
      message: `Request ${request._id} has been cancelled by administrator.`,
      request
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin override/update of blood request urgency / priority
 * PATCH /api/v1/admin/requests/:id/priority
 */
async function updateRequestPriority(req, res, next) {
  try {
    const { urgency, reason } = req.body;
    const validUrgencies = ['Normal', 'Urgent', 'Critical'];
    if (!urgency || !validUrgencies.includes(urgency)) {
      return res.status(400).json({
        success: false,
        message: `Invalid urgency level. Must be one of: ${validUrgencies.join(', ')}`
      });
    }

    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const oldUrgency = request.urgency;
    request.urgency = urgency;
    request.moderatedBy = req.user._id;
    await request.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'REQUEST_PRIORITY_CHANGED',
      targetType: 'BloodRequest',
      targetId: request._id,
      reason: reason || `Priority escalated/adjusted from ${oldUrgency} to ${urgency}`,
      details: { oldUrgency, newUrgency: urgency, patientName: request.patientName },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: `Request priority updated from ${oldUrgency} to ${urgency}.`,
      request
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve all blood requests for admin oversight
 * GET /api/v1/admin/requests
 */
async function getAllRequests(req, res, next) {
  try {
    const { status, urgency, bloodGroup, isFlagged, search, startDate, endDate, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status) query.requestStatus = status;
    if (urgency) query.urgency = urgency;
    if (bloodGroup) query.requiredBloodGroup = bloodGroup;
    if (isFlagged !== undefined) query.isFlagged = isFlagged === 'true';

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ patientName: regex }, { hospitalName: regex }, { hospitalAddress: regex }];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [total, requests] = await Promise.all([
      BloodRequest.countDocuments(query),
      BloodRequest.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate('requesterId', 'name username email phone bloodGroup')
        .populate('primaryDonor', 'name username email phone bloodGroup')
        .populate('moderatedBy', 'name username')
        .lean()
    ]);

    res.json({
      success: true,
      total,
      count: requests.length,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      requests
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Export all users as downloadable CSV file
 * GET /api/v1/admin/export/users-csv
 */
async function exportUsersCSV(req, res, next) {
  try {
    const users = await User.find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .lean();

    const headers = [
      'Name',
      'Username',
      'Email',
      'Phone',
      'Blood Group',
      'Age',
      'Role',
      'Status',
      'Available To Donate',
      'Verified',
      'Blocked',
      'City',
      'Total Donations',
      'Registered At'
    ];

    const rows = users.map((u) => [
      `"${(u.name || '').replace(/"/g, '""')}"`,
      `"${(u.username || '').replace(/"/g, '""')}"`,
      `"${(u.email || '').replace(/"/g, '""')}"`,
      `"${(u.phone || '').replace(/"/g, '""')}"`,
      `"${u.bloodGroup || ''}"`,
      u.age || '',
      `"${u.role || 'user'}"`,
      `"${u.status || 'active'}"`,
      u.isAvailableToDonate ? 'Yes' : 'No',
      u.isVerified ? 'Yes' : 'No',
      u.isBlocked ? 'Yes' : 'No',
      `"${(u.city || '').replace(/"/g, '""')}"`,
      u.totalDonations || 0,
      `"${u.createdAt ? new Date(u.createdAt).toISOString() : ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lifelink_users_${Date.now()}.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
}

/**
 * Export all blood requests as downloadable CSV file
 * GET /api/v1/admin/export/requests-csv
 */
async function exportRequestsCSV(req, res, next) {
  try {
    const requests = await BloodRequest.find()
      .sort({ createdAt: -1 })
      .populate('requesterId', 'name email phone')
      .lean();

    const headers = [
      'Patient Name',
      'Blood Group',
      'Units Required',
      'Units Fulfilled',
      'Hospital Name',
      'Urgency',
      'Request Status',
      'Search Radius (km)',
      'Flagged',
      'Requester Name',
      'Contact Phone',
      'Created At'
    ];

    const rows = requests.map((r) => [
      `"${(r.patientName || '').replace(/"/g, '""')}"`,
      `"${r.requiredBloodGroup || ''}"`,
      r.unitsRequired || 1,
      r.unitsFulfilled || 0,
      `"${(r.hospitalName || '').replace(/"/g, '""')}"`,
      `"${r.urgency || 'Urgent'}"`,
      `"${r.requestStatus || 'open'}"`,
      r.searchRadiusKm || 5,
      r.isFlagged ? 'Yes' : 'No',
      `"${(r.requesterId?.name || '').replace(/"/g, '""')}"`,
      `"${(r.contactPhone || '').replace(/"/g, '""')}"`,
      `"${r.createdAt ? new Date(r.createdAt).toISOString() : ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lifelink_requests_${Date.now()}.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
}

/**
 * Get all complaints / inquiries
 * GET /api/v1/admin/complaints
 */
async function getComplaints(req, res, next) {
  try {
    const complaints = await Complaint.find()
      .populate('userId', 'name email phone')
      .populate('reportedUserId', 'name username email')
      .populate('requestId', 'patientName requiredBloodGroup hospitalName')
      .populate('resolvedBy', 'name username')
      .sort({ createdAt: -1 })
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

/**
 * Resolve complaint
 * PATCH /api/v1/admin/complaints/:id/resolve
 */
async function resolveComplaint(req, res, next) {
  try {
    const { adminResponse, moderatorNotes } = req.body;
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found.' });
    }

    complaint.status = 'resolved';
    complaint.adminResponse = adminResponse || 'Resolved by administrator';
    if (moderatorNotes) complaint.moderatorNotes = moderatorNotes;
    complaint.resolvedAt = new Date();
    complaint.resolvedBy = req.user._id;
    await complaint.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'COMPLAINT_RESOLVED',
      targetType: 'Complaint',
      targetId: complaint._id,
      reason: adminResponse || 'Resolved',
      details: { subject: complaint.subject, moderatorNotes },
      ipAddress: req.ip
    });

    // Notify the reporting user
    await Notification.create({
      recipientId: complaint.userId,
      type: 'COMPLAINT_UPDATE',
      title: '📋 Update on your LifeLink report/inquiry',
      message: `Your report regarding "${complaint.subject}" has been resolved: ${complaint.adminResponse}`
    });

    res.json({
      success: true,
      message: 'Complaint resolved and reporting user notified.',
      complaint
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Reject complaint
 * PATCH /api/v1/admin/complaints/:id/reject
 */
async function rejectComplaint(req, res, next) {
  try {
    const { adminResponse, moderatorNotes } = req.body;
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found.' });
    }

    complaint.status = 'rejected';
    complaint.adminResponse = adminResponse || 'Report reviewed and rejected upon moderation.';
    if (moderatorNotes) complaint.moderatorNotes = moderatorNotes;
    complaint.resolvedAt = new Date();
    complaint.resolvedBy = req.user._id;
    await complaint.save();

    await logAdminAction({
      adminId: req.user._id,
      adminName: req.user.name,
      action: 'COMPLAINT_REJECTED',
      targetType: 'Complaint',
      targetId: complaint._id,
      reason: adminResponse || 'Rejected',
      details: { subject: complaint.subject, moderatorNotes },
      ipAddress: req.ip
    });

    // Notify user
    await Notification.create({
      recipientId: complaint.userId,
      type: 'COMPLAINT_UPDATE',
      title: '📋 Update on your LifeLink report/inquiry',
      message: `Your report regarding "${complaint.subject}" was reviewed: ${complaint.adminResponse}`
    });

    res.json({
      success: true,
      message: 'Complaint rejected upon moderation review.',
      complaint
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get audit logs history
 * GET /api/v1/admin/audit-logs
 */
async function getAuditLogs(req, res, next) {
  try {
    const { action, targetType, adminId, actorId, startDate, endDate, limit = 50, page = 1 } = req.query;
    const query = {};
    if (action) query.action = action;
    if (targetType) query.targetType = targetType;
    if (adminId || actorId) query.adminId = adminId || actorId;
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate('adminId', 'name username email')
        .lean()
    ]);

    res.json({
      success: true,
      total,
      count: logs.length,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      logs
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
};
