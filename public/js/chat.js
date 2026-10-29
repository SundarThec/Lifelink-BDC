/**
 * LifeLink Real-Time Coordination Chat Client
 */

let activeChatRequestId = null;
let currentChatRequest = null;

function initSocketConnection() {
  if (window.appSocket) return;

  const token = typeof api !== 'undefined' && api.getToken ? api.getToken() : null;
  window.appSocket = io({
    auth: { token }
  });

  window.appSocket.on('connect', () => {
    console.log('🔌 [Socket.IO] Connected to LifeLink real-time server.');
    const user = api.getCurrentUser();
    const currentToken = api.getToken();
    if (user && user._id && currentToken) {
      window.appSocket.emit('register_user', { userId: user._id, token: currentToken });
    }
  });

  // Listen for live emergency blood alerts targeted at current user
  window.appSocket.on('new_emergency_request', (data) => {
    showToast(`🚨 URGENT: ${data.notification.title}`, 'error');
    if (typeof loadNotifications === 'function') {
      loadNotifications();
    }
    if (typeof loadDashboardFeed === 'function') {
      loadDashboardFeed();
    }
  });

  // Listen for request accepted events
  window.appSocket.on('request_accepted', (data) => {
    showToast(`🎉 Donor Confirmed: ${data.notification.title}`, 'success');
    if (typeof loadNotifications === 'function') {
      loadNotifications();
    }
    if (typeof loadDashboardFeed === 'function') {
      loadDashboardFeed();
    }
  });

  // Listen for automatic radius escalation events
  window.appSocket.on('radius_escalated', (data) => {
    showToast(`📡 Emergency broadcast expanded to ${data.searchRadiusKm} km!`, 'info');
    if (typeof loadDashboardFeed === 'function') {
      loadDashboardFeed();
    }
    if (typeof loadNotifications === 'function') {
      loadNotifications();
    }
  });

  // Listen for administrative broadcast announcements
  window.appSocket.on('admin_broadcast', (data) => {
    showToast(`📢 Announcement: ${data.title}`, 'info');
    if (typeof loadNotifications === 'function') {
      loadNotifications();
    }
  });

  // Listen for real-time notification email delivery updates
  window.appSocket.on('notification_updated', (data) => {
    if (typeof loadNotifications === 'function') {
      loadNotifications();
    }
  });

  // Listen for immediate administrative account blocking
  window.appSocket.on('account_blocked', (data) => {
    alert(data.message || 'Your account has been blocked by an administrator.');
    if (typeof logoutUser === 'function') {
      logoutUser();
    } else {
      localStorage.clear();
      window.location.reload();
    }
  });

  // Listen for incoming chat messages
  window.appSocket.on('new_message', (msg) => {
    if (activeChatRequestId && msg.requestId === activeChatRequestId) {
      appendChatMessage(msg);
      scrollChatToBottom();
    } else {
      // Increment chat badge
      const badge = document.getElementById('chatBadge');
      if (badge) {
        badge.classList.remove('hidden');
        badge.textContent = (parseInt(badge.textContent || '0', 10) + 1).toString();
      }
    }
  });
}

/**
 * Load active conversations for current user
 */
async function loadChatConversations() {
  if (!api.getToken()) return;

  try {
    const data = await api.get('/chat/conversations');
    renderConversationsList(data.conversations);
  } catch (err) {
    console.warn('Error loading chat conversations:', err.message);
  }
}

/**
 * Extract normalized hex string representation of an ID or User object
 * Safely handles ObjectIds, strings, BSON types, and nested user structures.
 */
function getNormalizedUserId(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') {
    if (typeof val.toHexString === 'function') {
      return val.toHexString().trim();
    }
    if (val._bsontype === 'ObjectID' || val._bsontype === 'ObjectId') {
      return val.toString().trim();
    }
    if (val['$oid']) {
      return String(val['$oid']).trim();
    }
    if (val._id && val._id !== val) {
      return getNormalizedUserId(val._id);
    }
    if (val.id && val.id !== val) {
      return getNormalizedUserId(val.id);
    }
    if (typeof val.toString === 'function') {
      const str = val.toString();
      if (str !== '[object Object]') return str.trim();
    }
  }
  return null;
}

/**
 * Get current authenticated user's normalized ID
 */
function getCurrentLoggedInUserId() {
  const user = api.getCurrentUser();
  if (!user) return null;
  return getNormalizedUserId(user);
}

/**
 * Get sender ID from a message object safely
 */
function getMessageSenderId(msg) {
  if (!msg) return null;
  return getNormalizedUserId(msg.senderId);
}

function renderConversationsList(conversations = []) {
  const container = document.getElementById('conversationsList');
  if (!container) return;

  if (conversations.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem; color: #64748b;">
        <i class="fa-solid fa-comments fa-2x" style="opacity: 0.4; margin-bottom: 0.5rem;"></i>
        <p style="font-size: 13px;">No active coordination rooms. Coordination opens once a donor accepts a blood request.</p>
      </div>
    `;
    return;
  }

  const currentUserId = getCurrentLoggedInUserId();

  container.innerHTML = conversations.map((c) => {
    const req = c.request;
    const reqSenderId = getNormalizedUserId(req.requesterId);
    const isRequester = !!(currentUserId && reqSenderId && reqSenderId === currentUserId);
    const counterpart = isRequester
      ? (req.acceptedDonors[0]?.donorId?.name || 'Assigned Donor')
      : (req.requesterId?.name || 'Requester');

    const lastMsgText = c.lastMessage ? escapeHTML(c.lastMessage.message) : 'Channel opened. Coordinate hospital arrival...';
    const isActive = activeChatRequestId === req._id ? 'active' : '';

    return `
      <div class="conv-item ${isActive}" onclick="openChatRoom('${req._id}')">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="conv-title">${escapeHTML(req.patientName)} (${req.requiredBloodGroup})</span>
          <span style="font-size: 10px; font-weight: 700; color: #dc2626; text-transform: uppercase;">${req.urgency}</span>
        </div>
        <div class="conv-meta"><i class="fa-solid fa-user-doctor"></i> With: ${escapeHTML(counterpart)}</div>
        <div class="conv-last-msg">${lastMsgText}</div>
      </div>
    `;
  }).join('');
}

/**
 * Open specific request chat room
 */
async function openChatRoom(requestId) {
  activeChatRequestId = requestId;

  const emptyState = document.getElementById('emptyChatState');
  const activeUi = document.getElementById('chatActiveUi');
  if (emptyState) emptyState.classList.add('hidden');
  if (activeUi) activeUi.classList.remove('hidden');

  if (window.appSocket) {
    window.appSocket.emit('join_room', requestId);
  }

  try {
    const data = await api.get(`/chat/${requestId}`);
    currentChatRequest = data.request;

    // Set header meta
    const pName = document.getElementById('chatPatientName');
    const bGroup = document.getElementById('chatBloodGroup');
    const hName = document.getElementById('chatHospitalName');

    if (pName) pName.textContent = data.request.patientName;
    if (bGroup) bGroup.textContent = data.request.requiredBloodGroup;
    if (hName) hName.textContent = `Hospital: ${data.request.hospitalName}`;

    renderChatMessages(data.messages);
    loadChatConversations(); // refresh active highlight
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderChatMessages(messages = []) {
  const stream = document.getElementById('messagesStream');
  if (!stream) return;

  const currentUserId = getCurrentLoggedInUserId();

  stream.innerHTML = messages.map((m) => {
    const senderId = getMessageSenderId(m);
    const isMine = !!(currentUserId && senderId && currentUserId === senderId);
    const alignmentClass = isMine ? 'mine' : 'theirs';
    const senderLabel = isMine ? 'You' : escapeHTML(m.senderName || 'Participant');
    const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgId = m._id ? String(m._id) : '';

    return `
      <div class="msg-bubble-wrap ${alignmentClass}" ${msgId ? `data-msg-id="${escapeHTML(msgId)}"` : ''}>
        <span class="msg-sender-name">${senderLabel}</span>
        <div class="msg-bubble">${escapeHTML(m.message)}</div>
        <span class="msg-time">${timeStr}</span>
      </div>
    `;
  }).join('');

  scrollChatToBottom();
}

function appendChatMessage(msg) {
  const stream = document.getElementById('messagesStream');
  if (!stream || !msg) return;

  const msgId = msg._id ? String(msg._id) : null;
  // Prevent duplicate rendering if already in DOM
  if (msgId && stream.querySelector(`[data-msg-id="${msgId}"]`)) {
    return;
  }

  const currentUserId = getCurrentLoggedInUserId();
  const senderId = getMessageSenderId(msg);
  const isMine = !!(currentUserId && senderId && currentUserId === senderId);
  const alignmentClass = isMine ? 'mine' : 'theirs';
  const senderLabel = isMine ? 'You' : escapeHTML(msg.senderName || 'Participant');
  const timeStr = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgDiv = document.createElement('div');
  msgDiv.className = `msg-bubble-wrap ${alignmentClass}`;
  if (msgId) msgDiv.setAttribute('data-msg-id', msgId);

  msgDiv.innerHTML = `
    <span class="msg-sender-name">${senderLabel}</span>
    <div class="msg-bubble">${escapeHTML(msg.message)}</div>
    <span class="msg-time">${timeStr}</span>
  `;

  stream.appendChild(msgDiv);
}

function scrollChatToBottom() {
  const stream = document.getElementById('messagesStream');
  if (stream) {
    stream.scrollTop = stream.scrollHeight;
  }
}

/**
 * Send chat message form submission
 */
async function handleSendChatMessage(e) {
  e.preventDefault();
  if (!activeChatRequestId) return;

  const input = document.getElementById('chatMessageInput');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  try {
    input.value = '';
    const res = await api.post(`/chat/${activeChatRequestId}`, { message: text });
    if (res && res.message) {
      appendChatMessage(res.message);
      scrollChatToBottom();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
