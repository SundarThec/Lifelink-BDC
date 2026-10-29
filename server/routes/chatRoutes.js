const express = require('express');
const router = express.Router();
const {
  getChatHistory,
  sendMessage,
  getActiveConversations
} = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/conversations', getActiveConversations);
router.get('/:requestId', getChatHistory);
router.post('/:requestId', sendMessage);

module.exports = router;
