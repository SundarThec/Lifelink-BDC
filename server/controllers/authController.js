const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isValidCoordinates } = require('../utils/geoDistance');
const { BLOOD_GROUPS } = require('../utils/bloodCompatibility');
const { logAdminAction } = require('../utils/auditLogger');

const JWT_SECRET = process.env.JWT_SECRET || 'lifelink_super_secure_jwt_production_secret_key_2026_blood_community';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Helper to generate JWT Token
 */
function generateToken(userId, role) {
  return jwt.sign({ id: userId, role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
}

/**
 * Register a new user / donor
 * POST /api/auth/register
 */
async function register(req, res, next) {
  try {
    const {
      name,
      username,
      email,
      phone,
      password,
      age,
      bloodGroup,
      address,
      city,
      coordinates, // [longitude, latitude]
      isAvailableToDonate,
      medicalNotes
    } = req.body;

    // Validate required fields
    if (!name || !username || !email || !phone || !password || !bloodGroup || !address) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all mandatory fields: name, username, email, phone, password, bloodGroup, address.'
      });
    }

    if (!BLOOD_GROUPS.includes(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: `Invalid blood group. Must be one of: ${BLOOD_GROUPS.join(', ')}`
      });
    }

    // Validate coordinates
    let parsedCoords = coordinates;
    if (typeof coordinates === 'string') {
      try {
        parsedCoords = JSON.parse(coordinates);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinate format. Must be JSON array [longitude, latitude].'
        });
      }
    }

    if (!isValidCoordinates(parsedCoords)) {
      return res.status(400).json({
        success: false,
        message: 'Valid geographic coordinates [longitude, latitude] are required from map pin or address lookup.'
      });
    }

    // Check duplicate email / username / phone explicitly
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        { username: username.toLowerCase().trim() },
        { phone: phone.trim() }
      ]
    });

    if (existingUser) {
      let duplicateField = 'information';
      if (existingUser.email === email.toLowerCase().trim()) duplicateField = 'email address';
      else if (existingUser.username === username.toLowerCase().trim()) duplicateField = 'username';
      else if (existingUser.phone === phone.trim()) duplicateField = 'mobile number';

      return res.status(400).json({
        success: false,
        message: `A user with this ${duplicateField} is already registered in LifeLink.`
      });
    }

    const user = await User.create({
      name: name.trim(),
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      age: Number(age) || 25,
      bloodGroup,
      address: address.trim(),
      city: (city || '').trim(),
      location: {
        type: 'Point',
        coordinates: parsedCoords
      },
      isAvailableToDonate: isAvailableToDonate !== false,
      medicalNotes: medicalNotes || '',
      isOnline: true,
      lastActive: new Date()
    });

    const token = generateToken(user._id, user.role);

    res.status(201).json({
      success: true,
      message: 'Account successfully registered.',
      token,
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Authenticate existing user
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const { loginId, password, loginType } = req.body;

    if (loginType === 'admin') {
      return adminLogin(req, res, next);
    }

    if (!loginId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your email/username and password.'
      });
    }

    const sanitizedLogin = loginId.toLowerCase().trim();

    // Query by email OR username, explicitly selecting password
    const user = await User.findOne({
      $or: [{ email: sanitizedLogin }, { username: sanitizedLogin }]
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please check your username/email and password.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please check your username/email and password.'
      });
    }

    if (user.isDeleted) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated.'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked by an administrator.'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account is suspended. Please contact LifeLink support.'
      });
    }

    // Update presence
    user.isOnline = true;
    user.lastActive = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id, user.role);

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: user.toJSON()
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Authenticate administrator
 * POST /api/auth/admin-login
 */
async function adminLogin(req, res, next) {
  try {
    const { loginId, password } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your administrator username/email and password.'
      });
    }

    const sanitizedLogin = loginId.toLowerCase().trim();

    const user = await User.findOne({
      $or: [{ email: sanitizedLogin }, { username: sanitizedLogin }]
    }).select('+password');

    if (!user) {
      await logAdminAction({
        adminId: null,
        adminName: sanitizedLogin,
        action: 'ADMIN_LOGIN_FAILED',
        targetType: 'User',
        reason: 'User not found during admin login',
        details: { loginId: sanitizedLogin },
        ipAddress: req.ip
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid administrative credentials.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await logAdminAction({
        adminId: user._id,
        adminName: user.name,
        action: 'ADMIN_LOGIN_FAILED',
        targetType: 'User',
        targetId: user._id,
        reason: 'Incorrect password during admin login',
        details: { loginId: sanitizedLogin },
        ipAddress: req.ip
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid administrative credentials.'
      });
    }

    // Role check: non-admin accounts MUST be strictly rejected with HTTP 403
    if (user.role !== 'admin') {
      await logAdminAction({
        adminId: user._id,
        adminName: user.name,
        action: 'ADMIN_ACCESS_DENIED',
        targetType: 'User',
        targetId: user._id,
        reason: 'Non-admin user attempted admin login',
        details: { username: user.username, role: user.role },
        ipAddress: req.ip
      });
      return res.status(403).json({
        success: false,
        message: 'Access denied. Administrator privileges required.'
      });
    }

    if (user.isDeleted) {
      return res.status(403).json({
        success: false,
        message: 'This administrative account has been deactivated.'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'This administrative account is blocked.'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'This administrative account is suspended.'
      });
    }

    // Update presence
    user.isOnline = true;
    user.lastActive = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id, user.role);

    await logAdminAction({
      adminId: user._id,
      adminName: user.name,
      action: 'ADMIN_LOGIN_SUCCESS',
      targetType: 'User',
      targetId: user._id,
      reason: 'Administrator logged in successfully',
      details: { username: user.username },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      message: 'Administrator authentication successful.',
      token,
      user: user.toJSON()
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get current authenticated user details
 * GET /api/auth/me
 */
async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      success: true,
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Log out user & update presence
 * POST /api/auth/logout
 */
async function logout(req, res, next) {
  try {
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        isOnline: false,
        lastActive: new Date()
      });
    }
    res.json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  adminLogin,
  getMe,
  logout
};
