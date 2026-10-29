const express = require('express');
const router = express.Router();
const {
  findDonors,
  toggleAvailability,
  updateProfile,
  getUserProfile
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { uploadAvatar } = require('../middleware/uploadMiddleware');

// Public or semi-protected donor search
router.get('/find-donors', (req, res, next) => {
  // Optional auth: if token is present, populate req.user, otherwise continue
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return protect(req, res, next);
  }
  next();
}, findDonors);

router.patch('/availability', protect, toggleAvailability);
router.put('/profile', protect, uploadAvatar.single('avatar'), updateProfile);
router.get('/:id', getUserProfile);

module.exports = router;
