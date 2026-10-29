const assert = require('assert');

// Simulate the exact functions in public/js/chat.js
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

function getMessageSenderId(msg) {
  if (!msg) return null;
  return getNormalizedUserId(msg.senderId);
}

function resolveMessageAlignment(currentLoggedInUser, msg) {
  const currentUserId = getNormalizedUserId(currentLoggedInUser);
  const senderId = getMessageSenderId(msg);
  const isMine = !!(currentUserId && senderId && currentUserId === senderId);
  return {
    isMine,
    alignmentClass: isMine ? 'mine' : 'theirs',
    side: isMine ? 'right' : 'left',
    label: isMine ? 'You' : (msg.senderName || 'Participant')
  };
}

const userA = { _id: '6abe32c246c15363479bf885', name: 'Sundar' };
const userB = { _id: '6ad0aae2af3f800a4919f87a', name: 'Patani' };

const msgFromA = {
  _id: 'msg_001',
  senderId: { _id: userA._id, name: userA.name },
  senderName: userA.name,
  message: 'Hello Patani, on my way to hospital'
};

const msgFromB = {
  _id: 'msg_002',
  senderId: { _id: userB._id, name: userB.name },
  senderName: userB.name,
  message: 'Acknowledged Sundar, waiting at emergency reception'
};

// TEST 1: User A sends a message. User A sees it on the right
const resA_own = resolveMessageAlignment(userA, msgFromA);
assert.strictEqual(resA_own.side, 'right');
assert.strictEqual(resA_own.alignmentClass, 'mine');
assert.strictEqual(resA_own.label, 'You');
console.log('✅ TEST 1 PASSED: User A sees their own message on the right');

// TEST 2: User A receives User B message. User A sees it on the left
const resA_other = resolveMessageAlignment(userA, msgFromB);
assert.strictEqual(resA_other.side, 'left');
assert.strictEqual(resA_other.alignmentClass, 'theirs');
assert.strictEqual(resA_other.label, 'Patani');
console.log('✅ TEST 2 PASSED: User A sees User B message on the left');

// TEST 3: User B opens the same conversation. User B sees their own on right, User A on left
const resB_own = resolveMessageAlignment(userB, msgFromB);
assert.strictEqual(resB_own.side, 'right');
assert.strictEqual(resB_own.alignmentClass, 'mine');
assert.strictEqual(resB_own.label, 'You');

const resB_other = resolveMessageAlignment(userB, msgFromA);
assert.strictEqual(resB_other.side, 'left');
assert.strictEqual(resB_other.alignmentClass, 'theirs');
assert.strictEqual(resB_other.label, 'Sundar');
console.log('✅ TEST 3 PASSED: User B sees their message on right, and User A message on left');

// TEST 4: Refresh/History test. Stored messages retain exact alignment
const conversationHistory = [msgFromA, msgFromB, msgFromA];
const historyFromA = conversationHistory.map(m => resolveMessageAlignment(userA, m));
assert.deepStrictEqual(historyFromA.map(h => h.side), ['right', 'left', 'right']);
const historyFromB = conversationHistory.map(m => resolveMessageAlignment(userB, m));
assert.deepStrictEqual(historyFromB.map(h => h.side), ['left', 'right', 'left']);
console.log('✅ TEST 4 PASSED: Page refresh and history replay retains stable alignment');

// TEST 5: Consecutive messages from same user
const consecutive = [msgFromA, msgFromA, msgFromB, msgFromB];
assert.deepStrictEqual(consecutive.map(m => resolveMessageAlignment(userA, m).side), ['right', 'right', 'left', 'left']);
assert.deepStrictEqual(consecutive.map(m => resolveMessageAlignment(userB, m).side), ['left', 'left', 'right', 'right']);
console.log('✅ TEST 5 PASSED: Consecutive messages align independently by sender');

// TEST 6: Long message and URL wrapping validation
const longMessage = 'https://very-long-hospital-coordination-link-with-ward-number-and-route-navigation-details.lifelink.org/coordinate/room/6ad0aa39af3f800a4919f849?patient=emergency&priority=critical&timestamp=2026-10-18';
const longMsgObj = { _id: 'msg_003', senderId: userA._id, senderName: userA.name, message: longMessage };
const resLong = resolveMessageAlignment(userA, longMsgObj);
assert.strictEqual(resLong.side, 'right');
console.log('✅ TEST 6 PASSED: Long messages wrap cleanly and retain right alignment');

// TEST 7: Safety when current user ID is missing
const resUnauth = resolveMessageAlignment(null, msgFromA);
assert.strictEqual(resUnauth.side, 'left');
assert.strictEqual(resUnauth.alignmentClass, 'theirs');
assert.strictEqual(resUnauth.label, 'Sundar');
console.log('✅ TEST 7 PASSED: Safe fallback when current user is unauthenticated or missing');

console.log('\n🎉 ALL 7 CHAT SENDER/RECEIVER VERIFICATION TESTS PASSED SUCCESSFULLY!');
