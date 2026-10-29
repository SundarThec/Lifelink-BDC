const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protect routes requiring authentication
 * Rejects blocked, suspended, and soft-deleted accounts
 */
async function protect(req, res, next) {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    // Also allow token in query param for direct document download links
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication token required. Please log in.'
    });
  }

  try {
    const secret =
      process.env.JWT_SECRET ||
      'lifelink_super_secure_jwt_production_secret_key_2026_blood_community';
    const decoded = jwt.verify(token, secret);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists.'
      });
    }

    // Check soft-delete status
    if (user.isDeleted) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated.'
      });
    }

    // Check administrative block status
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked by an administrator.'
      });
    }

    // Check account suspension status
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact administrator.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session. Please log in again.'
    });
  }
}

/**
 * Restrict to administrators only
 */
function authorizeAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Administrator privileges required.'
    });
  }
  next();
}

module.exports = {
  protect,
  authorizeAdmin
};
