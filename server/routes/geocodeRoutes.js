const express = require('express');
const router = express.Router();
const { forwardGeocodeAsync, reverseGeocodeAsync } = require('../services/localGeocoder');

/**
 * Forward Geocoding: text address autocomplete
 * GET /api/v1/geocode?q=query
 */
async function handleForwardGeocode(req, res) {
  try {
    const query = req.query.q || req.query.query || '';
    const limit = parseInt(req.query.limit || '6', 10);

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.json({
        success: true,
        query: '',
        count: 0,
        results: [],
        features: [],
        data: []
      });
    }

    const results = await forwardGeocodeAsync(query, limit);

    // Format GeoJSON features for compatibility
    const features = results.map((r) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: r.coordinates
      },
      properties: {
        name: r.name,
        displayName: r.displayName,
        isApproximate: r.isApproximate
      }
    }));

    res.json({
      success: true,
      query,
      count: results.length,
      results,
      features,
      data: results,
      meta: {
        hasMatches: results.length > 0,
        topMatch: results[0] || null,
        isApproximate: results.length > 0 ? Boolean(results[0].isApproximate) : false
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Geocoding error: ${err.message}`,
      results: [],
      features: [],
      data: []
    });
  }
}

router.get('/', handleForwardGeocode);
router.get('/forward', handleForwardGeocode);

/**
 * Reverse Geocoding: lookup address by coordinates
 * GET /api/v1/geocode/reverse?lat=12.97&lon=77.59
 */
router.get('/reverse', async (req, res) => {
  try {
    const lat = req.query.lat || req.query.latitude;
    const lon = req.query.lon || req.query.lng || req.query.longitude;

    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        message: 'Both lat and lon parameters are required for reverse geocoding.'
      });
    }

    const result = await reverseGeocodeAsync(lat, lon);

    res.json({
      success: true,
      result,
      data: result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Reverse geocoding error: ${err.message}`
    });
  }
});

module.exports = router;
