const User = require('../models/User');
const { calculateHaversineDistance, formatDistance, isValidCoordinates } = require('../utils/geoDistance');
const { getCompatibleDonorBloodGroups, BLOOD_GROUPS } = require('../utils/bloodCompatibility');
const { forwardGeocode } = require('../services/localGeocoder');

/**
 * Search and find compatible/nearby blood donors
 * GET /api/users/find-donors
 */
async function findDonors(req, res, next) {
  try {
    let {
      centerLng,
      centerLat,
      radiusKm,
      bloodGroup,
      recipientBloodGroup,
      compatibleOnly,
      availableOnly,
      onlineOnly,
      search,
      locationText,
      noRadiusLimit,
      minAge,
      maxAge
    } = req.query;

    // 1. Resolve Center Location: Coordinates, Location text geocoding, word extraction, or user location
    let center = null;
    let resolvedLocationName = null;

    if (centerLng !== undefined && centerLat !== undefined && centerLng !== '' && centerLat !== '') {
      const numLng = parseFloat(centerLng);
      const numLat = parseFloat(centerLat);
      if (isNaN(numLng) || isNaN(numLat) || numLng < -180 || numLng > 180 || numLat < -90 || numLat > 90) {
        return res.status(400).json({
          success: false,
          message: 'Invalid center coordinates. Must be valid [longitude, latitude] within geographical bounds.'
        });
      }
      center = [numLng, numLat];
    }

    // If center coordinates not explicitly provided, try geocoding locationText if provided
    if (!center && locationText && locationText.trim() !== '') {
      const geoMatches = forwardGeocode(locationText.trim(), 1);
      if (geoMatches.length > 0 && geoMatches[0].coordinates) {
        center = geoMatches[0].coordinates;
        resolvedLocationName = geoMatches[0].displayName || geoMatches[0].name;
      }
    }

    // If still no center, check if the search string mentions a known location word in the local gazetteer
    let detectedLocationWord = null;
    const isEmailOrHandle = search && (search.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search.trim()));
    if (!center && search && search.trim() !== '' && !isEmailOrHandle) {
      const searchWords = search.trim().split(/[\s,]+/);
      for (const word of searchWords) {
        if (word.length >= 3) {
          const wordMatches = forwardGeocode(word, 1);
          if (wordMatches.length > 0 && wordMatches[0].coordinates) {
            center = wordMatches[0].coordinates;
            resolvedLocationName = wordMatches[0].displayName || wordMatches[0].name;
            detectedLocationWord = word;
            break;
          }
        }
      }
    }

    // If still no center, fall back to current authenticated user's location
    if (!center && req.user && req.user.location && isValidCoordinates(req.user.location.coordinates)) {
      center = req.user.location.coordinates;
      resolvedLocationName = req.user.city || req.user.address || null;
    }

    // Fallback default coordinates (Bangalore center) if still unassigned
    const isGlobalOrSearchOnly = (noRadiusLimit === 'true' || noRadiusLimit === true || radiusKm === '0' || radiusKm === 'all' || radiusKm === 'any');
    if (!center) {
      center = [77.5946, 12.9716]; // [lng, lat]
    }

    // 2. Radius Validation
    let parsedRadius = 25;
    let applyRadiusFilter = !isGlobalOrSearchOnly;

    if (radiusKm !== undefined && radiusKm !== null && String(radiusKm).trim() !== '') {
      if (radiusKm === '0' || radiusKm === 'all' || radiusKm === 'any') {
        applyRadiusFilter = false;
        parsedRadius = 0;
      } else {
        parsedRadius = Number(radiusKm);
        if (isNaN(parsedRadius) || parsedRadius < 0) {
          return res.status(400).json({
            success: false,
            message: 'Invalid search radius. Radius must be a non-negative number in kilometers.'
          });
        }
        if (parsedRadius > 500) {
          return res.status(400).json({
            success: false,
            message: 'Search radius cannot exceed 500 km.'
          });
        }
      }
    }

    // 3. Build MongoDB filter for eligible active donors
    const query = {
      status: 'active',
      isBlocked: { $ne: true },
      isDeleted: { $ne: true }
    };

    // Exclude current logged in user from their own donor search
    if (req.user) {
      query._id = { $ne: req.user._id };
    }

    // Filter by availability:
    // If availableOnly is explicitly 'true' (checked), filter only available donors.
    // If availableOnly is 'false' or 'all' (unchecked), show all donors (available + unavailable).
    // Default if omitted: true.
    if (availableOnly === 'true' || availableOnly === true) {
      query.isAvailableToDonate = true;
    } else if (availableOnly === 'unavailable') {
      query.isAvailableToDonate = false;
    } else if (availableOnly === 'false' || availableOnly === false || availableOnly === 'all') {
      // Do not restrict availability (show all)
    } else if (availableOnly === undefined && !search) {
      query.isAvailableToDonate = true;
    }

    // Filter by online status:
    // If onlineOnly is checked, filter strictly to isOnline: true.
    if (onlineOnly === 'true' || onlineOnly === true) {
      query.isOnline = true;
    }

    // Filter by age
    if (minAge || maxAge) {
      query.age = {};
      if (minAge) query.age.$gte = parseInt(minAge, 10);
      if (maxAge) query.age.$lte = parseInt(maxAge, 10);
    }

    // 4. Blood Compatibility & Blood Group Filtering
    const targetRecipientGroup = recipientBloodGroup || ((compatibleOnly === 'true' || compatibleOnly === true) && req.user ? req.user.bloodGroup : null);
    if (targetRecipientGroup) {
      if (!BLOOD_GROUPS.includes(targetRecipientGroup)) {
        return res.status(400).json({
          success: false,
          message: `Invalid recipient blood group. Must be one of: ${BLOOD_GROUPS.join(', ')}`
        });
      }
      const compatibleGroups = getCompatibleDonorBloodGroups(targetRecipientGroup);
      query.bloodGroup = { $in: compatibleGroups };
    } else if (bloodGroup && bloodGroup.trim() !== '') {
      if (!BLOOD_GROUPS.includes(bloodGroup)) {
        return res.status(400).json({
          success: false,
          message: `Invalid blood group. Must be one of: ${BLOOD_GROUPS.join(', ')}`
        });
      }
      query.bloodGroup = bloodGroup;
    }

    // 5. New Feature: Search Donor by Name, Username, or Email Address (plus locality/address)
    if (search && search.trim() !== '') {
      const cleanSearch = search.trim();
      let nonLocationSearch = cleanSearch;
      if (detectedLocationWord) {
        nonLocationSearch = cleanSearch.replace(new RegExp('\\b' + detectedLocationWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '').trim();
      }

      if (nonLocationSearch !== '') {
        const escaped = nonLocationSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escaped, 'i');
        const cleanUsername = nonLocationSearch.replace(/^@/, '');
        const usernameRegex = new RegExp(cleanUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        query.$or = [
          { name: searchRegex },
          { username: usernameRegex },
          { email: searchRegex },
          { city: searchRegex },
          { address: searchRegex }
        ];
      } else if (!applyRadiusFilter) {
        // If query was purely a location word and radius is disabled, match city or address
        const escaped = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escaped, 'i');
        query.$or = [
          { city: searchRegex },
          { address: searchRegex }
        ];
      }
    }

    // 6. Spatial pre-filter using MongoDB $geoWithin $centerSphere (if radius filter is active)
    if (applyRadiusFilter && center && isValidCoordinates(center)) {
      const effectiveRadiusKm = parsedRadius === 0 ? 0.05 : parsedRadius;
      const radiusRadians = (effectiveRadiusKm * 1.05) / 6371.0088; // 5% buffer for spherical approximation
      query.location = {
        $geoWithin: {
          $centerSphere: [center, radiusRadians]
        }
      };
    }

    const candidates = await User.find(query)
      .select('-password')
      .lean();

    // 7. Mathematically exact Haversine verification and strict radius boundary
    const processedDonors = [];
    for (const donor of candidates) {
      if (donor.location && isValidCoordinates(donor.location.coordinates)) {
        let distKm = 0;
        if (center && isValidCoordinates(center)) {
          distKm = calculateHaversineDistance(center, donor.location.coordinates);
          distKm = Math.round(distKm * 100) / 100;
        }

        // Strict circular boundary rule if applyRadiusFilter is active
        const isWithin = !applyRadiusFilter
          || (parsedRadius === 0 ? distKm <= 0.01 : distKm <= (parsedRadius + 0.001));

        if (isWithin) {
          processedDonors.push({
            ...donor,
            distanceKm: distKm,
            formattedDistance: formatDistance(distKm)
          });
        }
      } else if (!applyRadiusFilter) {
        processedDonors.push({
          ...donor,
          distanceKm: 0,
          formattedDistance: 'Location N/A'
        });
      }
    }

    // 8. Sort by distance ascending (nearest donors first)
    processedDonors.sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({
      success: true,
      count: processedDonors.length,
      center,
      radiusKm: parsedRadius,
      appliedRadius: applyRadiusFilter ? parsedRadius : null,
      resolvedLocationName,
      donors: processedDonors
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Toggle user's availability to donate blood
 * PATCH /api/users/availability
 */
async function toggleAvailability(req, res, next) {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isAvailableToDonate = !user.isAvailableToDonate;
    await user.save();

    res.json({
      success: true,
      message: `Availability updated to: ${user.isAvailableToDonate ? 'Available' : 'Unavailable'}`,
      isAvailableToDonate: user.isAvailableToDonate
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update user profile details
 * PUT /api/users/profile
 */
async function updateProfile(req, res, next) {
  try {
    const {
      name,
      phone,
      age,
      address,
      city,
      coordinates,
      medicalNotes,
      bloodGroup
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name.trim();
    if (phone) user.phone = phone.trim();
    if (age) user.age = Number(age);
    if (address) user.address = address.trim();
    if (city !== undefined) user.city = city.trim();
    if (medicalNotes !== undefined) user.medicalNotes = medicalNotes.trim();

    // If coordinates are provided
    if (coordinates) {
      let parsedCoords = coordinates;
      if (typeof coordinates === 'string') {
        try {
          parsedCoords = JSON.parse(coordinates);
        } catch (e) {
          return res.status(400).json({ success: false, message: 'Invalid coordinates format.' });
        }
      }
      if (isValidCoordinates(parsedCoords)) {
        user.location = {
          type: 'Point',
          coordinates: parsedCoords
        };
      }
    }

    // If an avatar file was uploaded
    if (req.file) {
      user.avatar = `/uploads/avatars/${req.file.filename}`;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully.',
      user
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get public profile of a donor
 * GET /api/users/:id
 */
async function getUserProfile(req, res, next) {
  try {
    const donor = await User.findById(req.params.id)
      .select('-password -email -phone') // keep contact private unless coordinated
      .lean();

    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor not found.' });
    }

    res.json({
      success: true,
      donor
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  findDonors,
  toggleAvailability,
  updateProfile,
  getUserProfile
};
