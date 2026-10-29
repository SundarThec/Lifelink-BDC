/**
 * LifeLink Donor Search & Advanced Filtering Automated Test Suite
 *
 * Verifies:
 * 1. Search donor by exact and partial email address
 * 2. Search donor by username (with and without '@' prefix)
 * 3. Search donor by full name
 * 4. Automatic extraction and geolocation of location words in search query (e.g. "Indiranagar", "donor Indiranagar")
 * 5. Blood group filtering accuracy
 * 6. Availability status filtering accuracy (availableOnly: true, false/all, unavailable)
 * 7. Online status filtering accuracy (onlineOnly: true, false)
 * 8. Search radius boundary enforcement and nationwide search (radiusKm: '0' / no radius limit)
 * 9. Distance calculation accuracy and ascending distance ordering
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../server/config/db');
const User = require('../server/models/User');
const { findDonors } = require('../server/controllers/userController');

// Mock Express req, res, next
function createMockReqRes(query = {}, user = null) {
  const req = {
    query,
    user
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  const next = (err) => {
    if (err) throw err;
  };

  return {
    req,
    res,
    next,
    getStatusCode: () => statusCode,
    getData: () => responseData
  };
}

async function runSearchFilterTests() {
  console.log('================================================================');
  console.log('🧪 LIFELINK DONOR SEARCH & ADVANCED FILTER VERIFICATION SUITE');
  console.log('================================================================');

  await connectDB();

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // Seed test donors in Indiranagar, Koramangala, and Whitefield
  // Indiranagar: [77.6412, 12.9719]
  // Koramangala: [77.6245, 12.9352] (~4.5 km away)
  // Whitefield: [77.7499, 12.9698] (~12 km away)
  const indiranagarCoords = [77.6412, 12.9719];
  const koramangalaCoords = [77.6245, 12.9352];
  const whitefieldCoords = [77.7499, 12.9698];

  const prefix = `s${Date.now().toString().slice(-6)}`;

  const donorA = await User.create({
    name: 'Aarav Sharma',
    username: `${prefix}_aarav`,
    email: `${prefix}_aarav.sharma@domain.org`,
    phone: '+919876543201',
    password: 'Password123!',
    bloodGroup: 'A+',
    age: 28,
    isAvailableToDonate: true,
    isOnline: true,
    status: 'active',
    location: { type: 'Point', coordinates: indiranagarCoords },
    city: 'Bangalore',
    address: 'Indiranagar 100ft Road'
  });

  const donorB = await User.create({
    name: 'Bhavna Patel',
    username: `${prefix}_bhavna`,
    email: `${prefix}_bhavna.patel@charity.net`,
    phone: '+919876543202',
    password: 'Password123!',
    bloodGroup: 'O+',
    age: 32,
    isAvailableToDonate: false, // In cooldown
    isOnline: false,
    status: 'active',
    location: { type: 'Point', coordinates: indiranagarCoords },
    city: 'Bangalore',
    address: 'Indiranagar 12th Main'
  });

  const donorC = await User.create({
    name: 'Chetan Kumar',
    username: `${prefix}_chetan`,
    email: `${prefix}_chetan.k@medical.org`,
    phone: '+919876543203',
    password: 'Password123!',
    bloodGroup: 'A+',
    age: 35,
    isAvailableToDonate: true,
    isOnline: false,
    status: 'active',
    location: { type: 'Point', coordinates: koramangalaCoords },
    city: 'Bangalore',
    address: 'Koramangala 4th Block'
  });

  const donorD = await User.create({
    name: 'Divya Rao',
    username: `${prefix}_divya`,
    email: `${prefix}_divya.rao@techcorp.in`,
    phone: '+919876543204',
    password: 'Password123!',
    bloodGroup: 'B-',
    age: 26,
    isAvailableToDonate: true,
    isOnline: true,
    status: 'active',
    location: { type: 'Point', coordinates: whitefieldCoords },
    city: 'Bangalore',
    address: 'Whitefield Main Road'
  });

  try {
    // TEST 1: Search donor by email address
    await test('Feature: Search donor by email address', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: `${prefix}_aarav.sharma@domain.org`,
        radiusKm: '0',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.count, 1);
      assert.strictEqual(data.donors[0].email, donorA.email);
      assert.strictEqual(data.donors[0].name, 'Aarav Sharma');
    });

    // TEST 2: Search donor by partial email domain
    await test('Feature: Search donor by partial email text', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: 'bhavna.patel@charity',
        radiusKm: '0',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.count, 1);
      assert.strictEqual(data.donors[0].username, donorB.username);
    });

    // TEST 3: Search donor by username with @ prefix
    await test('Feature: Search donor by @username', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: `@${prefix}_chetan`,
        radiusKm: '0',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.count, 1);
      assert.strictEqual(data.donors[0].username, donorC.username);
    });

    // TEST 4: Search donor by username without @ prefix
    await test('Feature: Search donor by username without @', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: `${prefix}_divya`,
        radiusKm: '0',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.count, 1);
      assert.strictEqual(data.donors[0].name, 'Divya Rao');
    });

    // TEST 5: Location word extraction in search query (e.g. "Indiranagar")
    await test('Feature: Location word extraction in search query', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: 'Indiranagar',
        radiusKm: '2',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      // Resolved center should be Indiranagar
      assert.ok(data.resolvedLocationName && data.resolvedLocationName.includes('Indiranagar'));
      // Should find donors in Indiranagar (Aarav and Bhavna)
      const matchingIds = data.donors.map((d) => String(d._id));
      assert.ok(matchingIds.includes(String(donorA._id)));
      assert.ok(matchingIds.includes(String(donorB._id)));
      // Chetan in Koramangala is 4.5km away, should NOT be in 2km radius
      assert.ok(!matchingIds.includes(String(donorC._id)));
    });

    // TEST 6: Combined search: donor name + location word ("Aarav Indiranagar")
    await test('Feature: Search query with donor name and location word', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: 'Aarav Indiranagar',
        radiusKm: '5',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.count, 1);
      assert.strictEqual(data.donors[0].name, 'Aarav Sharma');
      assert.ok(data.resolvedLocationName && data.resolvedLocationName.includes('Indiranagar'));
    });

    // TEST 7: Availability status filter: availableOnly = true
    await test('Accuracy: availableOnly: true returns ONLY available donors', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: prefix,
        radiusKm: '0',
        availableOnly: 'true'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      for (const d of data.donors) {
        assert.strictEqual(d.isAvailableToDonate, true);
      }
      // Bhavna (isAvailableToDonate: false) must NOT be present
      const usernames = data.donors.map((d) => d.username);
      assert.ok(!usernames.includes(donorB.username));
      assert.ok(usernames.includes(donorA.username));
    });

    // TEST 8: Availability status filter: availableOnly = false (all donors)
    await test('Accuracy: availableOnly: false returns both available and unavailable donors', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: prefix,
        radiusKm: '0',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      const usernames = data.donors.map((d) => d.username);
      assert.ok(usernames.includes(donorA.username)); // available
      assert.ok(usernames.includes(donorB.username)); // unavailable
    });

    // TEST 9: Availability status filter: availableOnly = 'unavailable'
    await test('Accuracy: availableOnly: unavailable returns ONLY donors in cooldown/unavailable', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: prefix,
        radiusKm: '0',
        availableOnly: 'unavailable'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      for (const d of data.donors) {
        assert.strictEqual(d.isAvailableToDonate, false);
      }
      const usernames = data.donors.map((d) => d.username);
      assert.ok(usernames.includes(donorB.username));
      assert.ok(!usernames.includes(donorA.username));
    });

    // TEST 10: Online status filter: onlineOnly = true
    await test('Accuracy: onlineOnly: true returns ONLY online donors', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: prefix,
        radiusKm: '0',
        availableOnly: 'false',
        onlineOnly: 'true'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      for (const d of data.donors) {
        assert.strictEqual(d.isOnline, true);
      }
      const usernames = data.donors.map((d) => d.username);
      assert.ok(usernames.includes(donorA.username)); // online: true
      assert.ok(!usernames.includes(donorC.username)); // online: false
    });

    // TEST 11: Blood group filter: bloodGroup = 'A+'
    await test('Accuracy: bloodGroup filter matches exact group', async () => {
      const { req, res, next, getData } = createMockReqRes({
        search: prefix,
        bloodGroup: 'A+',
        radiusKm: '0',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      for (const d of data.donors) {
        assert.strictEqual(d.bloodGroup, 'A+');
      }
      const usernames = data.donors.map((d) => d.username);
      assert.ok(usernames.includes(donorA.username));
      assert.ok(usernames.includes(donorC.username));
      assert.ok(!usernames.includes(donorB.username)); // O+
      assert.ok(!usernames.includes(donorD.username)); // B-
    });

    // TEST 12: Location entrance: locationText = 'Koramangala'
    await test('Feature: locationText input resolves coordinates and center', async () => {
      const { req, res, next, getData } = createMockReqRes({
        locationText: 'Koramangala',
        radiusKm: '3',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      assert.ok(data.resolvedLocationName && data.resolvedLocationName.includes('Koramangala'));
      const usernames = data.donors.map((d) => d.username);
      // Chetan in Koramangala (dist ~0 km)
      assert.ok(usernames.includes(donorC.username));
      // Whitefield (~12 km) must be excluded from 3 km radius
      assert.ok(!usernames.includes(donorD.username));
    });

    // TEST 13: Distance ordering: donors sorted ascending by distance
    await test('Accuracy: Donors sorted strictly by distance ascending', async () => {
      const { req, res, next, getData } = createMockReqRes({
        centerLng: indiranagarCoords[0],
        centerLat: indiranagarCoords[1],
        search: prefix,
        radiusKm: '25',
        availableOnly: 'false'
      });
      await findDonors(req, res, next);
      const data = getData();
      assert.strictEqual(data.success, true);
      assert.ok(data.donors.length >= 3);
      for (let i = 0; i < data.donors.length - 1; i++) {
        assert.ok(
          data.donors[i].distanceKm <= data.donors[i + 1].distanceKm,
          `Donor at index ${i} (${data.donors[i].distanceKm} km) should be <= index ${i + 1} (${data.donors[i + 1].distanceKm} km)`
        );
      }
    });

  } finally {
    // Clean up test donors
    await User.deleteMany({ _id: { $in: [donorA._id, donorB._id, donorC._id, donorD._id] } });
    await disconnectDB();
  }

  console.log('================================================================');
  console.log(`🏁 DONOR SEARCH & FILTER VERIFICATION SUMMARY:`);
  console.log(`   TOTAL TESTS:  ${passed + failed}`);
  console.log(`   PASSED TESTS: ${passed}`);
  console.log(`   FAILED TESTS: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSearchFilterTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
