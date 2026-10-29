/**
 * LifeLink Accurate Geographic Distance & Radius Engine
 * Implements standard Haversine formula on spherical coordinates.
 */

// Earth's mean radius in kilometers (WGS-84 standard: 6371.0088 km)
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Converts degrees to radians
 * @param {number} degrees
 * @returns {number} radians
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates accurate great-circle distance between two geographic points using Haversine formula.
 * Coordinates are passed as GeoJSON [longitude, latitude] or as separate (lat, lng) pairs.
 * 
 * @param {number[]} pointA - [longitude, latitude] of point A
 * @param {number[]} pointB - [longitude, latitude] of point B
 * @returns {number} Distance in kilometers
 */
function calculateHaversineDistance(pointA, pointB) {
  if (!pointA || !pointB || !Array.isArray(pointA) || !Array.isArray(pointB)) {
    throw new Error('Valid [longitude, latitude] coordinate pairs are required.');
  }

  const [lng1, lat1] = pointA;
  const [lng2, lat2] = pointB;

  if (
    typeof lat1 !== 'number' || typeof lng1 !== 'number' ||
    typeof lat2 !== 'number' || typeof lng2 !== 'number' ||
    isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)
  ) {
    throw new Error('Coordinates must be valid numbers.');
  }

  const dLat = toRadians(lat2 - lat1);
  let diffLng = lng2 - lng1;
  while (diffLng > 180) diffLng -= 360;
  while (diffLng < -180) diffLng += 360;
  const dLng = toRadians(diffLng);

  const radLat1 = toRadians(lat1);
  const radLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Determines whether a target coordinate falls strictly within a specified circular radius.
 * Center = [centerLng, centerLat]
 * Target = [targetLng, targetLat]
 * Radius = user's specified radius in km
 *
 * Boundary condition:
 * Distance <= radiusKm -> true (e.g. 15.00 km is eligible)
 * Distance > radiusKm  -> false (e.g. 15.01 km is NOT eligible)
 *
 * @param {number[]} centerCoords - [longitude, latitude]
 * @param {number[]} targetCoords - [longitude, latitude]
 * @param {number} radiusKm - radius in kilometers
 * @returns {{ isWithin: boolean, distanceKm: number, error?: string }}
 */
function checkCircularRadius(centerCoords, targetCoords, radiusKm) {
  if (typeof radiusKm !== 'number' || isNaN(radiusKm) || radiusKm < 0) {
    return { isWithin: false, distanceKm: null, error: 'Invalid or negative radius' };
  }
  const distanceKm = calculateHaversineDistance(centerCoords, targetCoords);
  // Precision to 3 decimal places to prevent floating point rounding artifacts
  const roundedDist = Math.round(distanceKm * 1000) / 1000;
  const isWithin = roundedDist <= radiusKm;
  return {
    isWithin,
    distanceKm: Math.round(distanceKm * 100) / 100 // 2 decimal places for display
  };
}

/**
 * Validates GeoJSON Point coordinates: [longitude, latitude]
 * @param {any} coords
 * @returns {boolean}
 */
function isValidCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 2) return false;
  const [lng, lat] = coords;
  return (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    !isNaN(lng) &&
    !isNaN(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * Format distance in km or meters for human-readable display
 * @param {number} distanceKm
 * @returns {string} e.g. "4.2 km" or "850 m"
 */
function formatDistance(distanceKm) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

module.exports = {
  EARTH_RADIUS_KM,
  calculateHaversineDistance,
  checkCircularRadius,
  isValidCoordinates,
  formatDistance
};
