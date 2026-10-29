const ChatMessage = require('../models/ChatMessage');
const { BloodRequest } = require('../models/BloodRequest');

/**
 * Helper to verify user is authorized for request coordination
 */
async function verifyChatAccess(requestId, userId, userRole) {
  const request = await BloodRequest.findById(requestId)
    .populate('requesterId', 'name username phone avatar')
    .populate('acceptedDonors.donorId', 'name username phone avatar');

  if (!request) {
    return { authorized: false, status: 404, message: 'Request not found' };
  }

  // Admin always has access for moderation
  if (userRole === 'admin') {
    return { authorized: true, request };
  }

  const isRequester = request.requesterId && request.requesterId._id.toString() === userId.toString();
  const isAcceptedDonor = request.acceptedDonors.some(
    (d) => d.donorId && d.donorId._id.toString() === userId.toString()
  );

  if (!isRequester && !isAcceptedDonor) {
    return {
      authorized: false,
      status: 403,
      message: 'Access Denied: You are not an authorized participant in this coordination channel.'
    };
  }

  return { authorized: true, request, isRequester, isAcceptedDonor };
}

/**
 * Get chat history for an accepted request
 * GET /api/chat/:requestId
 */
async function getChatHistory(req, res, next) {
  try {
    const { requestId } = req.params;
    const access = await verifyChatAccess(requestId, req.user._id, req.user.role);

    if (!access.authorized) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const messages = await ChatMessage.find({ requestId })
      .sort({ createdAt: 1 })
      .populate('senderId', 'name username avatar')
      .lean();

    res.json({
      success: true,
      request: access.request,
      messages
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Send a chat message in request channel
 * POST /api/chat/:requestId
 */
async function sendMessage(req, res, next) {
  try {
    const { requestId } = req.params;
    const { message } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, message: 'Message content cannot be empty.' });
    }

    const access = await verifyChatAccess(requestId, req.user._id, req.user.role);
    if (!access.authorized) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    if (access.request.requestStatus === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'This emergency request has been cancelled. New messages cannot be sent.'
      });
    }

    const chatMsg = await ChatMessage.create({
      requestId,
      senderId: req.user._id,
      senderName: req.user.name,
      message: message.trim(),
      readBy: [req.user._id]
    });

    const populatedMsg = await ChatMessage.findById(chatMsg._id)
      .populate('senderId', 'name username avatar')
      .lean();

    // Broadcast via Socket.IO room
    const io = req.app.get('io');
    if (io) {
      io.to(`request_${requestId}`).emit('new_message', populatedMsg);
    }

    res.status(201).json({
      success: true,
      message: populatedMsg
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get all active coordination conversations for current user
 * GET /api/chat/conversations
 */
async function getActiveConversations(req, res, next) {
  try {
    const userId = req.user._id;

    // Requests where user is requester OR in acceptedDonors, and status is accepted or fulfilled
    const requests = await BloodRequest.find({
      $or: [{ requesterId: userId }, { 'acceptedDonors.donorId': userId }],
      requestStatus: { $in: ['accepted', 'fulfilled'] }
    })
      .populate('requesterId', 'name username avatar bloodGroup phone')
      .populate('acceptedDonors.donorId', 'name username avatar bloodGroup phone')
      .sort({ updatedAt: -1 })
      .lean();

    const conversations = [];

    for (const reqItem of requests) {
      const lastMessage = await ChatMessage.findOne({ requestId: reqItem._id })
        .sort({ createdAt: -1 })
        .lean();

      conversations.push({
        requestId: reqItem._id,
        request: reqItem,
        lastMessage
      });
    }

    res.json({
      success: true,
      conversations
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getChatHistory,
  sendMessage,
  getActiveConversations,
  verifyChatAccess
};
