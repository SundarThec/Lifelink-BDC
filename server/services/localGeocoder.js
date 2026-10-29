const fs = require('fs');
const path = require('path');
const { calculateHaversineDistance } = require('../utils/geoDistance');

let gazetteerFeatures = [];
let isInitialized = false;

// In-memory caches to respect OSM rate limits and guarantee instant subsequent lookups
const forwardCache = new Map();
const reverseCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let lastOsmRequestTime = 0;
const OSM_MIN_INTERVAL_MS = 800; // 800ms throttle between external OSM calls

/**
 * Load and index the local GeoJSON gazetteer
 */
function loadGazetteer() {
  if (isInitialized) return;

  const gazetteerPath = process.env.GEOJSON_GAZETTEER_PATH
    ? path.resolve(process.env.GEOJSON_GAZETTEER_PATH)
    : path.join(__dirname, '..', '..', 'data', 'gazetteer.geojson');

  try {
    if (fs.existsSync(gazetteerPath)) {
      const raw = fs.readFileSync(gazetteerPath, 'utf8');
      const parsed = JSON.parse(raw);
      gazetteerFeatures = (parsed.features || []).filter(
        (f) => f.geometry && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length === 2
      );
      console.log(`📍 Loaded ${gazetteerFeatures.length} offline gazetteer locations from ${path.basename(gazetteerPath)}`);
    } else {
      console.warn(`⚠️ Offline gazetteer file not found at: ${gazetteerPath}. Using internal fallback.`);
      gazetteerFeatures = [];
    }
  } catch (err) {
    console.error(`❌ Failed to parse offline gazetteer (${err.message}).`);
    gazetteerFeatures = [];
  }

  isInitialized = true;
}

// Auto-initialize on first require
loadGazetteer();

/**
 * Forward Geocoding: match text queries to geographic coordinates in local gazetteer
 * @param {string} query
 * @param {number} limit
 * @returns {Array<object>}
 */
function forwardGeocode(query, limit = 6) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }

  loadGazetteer();

  const cleanQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const queryTokens = cleanQuery.split(/[\s,]+/).filter((t) => t.length > 0);
  const queryMentionsHospital = /hospital|clinic|medical|dispensary|care|health|doctor|gh|gmch/i.test(cleanQuery);

  const scoredResults = [];

  for (const feat of gazetteerFeatures) {
    const props = feat.properties || {};
    const coords = feat.geometry.coordinates; // [lng, lat]
    const name = (props.name || '').toLowerCase();
    const city = (props.city || '').toLowerCase();
    const address = (props.address || '').toLowerCase();
    const district = (props.district || '').toLowerCase();
    const type = (props.type || '').toLowerCase();

    let score = 0;

    // Exact name match
    if (name === cleanQuery) {
      score += 120;
    } else if (name.startsWith(cleanQuery)) {
      score += 70;
    } else if (name.includes(cleanQuery)) {
      score += 45;
    }

    // Token matching across name, city, and address
    let tokensMatched = 0;
    for (const token of queryTokens) {
      if (name.includes(token)) {
        score += 25;
        tokensMatched++;
      } else if (city.includes(token)) {
        score += 15;
        tokensMatched++;
      } else if (address.includes(token) || district.includes(token)) {
        score += 10;
        tokensMatched++;
      } else if (type.includes(token)) {
        score += 8;
        tokensMatched++;
      }
    }

    // Boost score if multiple tokens matched
    if (queryTokens.length > 1 && tokensMatched >= queryTokens.length) {
      score += 30;
    }

    if (score > 0) {
      // Prioritize hospital when query specifies hospital; prioritize locality when query specifies town/city
      if (type === 'hospital' && queryMentionsHospital) {
        score += 40;
      } else if ((type === 'city' || type === 'locality' || type === 'town') && !queryMentionsHospital) {
        score += 40;
      }

      const displayName = props.address || `${props.name}, ${props.city || ''} (${props.type || 'Location'})`;
      const isHospital = type === 'hospital';
      scoredResults.push({
        name: props.name,
        displayName,
        type: props.type || 'place',
        city: props.city || '',
        state: props.state || '',
        address: props.address || '',
        phone: props.phone || '',
        coordinates: coords, // [lng, lat]
        lon: coords[0],
        lat: coords[1],
        score,
        isApproximate: !isHospital,
        matchType: isHospital ? 'hospital' : (type === 'city' ? 'locality' : 'place'),
        source: 'gazetteer'
      });
    }
  }

  // Sort by score descending and return top matches
  scoredResults.sort((a, b) => b.score - a.score);
  return scoredResults.slice(0, limit);
}

/**
 * Reverse Geocoding: lookup nearest human-readable location for coordinates
 * @param {number} lat
 * @param {number} lon
 * @returns {object}
 */
function reverseGeocode(lat, lon) {
  loadGazetteer();

  const numLat = parseFloat(lat);
  const numLon = parseFloat(lon);

  if (isNaN(numLat) || isNaN(numLon)) {
    return {
      displayName: 'Unknown Location',
      coordinates: [numLon, numLat],
      distanceKm: 0
    };
  }

  if (gazetteerFeatures.length === 0) {
    return {
      displayName: `Coordinates [${numLat.toFixed(4)}, ${numLon.toFixed(4)}]`,
      coordinates: [numLon, numLat],
      distanceKm: 0
    };
  }

  let closestFeature = null;
  let minDistanceKm = Infinity;

  for (const feat of gazetteerFeatures) {
    const [fLon, fLat] = feat.geometry.coordinates;
    const dist = calculateHaversineDistance([numLon, numLat], [fLon, fLat]);
    if (dist < minDistanceKm) {
      minDistanceKm = dist;
      closestFeature = feat;
    }
  }

  const props = closestFeature ? closestFeature.properties : {};
  let displayName;

  if (minDistanceKm < 0.25) {
    displayName = props.address || `${props.name}, ${props.city}`;
  } else if (minDistanceKm < 5.0) {
    displayName = `${props.name}, ${props.city} (~${minDistanceKm.toFixed(1)} km)`;
  } else if (minDistanceKm < 25.0) {
    displayName = `Near ${props.name}, ${props.city} (~${minDistanceKm.toFixed(1)} km away)`;
  } else {
    // If nearest landmark is >25 km away, do NOT falsely label distant locations with an unrelated city
    displayName = `Coordinates [${numLat.toFixed(4)}, ${numLon.toFixed(4)}]`;
  }

  return {
    displayName,
    nearest: minDistanceKm < 25.0 ? props : { name: displayName },
    distanceKm: Math.round(minDistanceKm * 100) / 100,
    coordinates: [numLon, numLat],
    lat: numLat,
    lon: numLon
  };
}

/**
 * Async Forward Geocoding: checks local gazetteer first, then queries OSM Nominatim for wider geographic coverage
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
async function forwardGeocodeAsync(query, limit = 6) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return [];
  }

  const cleanQuery = query.trim().replace(/\s+/g, ' ');
  const cacheKey = `${cleanQuery.toLowerCase()}__${limit}`;
  const cached = forwardCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }

  const localResults = forwardGeocode(cleanQuery, limit);

  // If we have a very strong local match (exact or high confidence), return it immediately
  if (localResults.length > 0 && localResults[0].score >= 70) {
    forwardCache.set(cacheKey, { results: localResults, timestamp: Date.now() });
    return localResults;
  }

  // Otherwise, query OpenStreetMap Nominatim for state-wide / national / global geocoding
  try {
    // Polite throttle for OSM Nominatim API (max ~1 req / 800ms)
    const now = Date.now();
    const elapsed = now - lastOsmRequestTime;
    if (elapsed < OSM_MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, OSM_MIN_INTERVAL_MS - elapsed));
    }
    lastOsmRequestTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);

    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      cleanQuery
    )}&format=json&limit=${limit}&addressdetails=1&countrycodes=in`;

    const response = await fetch(nominatimUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'LifeLinkBloodApp/1.1 (contact: info@lifelink.org; blood-donation-network)',
        'Accept-Language': 'en'
      }
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const osmResults = data.map((item) => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          const addr = item.address || {};
          const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district || '';
          const state = addr.state || '';
          const name = item.name || (item.display_name ? item.display_name.split(',')[0].trim() : cleanQuery);

          const isHospital =
            item.type === 'hospital' ||
            item.class === 'amenity' ||
            item.class === 'healthcare' ||
            item.class === 'building' ||
            /hospital|clinic|medical|dispensary/i.test(name);

          const isApproximate =
            !isHospital &&
            (item.class === 'boundary' ||
              item.type === 'administrative' ||
              item.type === 'city' ||
              item.type === 'town' ||
              item.type === 'village' ||
              item.type === 'locality' ||
              item.type === 'state_district' ||
              item.type === 'county' ||
              item.addresstype === 'city' ||
              item.addresstype === 'state_district' ||
              item.addresstype === 'county');

          return {
            name,
            displayName: item.display_name,
            type: item.type || item.class || 'place',
            city,
            state,
            address: item.display_name,
            phone: '',
            coordinates: [lon, lat], // GeoJSON [lng, lat]
            lon,
            lat,
            score: isHospital ? 110 : 95,
            isApproximate: Boolean(isApproximate),
            matchType: isHospital ? 'hospital' : (isApproximate ? 'locality' : 'place'),
            source: 'osm'
          };
        });

        // If query mentions hospital, prioritize hospital matches; otherwise prioritize locality
        const wantsHospital = /hospital|clinic|dispensary|medical|care|health|doctor|gh|gmch/i.test(cleanQuery);
        if (wantsHospital) {
          osmResults.sort((a, b) => (b.matchType === 'hospital' ? 1 : 0) - (a.matchType === 'hospital' ? 1 : 0));
        } else {
          osmResults.sort((a, b) => (b.matchType === 'locality' ? 1 : 0) - (a.matchType === 'locality' ? 1 : 0));
        }

        const sliced = osmResults.slice(0, limit);
        forwardCache.set(cacheKey, { results: sliced, timestamp: Date.now() });
        return sliced;
      }
    }
  } catch (err) {
    // Graceful fallback to local results if external network request fails or times out
    console.warn(`External geocoding notice (${err.message}). Using local gazetteer results.`);
  }

  // Cache fallback results briefly (30s)
  forwardCache.set(cacheKey, { results: localResults, timestamp: Date.now() });
  return localResults;
}

/**
 * Async Reverse Geocoding: checks local gazetteer first, then queries OSM Nominatim for wider geographic coverage
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object>}
 */
async function reverseGeocodeAsync(lat, lon) {
  const numLat = parseFloat(lat);
  const numLon = parseFloat(lon);

  if (isNaN(numLat) || isNaN(numLon)) {
    return {
      displayName: 'Unknown Location',
      coordinates: [numLon, numLat],
      distanceKm: 0
    };
  }

  const cacheKey = `${numLat.toFixed(4)},${numLon.toFixed(4)}`;
  const cached = reverseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  const localResult = reverseGeocode(lat, lon);

  // If the coordinate is within 5km of a local gazetteer location, use local result
  if (localResult && localResult.distanceKm < 5.0) {
    reverseCache.set(cacheKey, { result: localResult, timestamp: Date.now() });
    return localResult;
  }

  // Otherwise, query OpenStreetMap Nominatim reverse endpoint
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${numLat}&lon=${numLon}&format=json&addressdetails=1`;

    const response = await fetch(nominatimUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'LifeLinkBloodApp/1.1 (contact: info@lifelink.org; blood-donation-network)',
        'Accept-Language': 'en'
      }
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (data && data.display_name) {
        const addr = data.address || {};
        const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district || '';
        const state = addr.state || '';
        const name = data.name || (data.display_name ? data.display_name.split(',')[0].trim() : 'Location');

        const resultObj = {
          displayName: data.display_name,
          nearest: {
            name,
            city,
            state,
            country: addr.country || 'India'
          },
          distanceKm: 0,
          coordinates: [numLon, numLat],
          lat: numLat,
          lon: numLon,
          source: 'osm'
        };

        reverseCache.set(cacheKey, { result: resultObj, timestamp: Date.now() });
        return resultObj;
      }
    }
  } catch (err) {
    console.warn(`External reverse geocoding notice (${err.message}). Using local fallback.`);
  }

  reverseCache.set(cacheKey, { result: localResult, timestamp: Date.now() });
  return localResult;
}

module.exports = {
  forwardGeocode,
  reverseGeocode,
  forwardGeocodeAsync,
  reverseGeocodeAsync,
  loadGazetteer
};
