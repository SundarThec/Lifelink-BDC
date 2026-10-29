/**
 * LifeLink Geocoding & Address Suggestions
 * Connects to /api/v1/geocode with offline gazetteer priority and online OSM fallback.
 */

let debounceTimer = null;
let latestSearchSeq = 0;
const clientGeocodeCache = new Map();

/**
 * Fetch address suggestions as user types
 * @param {string} query
 * @param {Function} callback (results: Array, error?: Error)
 */
function fetchAddressSuggestions(query, callback) {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    if (callback) callback([]);
    return;
  }

  const cleanQuery = query.trim();
  const currentSeq = ++latestSearchSeq;
  clearTimeout(debounceTimer);

  // Check client memory cache
  const cacheKey = cleanQuery.toLowerCase();
  if (clientGeocodeCache.has(cacheKey)) {
    if (callback) callback(clientGeocodeCache.get(cacheKey));
    return;
  }

  debounceTimer = setTimeout(async () => {
    try {
      const url = `/api/v1/geocode?q=${encodeURIComponent(cleanQuery)}&limit=6`;
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`Geocoding HTTP error ${res.status}`);
      }

      const data = await res.json();

      // Discard response if a newer query was issued in the meantime
      if (currentSeq !== latestSearchSeq) return;

      const rawItems = data.data || data.results || [];
      const normalized = rawItems
        .map((r) => {
          const lat = parseFloat(r.lat !== undefined ? r.lat : r.coordinates && r.coordinates[1]);
          const lon = parseFloat(r.lon !== undefined ? r.lon : r.coordinates && r.coordinates[0]);
          if (isNaN(lat) || isNaN(lon)) return null;

          const isHospital =
            r.type === 'hospital' ||
            r.matchType === 'hospital' ||
            /hospital|clinic|medical/i.test(r.name || r.displayName || '');

          return {
            display_name: r.displayName || r.name || (r.nearest && r.nearest.name) || '',
            name: r.name || (r.nearest && r.nearest.name) || '',
            city: r.city || (r.nearest && r.nearest.city) || '',
            state: r.state || (r.nearest && r.nearest.state) || '',
            type: r.type || 'place',
            lat,
            lon,
            coordinates: [lon, lat], // [lon, lat]
            isApproximate: r.isApproximate !== undefined ? Boolean(r.isApproximate) : !isHospital,
            matchType: isHospital ? 'hospital' : (r.matchType || (r.type === 'city' ? 'locality' : 'place')),
            source: r.source || 'gazetteer'
          };
        })
        .filter(Boolean);

      clientGeocodeCache.set(cacheKey, normalized);

      if (callback) callback(normalized);
    } catch (err) {
      console.warn('Geocoding suggestion notice:', err.message);
      if (currentSeq === latestSearchSeq && callback) {
        callback([], err);
      }
    }
  }, 250);
}

/**
 * Single-shot address resolution to coordinates
 * @param {string} query
 * @returns {Promise<object>} Result object with status, coordinates, and match metadata
 */
async function resolveAddressCoordinates(query) {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return { success: false, reason: 'INVALID_QUERY', allResults: [] };
  }

  const cleanQuery = query.trim().replace(/\s+/g, ' ');
  const cacheKey = cleanQuery.toLowerCase();

  // Fast-path: Reuse client memory cache if available
  if (clientGeocodeCache.has(cacheKey)) {
    const cachedItems = clientGeocodeCache.get(cacheKey);
    if (cachedItems && cachedItems.length > 0) {
      const wantsHospital = /hospital|clinic|dispensary|medical|care|health|doctor|gh|gmch/i.test(cleanQuery);
      let top = cachedItems[0];
      if (wantsHospital) {
        const hospitalMatch = cachedItems.find((m) => m.matchType === 'hospital');
        if (hospitalMatch) top = hospitalMatch;
      } else {
        const localityMatch = cachedItems.find((m) => m.matchType === 'locality' || m.type === 'city');
        if (localityMatch && (!top || top.matchType === 'hospital')) {
          top = localityMatch;
        }
      }
      return {
        success: true,
        name: top.name,
        displayName: top.displayName || top.display_name,
        city: top.city,
        state: top.state,
        coordinates: [top.lon, top.lat],
        lat: top.lat,
        lon: top.lon,
        isApproximate: top.isApproximate,
        matchType: top.matchType,
        totalMatches: cachedItems.length,
        allResults: cachedItems,
        source: top.source
      };
    }
  }

  try {
    const url = `/api/v1/geocode?q=${encodeURIComponent(cleanQuery)}&limit=5`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      return { success: false, reason: 'NETWORK_ERROR', status: res.status, allResults: [] };
    }

    const data = await res.json();
    const rawItems = data.data || data.results || [];
    if (!rawItems || rawItems.length === 0) {
      return { success: false, reason: 'NOT_FOUND', allResults: [] };
    }

    const normalized = rawItems
      .map((r) => {
        const lat = parseFloat(r.lat !== undefined ? r.lat : r.coordinates && r.coordinates[1]);
        const lon = parseFloat(r.lon !== undefined ? r.lon : r.coordinates && r.coordinates[0]);
        if (isNaN(lat) || isNaN(lon)) return null;

        const isHospital =
          r.type === 'hospital' ||
          r.matchType === 'hospital' ||
          /hospital|clinic|medical|dispensary/i.test(r.name || r.displayName || '');

        return {
          name: r.name || '',
          displayName: r.displayName || r.name || '',
          city: r.city || '',
          state: r.state || '',
          coordinates: [lon, lat],
          lat,
          lon,
          isApproximate: r.isApproximate !== undefined ? Boolean(r.isApproximate) : !isHospital,
          matchType: isHospital ? 'hospital' : (r.matchType || (r.type === 'city' ? 'locality' : 'place')),
          source: r.source || 'gazetteer'
        };
      })
      .filter(Boolean);

    if (normalized.length === 0) {
      return { success: false, reason: 'NOT_FOUND', allResults: [] };
    }

    clientGeocodeCache.set(cacheKey, normalized);

    // If query mentions hospital or medical, prefer a hospital match if present; else prefer locality
    const wantsHospital = /hospital|clinic|dispensary|medical|care|health|doctor|gh|gmch/i.test(cleanQuery);
    let top = normalized[0];
    if (wantsHospital) {
      const hospitalMatch = normalized.find((m) => m.matchType === 'hospital');
      if (hospitalMatch) top = hospitalMatch;
    } else {
      const localityMatch = normalized.find((m) => m.matchType === 'locality' || m.type === 'city');
      if (localityMatch && (!top || top.matchType === 'hospital')) {
        top = localityMatch;
      }
    }

    return {
      success: true,
      name: top.name,
      displayName: top.displayName,
      city: top.city,
      state: top.state,
      coordinates: [top.lon, top.lat],
      lat: top.lat,
      lon: top.lon,
      isApproximate: top.isApproximate,
      matchType: top.matchType,
      totalMatches: normalized.length,
      allResults: normalized,
      source: top.source
    };
  } catch (err) {
    console.warn('Address resolution failed:', err.message);
    return { success: false, reason: 'NETWORK_ERROR', message: err.message, allResults: [] };
  }
}

/**
 * Reverse geocode latitude and longitude to human address
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string>}
 */
async function reverseGeocodeCoordinates(lat, lon) {
  try {
    const numLat = parseFloat(lat);
    const numLon = parseFloat(lon);
    if (isNaN(numLat) || isNaN(numLon)) {
      return '';
    }

    const url = `/api/v1/geocode/reverse?lat=${numLat}&lon=${numLon}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!res.ok) throw new Error('Reverse geocoding failed');
    const data = await res.json();
    const resultObj = data.data || data.result;
    return resultObj?.displayName || `${numLat.toFixed(4)}, ${numLon.toFixed(4)}`;
  } catch (err) {
    console.warn('Reverse geocode fallback:', err.message);
    return `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
  }
}
