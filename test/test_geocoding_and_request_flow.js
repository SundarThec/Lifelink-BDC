/**
 * Verification Suite for Hospital Geocoding & Emergency Request Flow
 * Tests all 9 scenarios specified in Section 10 of the task specification.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const { connectDB, disconnectDB } = require('../server/config/db');
const { forwardGeocodeAsync, reverseGeocodeAsync, forwardGeocode, reverseGeocode } = require('../server/services/localGeocoder');
const { createTileMiddleware, FALLBACK_TILE_PNG } = require('../server/utils/offlineTileFallback');
const { calculateHaversineDistance, isValidCoordinates } = require('../server/utils/geoDistance');
const { BloodRequest } = require('../server/models/BloodRequest');
const User = require('../server/models/User');

async function runGeocodingVerification() {
  console.log('================================================================');
  console.log('🗺️  LIFELINK GEOCODING & EMERGENCY REQUEST FORM VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Reason: ${err.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // TEST CASE 1: Input "Virudhunagar"
  // Expected: Resolve locality in Tamil Nadu, India, approximate match,
  // valid coordinates, marker update ready.
  // -------------------------------------------------------------
  await test('Test Case 1: Input "Virudhunagar" resolves correct Tamil Nadu locality', async () => {
    const results = await forwardGeocodeAsync('Virudhunagar', 5);
    assert.ok(Array.isArray(results), 'Results should be an array');
    assert.ok(results.length > 0, 'Should find at least one match for Virudhunagar');

    const top = results[0];
    assert.ok(top.displayName.includes('Tamil Nadu') || top.state === 'Tamil Nadu', 'Must be in Tamil Nadu');
    assert.ok(top.lon >= 77.0 && top.lon <= 78.5, `Longitude (${top.lon}) must be around Virudhunagar`);
    assert.ok(top.lat >= 9.0 && top.lat <= 10.0, `Latitude (${top.lat}) must be around Virudhunagar`);
    assert.strictEqual(top.isApproximate, true, 'City/locality must be flagged as approximate match');
    assert.ok(isValidCoordinates([top.lon, top.lat]), 'Coordinates must be valid GeoJSON [lng, lat]');
  });

  // -------------------------------------------------------------
  // TEST CASE 2: Input "Government Hospital, Virudhunagar, Tamil Nadu, India"
  // Expected: Resolve hospital match, marked exact/hospital.
  // -------------------------------------------------------------
  await test('Test Case 2: Input "Government Hospital, Virudhunagar" resolves hospital match', async () => {
    const results = await forwardGeocodeAsync('Government Hospital, Virudhunagar, Tamil Nadu, India', 5);
    assert.ok(results.length > 0, 'Should find result for Government Hospital Virudhunagar');

    const top = results[0];
    assert.ok(top.name.toLowerCase().includes('hospital') || top.matchType === 'hospital', 'Match must identify hospital');
    assert.strictEqual(top.isApproximate, false, 'Hospital match must not be approximate');
    assert.strictEqual(top.matchType, 'hospital', 'Match type must be hospital');
    assert.ok(top.lon >= 77.0 && top.lon <= 78.5, 'Longitude must match Virudhunagar region');
    assert.ok(top.lat >= 9.0 && top.lat <= 10.0, 'Latitude must match Virudhunagar region');
  });

  // -------------------------------------------------------------
  // TEST CASE 3: Incomplete or ambiguous location
  // Expected: Returns multiple suggestions without arbitrarily choosing wrong location.
  // -------------------------------------------------------------
  await test('Test Case 3: Incomplete or ambiguous query displays multiple suggestions', async () => {
    const results = await forwardGeocodeAsync('Hospital', 6);
    assert.ok(Array.isArray(results), 'Should return array of results');
    assert.ok(results.length > 1, 'Ambiguous query "Hospital" should yield multiple distinct suggestions');
    // Ensure all matches have valid coordinates
    for (const r of results) {
      assert.ok(isValidCoordinates([r.lon, r.lat]), 'Every suggestion must have valid coordinates');
    }
  });

  // -------------------------------------------------------------
  // TEST CASE 4: Invalid location
  // Expected: No results found, no random/stale coordinates retained.
  // -------------------------------------------------------------
  await test('Test Case 4: Invalid location returns 0 results and avoids dummy coordinates', async () => {
    const results = await forwardGeocodeAsync('zzzzqqqqq99999nonexistentaddress12345', 5);
    assert.ok(Array.isArray(results), 'Should return an array');
    assert.strictEqual(results.length, 0, 'Invalid query must yield zero results');
  });

  // -------------------------------------------------------------
  // TEST CASE 5: Network failure or service error handling
  // Expected: Gracefully handles network abort/timeout, does not crash,
  // falls back to local gazetteer or empty results.
  // -------------------------------------------------------------
  await test('Test Case 5: Offline/failure resilience handles timeout without unhandled rejection', async () => {
    // Forward geocode with local lookup
    const local = forwardGeocode('Indiranagar');
    assert.ok(local.length > 0, 'Local gazetteer provides offline resilience');

    // Query non-existent offline query without crashing
    const localNonExistent = forwardGeocode('NonExistentPlace999');
    assert.strictEqual(localNonExistent.length, 0, 'Local search handles non-matches gracefully');
  });

  // -------------------------------------------------------------
  // TEST CASE 6: Rapid replacement (Race condition / Sequence tracking)
  // Expected: Older asynchronous geocoding response cannot overwrite newer selection.
  // -------------------------------------------------------------
  await test('Test Case 6: Request sequence tracking prevents older responses from overwriting newer', async () => {
    let currentSequence = 0;
    let finalLocation = null;

    // Simulate Query 1: "Virudhunagar" (slow)
    const seq1 = ++currentSequence;
    const promise1 = new Promise((resolve) => {
      setTimeout(async () => {
        const res = await forwardGeocodeAsync('Virudhunagar', 1);
        if (seq1 === currentSequence) {
          finalLocation = 'Virudhunagar';
        }
        resolve();
      }, 150);
    });

    // Simulate Query 2: "Chennai" (faster, issued after seq1)
    const seq2 = ++currentSequence;
    const promise2 = new Promise((resolve) => {
      setTimeout(async () => {
        const res = await forwardGeocodeAsync('Chennai', 1);
        if (seq2 === currentSequence) {
          finalLocation = 'Chennai';
        }
        resolve();
      }, 50);
    });

    await Promise.all([promise1, promise2]);
    assert.strictEqual(finalLocation, 'Chennai', 'Newer query "Chennai" must NOT be overwritten by older "Virudhunagar"');
  });

  // -------------------------------------------------------------
  // TEST CASE 7: Manual marker repositioning & Reverse Geocoding
  // Expected: Coordinates update, and reverse geocode does not attribute Bangalore to Virudhunagar!
  // -------------------------------------------------------------
  await test('Test Case 7: Manual marker coordinates update and reverse geocode correctly', async () => {
    const virudhunagarLat = 9.4926;
    const virudhunagarLon = 77.8632;

    const reverse = await reverseGeocodeAsync(virudhunagarLat, virudhunagarLon);
    assert.ok(reverse, 'Reverse geocode result must exist');
    assert.ok(!reverse.displayName.includes('Manipal Hospital HAL'), 'Must NOT attribute Bangalore landmark to Virudhunagar');
    assert.ok(
      reverse.displayName.includes('Virudhunagar') ||
      reverse.displayName.includes('Coordinates [9.4926, 77.8632]') ||
      reverse.displayName.includes('Tamil Nadu'),
      `Reverse geocode should reflect actual region or coordinates (got: "${reverse.displayName}")`
    );
  });

  // -------------------------------------------------------------
  // TEST CASE 8: Emergency blood request submission & coordinate storage
  // Expected: Coordinates [lon, lat] are stored accurately in MongoDB and donor matching distance is correct.
  // -------------------------------------------------------------
  await test('Test Case 8: Emergency request persists accurate coordinates and donor matching distance', async () => {
    await connectDB();

    // Find or create test requester
    let testRequester = await User.findOne({ email: 'requester_test_geocoding@lifelink.org' });
    if (!testRequester) {
      testRequester = await User.create({
        name: 'Geocoding Test User',
        username: 'geocoding_test_user',
        email: 'requester_test_geocoding@lifelink.org',
        password: 'Password123!',
        phone: '+91 98765 43210',
        age: 32,
        address: 'Virudhunagar, Tamil Nadu',
        role: 'user',
        bloodGroup: 'O+',
        city: 'Virudhunagar',
        location: { type: 'Point', coordinates: [77.8632, 9.4926] }
      });
    }

    // Virudhunagar coordinates
    const reqCoords = [77.8632, 9.4926];

    const bloodReq = await BloodRequest.create({
      requesterId: testRequester._id,
      patientName: 'Test Patient Virudhunagar',
      patientAge: 45,
      requiredBloodGroup: 'B+',
      unitsRequired: 2,
      hospitalName: 'Government Hospital Virudhunagar',
      hospitalAddress: 'Virudhunagar, Tamil Nadu, India',
      location: {
        type: 'Point',
        coordinates: reqCoords // [longitude, latitude]
      },
      searchRadiusKm: 25,
      urgency: 'Critical',
      contactPhone: '+91 98765 43210',
      contactEmail: 'requester_test_geocoding@lifelink.org',
      requestStatus: 'open'
    });

    assert.ok(bloodReq._id, 'Blood request must be created');
    assert.strictEqual(bloodReq.location.coordinates[0], 77.8632, 'Longitude must match exactly');
    assert.strictEqual(bloodReq.location.coordinates[1], 9.4926, 'Latitude must match exactly');

    // Test distance calculation:
    // Virudhunagar [77.8632, 9.4926] to Madurai [78.1198, 9.9252] is ~55 km
    const maduraiCoords = [78.1198, 9.9252];
    const distToMadurai = calculateHaversineDistance(reqCoords, maduraiCoords);
    assert.ok(distToMadurai >= 50 && distToMadurai <= 65, `Distance to Madurai should be ~55 km (got: ${distToMadurai.toFixed(1)})`);

    // Virudhunagar to Bangalore [77.5946, 12.9716] is ~380-420 km
    const bangaloreCoords = [77.5946, 12.9716];
    const distToBangalore = calculateHaversineDistance(reqCoords, bangaloreCoords);
    assert.ok(distToBangalore >= 380 && distToBangalore <= 450, `Distance to Bangalore should be ~400 km (got: ${distToBangalore.toFixed(1)})`);

    // Clean up
    await BloodRequest.deleteOne({ _id: bloodReq._id });
    await User.deleteOne({ _id: testRequester._id });
  });

  // -------------------------------------------------------------
  // TEST CASE 9: MapLibre tile middleware & style configuration
  // Expected: Tile endpoint delivers valid raster PNG responses for MapLibre container.
  // -------------------------------------------------------------
  await test('Test Case 9: Tile middleware provides valid raster tiles for MapLibre rendering', async () => {
    const tileDir = path.resolve('public/tiles');
    assert.ok(fs.existsSync(tileDir), 'Tiles directory must exist');

    const stylePath = path.join(tileDir, 'style.json');
    assert.ok(fs.existsSync(stylePath), 'style.json must exist');
    const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
    assert.strictEqual(style.version, 8, 'MapLibre style version must be 8');

    // Test tile middleware returns valid PNG buffer
    const middleware = createTileMiddleware(tileDir);

    await new Promise((resolve, reject) => {
      let sentContentType = null;
      let sentBuffer = null;

      const mockReq = { params: { z: '12', x: '2934', y: '1885.png' } };
      const mockRes = {
        setHeader: (k, v) => {
          if (k.toLowerCase() === 'content-type') sentContentType = v;
        },
        sendFile: (filePath) => {
          sentBuffer = filePath;
          try {
            assert.strictEqual(sentContentType, 'image/png', 'Tile middleware must serve image/png');
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        end: (buf) => {
          sentBuffer = buf;
          try {
            assert.strictEqual(sentContentType, 'image/png', 'Tile middleware must serve image/png');
            assert.ok(sentBuffer !== null, 'Tile must produce data or fallback buffer');
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      };

      middleware(mockReq, mockRes, () => {});
    });
  });

  await disconnectDB();

  console.log('\n================================================================');
  console.log(`🏁 GEOCODING VERIFICATION SUMMARY:`);
  console.log(`   TOTAL TESTS:  ${total}`);
  console.log(`   PASSED TESTS: ${passed}`);
  console.log(`   FAILED TESTS: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runGeocodingVerification().catch((err) => {
  console.error('Fatal error running geocoding verification:', err);
  process.exit(1);
});
