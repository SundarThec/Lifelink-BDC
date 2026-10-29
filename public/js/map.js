/**
 * LifeLink Offline Map Controller (MapLibre GL JS)
 * Completely offline: uses local vector/raster tiles, local GeoJSON radius overlay,
 * and offline gazetteer pin-pointing without external network calls.
 */

if (typeof escapeHTML !== 'function') {
  window.escapeHTML = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
}

const DEFAULT_COORDS = [12.9716, 77.5946]; // Bangalore [lat, lng]

const mapInstances = {
  register: null,
  registerMarker: null,
  request: null,
  requestMarker: null,
  profile: null,
  profileMarker: null,
  donor: null,
  donorUserMarker: null,
  donorMarkers: [],
  miniDonor: null,
  miniDonorUserMarker: null,
  miniDonorMarkers: []
};

/**
 * Helper: Create styled HTML element for MapLibre Marker
 */
function createMarkerElement(color, iconClass) {
  const el = document.createElement('div');
  el.className = 'custom-maplibre-marker';
  el.style.cssText = `
    background-color: ${color};
    width: 32px;
    height: 32px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 3px 8px rgba(0,0,0,0.35);
    border: 2px solid #ffffff;
    cursor: pointer;
  `;
  el.innerHTML = `<i class="${iconClass}" style="transform: rotate(45deg); color: #ffffff; font-size: 14px;"></i>`;
  return el;
}

/**
 * Generate a 64-vertex geodesic circular polygon GeoJSON
 * @param {Array<number>} center - [lng, lat]
 * @param {number} radiusKm
 * @returns {object} GeoJSON Feature
 */
function createGeoJSONCircle(center, radiusKm, points = 64) {
  const [lng, lat] = center;
  const ret = [];
  const distanceX = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const distanceY = radiusKm / 110.574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    ret.push([lng + x, lat + y]);
  }
  ret.push(ret[0]); // Close ring

  return {
    type: 'Feature',
    properties: { radiusKm },
    geometry: {
      type: 'Polygon',
      coordinates: [ret]
    }
  };
}

/**
 * Safe coordinate extractor from MapLibre events
 */
function getLngLatFromEvent(e) {
  if (!e || !e.lngLat) return [DEFAULT_COORDS[1], DEFAULT_COORDS[0]];
  const lng = e.lngLat.lng !== undefined ? e.lngLat.lng : (Array.isArray(e.lngLat) ? e.lngLat[0] : DEFAULT_COORDS[1]);
  const lat = e.lngLat.lat !== undefined ? e.lngLat.lat : (Array.isArray(e.lngLat) ? e.lngLat[1] : DEFAULT_COORDS[0]);
  return [parseFloat(lng), parseFloat(lat)];
}

/**
 * Update Location Status Badge UI
 */
function updateLocationStatusBadge(badgeId, status, text) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  badge.className = `location-status-badge ${status}`;
  let icon = 'fa-circle-check';
  if (status === 'waiting') icon = 'fa-location-crosshairs';
  else if (status === 'approximate') icon = 'fa-location-arrow';
  else if (status === 'multiple') icon = 'fa-list-check';
  else if (status === 'manual') icon = 'fa-map-pin';
  else if (status === 'searching') icon = 'fa-spinner fa-spin';
  else if (status === 'error') icon = 'fa-circle-exclamation';
  else if (status === 'verified') icon = 'fa-circle-check';
  badge.innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHTML(text)}`;
}

/**
 * 1. Initialize Registration Map Pin Picker
 */
function initRegisterMap(initialCoords = [77.6412, 12.9719], isVerified = true) {
  const container = document.getElementById('registerMap');
  if (!container) return;

  const lng = initialCoords[0] || DEFAULT_COORDS[1];
  const lat = initialCoords[1] || DEFAULT_COORDS[0];

  function updateRegCoords(newLat, newLng, isManual = false) {
    const coordsInput = document.getElementById('regCoordinates');
    const label = document.getElementById('regCoordsLabel');
    if (coordsInput) coordsInput.value = JSON.stringify([newLng, newLat]);
    if (label) label.textContent = `Selected Coordinates: [${newLng.toFixed(4)}, ${newLat.toFixed(4)}]`;

    updateLocationStatusBadge('regLocationBadge', isManual ? 'manual' : 'verified', isManual ? 'Manual Pin' : 'Location Verified');

    // Reverse geocode when manually repositioned
    if (isManual && typeof reverseGeocodeCoordinates === 'function') {
      reverseGeocodeCoordinates(newLat, newLng).then((addr) => {
        const addrInput = document.getElementById('regAddress');
        if (addrInput && addr) {
          addrInput.value = addr;
        }
      });
    }
  }

  if (mapInstances.register) {
    mapInstances.register.resize();
    mapInstances.register.flyTo({ center: [lng, lat], zoom: 14, essential: true });
    if (mapInstances.registerMarker) {
      mapInstances.registerMarker.setLngLat([lng, lat]);
    }
    updateRegCoords(lat, lng, !isVerified);
    return;
  }

  mapInstances.register = new maplibregl.Map({
    container: 'registerMap',
    style: '/tiles/style.json',
    center: [lng, lat],
    zoom: 14
  });

  const markerEl = createMarkerElement('#2563eb', 'fa-solid fa-user');
  mapInstances.registerMarker = new maplibregl.Marker({
    element: markerEl,
    draggable: true
  })
    .setLngLat([lng, lat])
    .addTo(mapInstances.register);

  updateRegCoords(lat, lng, !isVerified);

  mapInstances.registerMarker.on('dragend', () => {
    const pos = mapInstances.registerMarker.getLngLat();
    updateRegCoords(pos.lat, pos.lng, true);
  });

  mapInstances.register.on('click', (e) => {
    const [cLng, cLat] = getLngLatFromEvent(e);
    mapInstances.registerMarker.setLngLat([cLng, cLat]);
    updateRegCoords(cLat, cLng, true);
  });
}

/**
 * 2. Initialize Hospital / Request Map Pin Picker
 * @param {Array<number>|null} initialCoords - [longitude, latitude] or null
 * @param {boolean} isConfirmed - Whether coordinates are verified or geocoded
 * @param {object} options - { isApproximate, statusText, zoom, isManual }
 */
function initRequestMap(initialCoords = null, isConfirmed = false, options = {}) {
  const container = document.getElementById('requestMap');
  if (!container) return;

  const hasExplicitCoords =
    Array.isArray(initialCoords) &&
    initialCoords.length === 2 &&
    typeof initialCoords[0] === 'number' &&
    typeof initialCoords[1] === 'number' &&
    !isNaN(initialCoords[0]) &&
    !isNaN(initialCoords[1]);

  const lng = hasExplicitCoords ? initialCoords[0] : DEFAULT_COORDS[1];
  const lat = hasExplicitCoords ? initialCoords[1] : DEFAULT_COORDS[0];

  const isApprox = Boolean(options.isApproximate);
  const zoom = options.zoom || (isApprox ? 13 : 15);

  function scheduleResize(mapObj) {
    if (!mapObj) return;
    try { mapObj.resize(); } catch (e) {}
    setTimeout(() => { try { if (mapObj) mapObj.resize(); } catch (e) {} }, 60);
    setTimeout(() => { try { if (mapObj) mapObj.resize(); } catch (e) {} }, 200);
    setTimeout(() => { try { if (mapObj) mapObj.resize(); } catch (e) {} }, 400);
  }

  function safeMoveMap(mapObj, targetCenter, targetZoom) {
    if (!mapObj) return;
    try {
      if (mapObj.resize) mapObj.resize();
      if (mapObj.isStyleLoaded && mapObj.isStyleLoaded()) {
        mapObj.flyTo({ center: targetCenter, zoom: targetZoom, essential: true });
      } else {
        mapObj.jumpTo({ center: targetCenter, zoom: targetZoom });
        mapObj.once('load', () => {
          try {
            if (mapObj.resize) mapObj.resize();
            mapObj.jumpTo({ center: targetCenter, zoom: targetZoom });
          } catch (e) {}
        });
      }
    } catch (e) {
      try {
        mapObj.setCenter(targetCenter);
        mapObj.setZoom(targetZoom);
      } catch (err) {
        console.warn('Map centering notice:', err.message);
      }
    }
  }

  function updateReqCoords(newLat, newLng, statusType, statusText) {
    const coordsInput = document.getElementById('reqCoordinates');
    const label = document.getElementById('reqCoordsLabel');
    if (coordsInput) coordsInput.value = JSON.stringify([newLng, newLat]);
    if (label) {
      const prefix = statusType === 'approximate' ? 'Approximate Coordinates:' : 'Selected Coordinates:';
      label.textContent = `${prefix} [${newLng.toFixed(4)}, ${newLat.toFixed(4)}]`;
    }

    updateLocationStatusBadge('reqLocationBadge', statusType, statusText);

    // Reverse geocode when manually repositioned
    if (statusType === 'manual' && typeof reverseGeocodeCoordinates === 'function') {
      reverseGeocodeCoordinates(newLat, newLng).then((addr) => {
        const addrInput = document.getElementById('reqHospitalAddress');
        if (addrInput && addr) {
          addrInput.value = addr;
        }
      });
    }
  }

  // If map instance already initialized
  if (mapInstances.request) {
    scheduleResize(mapInstances.request);
    if (hasExplicitCoords) {
      safeMoveMap(mapInstances.request, [lng, lat], zoom);
      if (mapInstances.requestMarker) {
        mapInstances.requestMarker.setLngLat([lng, lat]);
      }
      const initialStatus = options.statusType || (isConfirmed ? (isApprox ? 'approximate' : 'verified') : 'manual');
      const initialText = options.statusText || (isConfirmed ? (isApprox ? 'Approximate Locality Found' : 'Hospital Location Found') : 'Location Selected Manually');
      updateReqCoords(lat, lng, initialStatus, initialText);
    }
    return;
  }

  // Create new MapLibre instance
  mapInstances.request = new maplibregl.Map({
    container: 'requestMap',
    style: '/tiles/style.json',
    center: [lng, lat],
    zoom: hasExplicitCoords ? zoom : 12
  });

  const markerEl = createMarkerElement('#dc2626', 'fa-solid fa-hospital');
  mapInstances.requestMarker = new maplibregl.Marker({
    element: markerEl,
    draggable: true
  })
    .setLngLat([lng, lat])
    .addTo(mapInstances.request);

  if (hasExplicitCoords && isConfirmed) {
    const initialStatus = options.statusType || (isApprox ? 'approximate' : 'verified');
    const initialText = options.statusText || (isApprox ? 'Approximate Locality Found' : 'Hospital Location Found');
    updateReqCoords(lat, lng, initialStatus, initialText);
  } else if (!hasExplicitCoords) {
    // Unselected state: Do NOT treat default initial map center as verified location
    const coordsInput = document.getElementById('reqCoordinates');
    if (coordsInput && !coordsInput.value) coordsInput.value = '';
    const label = document.getElementById('reqCoordsLabel');
    if (label && (!coordsInput || !coordsInput.value)) {
      label.textContent = 'No location selected yet. Enter hospital address or click map.';
    }
    updateLocationStatusBadge('reqLocationBadge', 'waiting', 'Waiting for address input');
  }

  // Drag event handler: manual marker positioning
  mapInstances.requestMarker.on('dragend', () => {
    const pos = mapInstances.requestMarker.getLngLat();
    updateReqCoords(pos.lat, pos.lng, 'manual', 'Location Selected Manually');
  });

  // Map click handler: manual pin repositioning
  mapInstances.request.on('click', (e) => {
    const [cLng, cLat] = getLngLatFromEvent(e);
    mapInstances.requestMarker.setLngLat([cLng, cLat]);
    updateReqCoords(cLat, cLng, 'manual', 'Location Selected Manually');
  });

  // Handle map loading and responsive container sizing
  mapInstances.request.on('load', () => {
    scheduleResize(mapInstances.request);
  });

  // Attach ResizeObserver to container for modal transitions and resizing
  if (window.ResizeObserver && container) {
    const ro = new ResizeObserver(() => {
      if (mapInstances.request) mapInstances.request.resize();
    });
    ro.observe(container);
  }

  scheduleResize(mapInstances.request);
}

/**
 * 3. Initialize Profile Map Pin Picker
 */
function initProfileMap(initialCoords = [77.6033, 12.9756], isVerified = true) {
  const container = document.getElementById('profileMap');
  if (!container) return;

  const lng = initialCoords[0] || DEFAULT_COORDS[1];
  const lat = initialCoords[1] || DEFAULT_COORDS[0];

  function updateProfCoords(newLat, newLng, isManual = false) {
    const coordsInput = document.getElementById('editCoordinates');
    const label = document.getElementById('editCoordsLabel');
    if (coordsInput) coordsInput.value = JSON.stringify([newLng, newLat]);
    if (label) label.textContent = `Selected Coordinates: [${newLng.toFixed(4)}, ${newLat.toFixed(4)}]`;

    updateLocationStatusBadge('editLocationBadge', isManual ? 'manual' : 'verified', isManual ? 'Manual Pin' : 'Location Verified');

    // Reverse geocode when manually repositioned
    if (isManual && typeof reverseGeocodeCoordinates === 'function') {
      reverseGeocodeCoordinates(newLat, newLng).then((addr) => {
        const addrInput = document.getElementById('editAddress');
        if (addrInput && addr) {
          addrInput.value = addr;
        }
      });
    }
  }

  if (mapInstances.profile) {
    mapInstances.profile.resize();
    mapInstances.profile.flyTo({ center: [lng, lat], zoom: 14, essential: true });
    if (mapInstances.profileMarker) {
      mapInstances.profileMarker.setLngLat([lng, lat]);
    }
    updateProfCoords(lat, lng, !isVerified);
    return;
  }

  mapInstances.profile = new maplibregl.Map({
    container: 'profileMap',
    style: '/tiles/style.json',
    center: [lng, lat],
    zoom: 14
  });

  const markerEl = createMarkerElement('#2563eb', 'fa-solid fa-user');
  mapInstances.profileMarker = new maplibregl.Marker({
    element: markerEl,
    draggable: true
  })
    .setLngLat([lng, lat])
    .addTo(mapInstances.profile);

  updateProfCoords(lat, lng, !isVerified);

  mapInstances.profileMarker.on('dragend', () => {
    const pos = mapInstances.profileMarker.getLngLat();
    updateProfCoords(pos.lat, pos.lng, true);
  });

  mapInstances.profile.on('click', (e) => {
    const [cLng, cLat] = getLngLatFromEvent(e);
    mapInstances.profileMarker.setLngLat([cLng, cLat]);
    updateProfCoords(cLat, cLng, true);
  });
}

/**
 * 4. Render Fullscreen Geographic Donor Map with Dynamic Radius Circle Overlay & Interactive Recenter
 */
function renderDonorMap(centerCoords = [77.6033, 12.9756], radiusKm = 15, donors = []) {
  const container = document.getElementById('donorMap');
  if (!container) return;

  const lng = centerCoords[0] || DEFAULT_COORDS[1];
  const lat = centerCoords[1] || DEFAULT_COORDS[0];

  const circleGeoJSON = createGeoJSONCircle([lng, lat], radiusKm > 0 ? radiusKm : 0.05);

  function applyRadiusAndDonors() {
    // Update or add circle source
    if (mapInstances.donor.getSource('donor-radius-source')) {
      mapInstances.donor.getSource('donor-radius-source').setData(circleGeoJSON);
    } else {
      mapInstances.donor.addSource('donor-radius-source', {
        type: 'geojson',
        data: circleGeoJSON
      });
      mapInstances.donor.addLayer({
        id: 'donor-radius-fill',
        type: 'fill',
        source: 'donor-radius-source',
        paint: {
          'fill-color': '#dc2626',
          'fill-opacity': 0.12
        }
      });
      mapInstances.donor.addLayer({
        id: 'donor-radius-line',
        type: 'line',
        source: 'donor-radius-source',
        paint: {
          'line-color': '#dc2626',
          'line-width': 2,
          'line-dasharray': [4, 4]
        }
      });
    }

    // Clear previous donor markers
    mapInstances.donorMarkers.forEach((m) => m.remove());
    mapInstances.donorMarkers = [];

    // Center User Marker
    if (mapInstances.donorUserMarker) {
      mapInstances.donorUserMarker.setLngLat([lng, lat]);
    } else {
      const userEl = createMarkerElement('#2563eb', 'fa-solid fa-crosshairs');
      const userPopup = new maplibregl.Popup({ offset: [0, -25] }).setHTML(
        '<div style="padding: 2px;"><strong>Search Center</strong><br><small>Center of broadcast radius</small></div>'
      );
      mapInstances.donorUserMarker = new maplibregl.Marker({ element: userEl, draggable: true })
        .setLngLat([lng, lat])
        .setPopup(userPopup)
        .addTo(mapInstances.donor);

      mapInstances.donorUserMarker.on('dragend', () => {
        const pos = mapInstances.donorUserMarker.getLngLat();
        if (typeof onDonorMapCenterChanged === 'function') {
          onDonorMapCenterChanged([pos.lng, pos.lat]);
        }
      });
    }

    // Add Donor Markers
    donors.forEach((donor) => {
      if (donor.location && donor.location.coordinates) {
        const dLng = donor.location.coordinates[0];
        const dLat = donor.location.coordinates[1];
        const isAvailable = donor.isAvailableToDonate;
        const color = isAvailable ? '#16a34a' : '#64748b';

        const donorEl = createMarkerElement(color, 'fa-solid fa-droplet');
        const popupContent = `
          <div class="donor-popup-card">
            <div class="donor-popup-header">
              <span class="donor-popup-name">${escapeHTML(donor.name)}</span>
              <span class="donor-popup-badge">${donor.bloodGroup}</span>
            </div>
            <div class="donor-popup-sub">@${escapeHTML(donor.username || 'donor')} &bull; Age ${donor.age || 'N/A'}</div>
            ${donor.email ? `<div class="donor-popup-email"><i class="fa-solid fa-envelope"></i> ${escapeHTML(donor.email)}</div>` : ''}
            <div class="donor-popup-sub"><i class="fa-solid fa-location-dot"></i> ${escapeHTML(donor.address || donor.city || 'Bangalore')}</div>
            <div class="donor-popup-dist"><i class="fa-solid fa-route"></i> Distance: ~${donor.distanceKm || '0'} km</div>
            <div style="font-size: 11px; margin-top: 4px;">Status: <span style="color: ${isAvailable ? '#16a34a' : '#64748b'}; font-weight: 700;">${isAvailable ? 'Available to Donate' : 'Unavailable'}</span> &bull; <span style="color: ${donor.isOnline ? '#16a34a' : '#94a3b8'};">${donor.isOnline ? 'Online Now' : 'Offline'}</span></div>
            <button class="btn btn-primary btn-sm donor-popup-btn" onclick="openDirectEmergencyRequest('${donor._id}', '${escapeHTML(donor.name)}', '${donor.bloodGroup}')">
              <i class="fa-solid fa-hand-holding-medical"></i> Request Directly
            </button>
          </div>
        `;

        const donorPopup = new maplibregl.Popup({ offset: [0, -25] }).setHTML(popupContent);
        const marker = new maplibregl.Marker({ element: donorEl })
          .setLngLat([dLng, dLat])
          .setPopup(donorPopup)
          .addTo(mapInstances.donor);

        mapInstances.donorMarkers.push(marker);
      }
    });
  }

  if (!mapInstances.donor) {
    mapInstances.donor = new maplibregl.Map({
      container: 'donorMap',
      style: '/tiles/style.json',
      center: [lng, lat],
      zoom: 12
    });

    mapInstances.donor.on('load', applyRadiusAndDonors);

    // Interactive Map Click: re-center broadcast radius and reload donors
    mapInstances.donor.on('click', (e) => {
      // Check if a popup was opened or click on marker
      if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('.custom-maplibre-marker')) {
        return; // Don't recenter if clicking directly on a marker
      }
      const cLng = Array.isArray(e.lngLat) ? e.lngLat[0] : (e.lngLat.lng !== undefined ? e.lngLat.lng : e.lngLat[0]);
      const cLat = Array.isArray(e.lngLat) ? e.lngLat[1] : (e.lngLat.lat !== undefined ? e.lngLat.lat : e.lngLat[1]);
      if (typeof onDonorMapCenterChanged === 'function') {
        onDonorMapCenterChanged([cLng, cLat]);
      }
    });
  } else {
    mapInstances.donor.resize();
    mapInstances.donor.setCenter([lng, lat]);
    applyRadiusAndDonors();
  }
}

/**
 * 5. Render Split Mini Map for View 3 (Find Donors)
 */
function renderFindDonorMiniMap(centerCoords = [77.6033, 12.9756], radiusKm = 25, donors = []) {
  const container = document.getElementById('findDonorMiniMap');
  if (!container) return;

  const lng = centerCoords[0] || DEFAULT_COORDS[1];
  const lat = centerCoords[1] || DEFAULT_COORDS[0];

  const circleGeoJSON = createGeoJSONCircle([lng, lat], radiusKm > 0 ? radiusKm : 0.05);

  function applyMiniRadiusAndDonors() {
    if (mapInstances.miniDonor.getSource('mini-radius-source')) {
      mapInstances.miniDonor.getSource('mini-radius-source').setData(circleGeoJSON);
    } else {
      mapInstances.miniDonor.addSource('mini-radius-source', {
        type: 'geojson',
        data: circleGeoJSON
      });
      mapInstances.miniDonor.addLayer({
        id: 'mini-radius-fill',
        type: 'fill',
        source: 'mini-radius-source',
        paint: {
          'fill-color': '#dc2626',
          'fill-opacity': 0.12
        }
      });
      mapInstances.miniDonor.addLayer({
        id: 'mini-radius-line',
        type: 'line',
        source: 'mini-radius-source',
        paint: {
          'line-color': '#dc2626',
          'line-width': 2,
          'line-dasharray': [4, 4]
        }
      });
    }

    // Clear previous mini donor markers
    mapInstances.miniDonorMarkers.forEach((m) => m.remove());
    mapInstances.miniDonorMarkers = [];

    // Center marker
    if (mapInstances.miniDonorUserMarker) {
      mapInstances.miniDonorUserMarker.setLngLat([lng, lat]);
    } else {
      const userEl = createMarkerElement('#2563eb', 'fa-solid fa-crosshairs');
      const userPopup = new maplibregl.Popup({ offset: [0, -25] }).setHTML(
        '<div style="padding: 2px;"><strong>Search Center</strong><br><small>Click map to move center</small></div>'
      );
      mapInstances.miniDonorUserMarker = new maplibregl.Marker({ element: userEl, draggable: true })
        .setLngLat([lng, lat])
        .setPopup(userPopup)
        .addTo(mapInstances.miniDonor);

      mapInstances.miniDonorUserMarker.on('dragend', () => {
        const pos = mapInstances.miniDonorUserMarker.getLngLat();
        if (typeof onFindDonorMiniMapCenterChanged === 'function') {
          onFindDonorMiniMapCenterChanged([pos.lng, pos.lat]);
        }
      });
    }

    // Add Donor Markers
    donors.forEach((donor) => {
      if (donor.location && donor.location.coordinates) {
        const dLng = donor.location.coordinates[0];
        const dLat = donor.location.coordinates[1];
        const isAvailable = donor.isAvailableToDonate;
        const color = isAvailable ? '#16a34a' : '#64748b';

        const donorEl = createMarkerElement(color, 'fa-solid fa-droplet');
        const popupContent = `
          <div class="donor-popup-card">
            <div class="donor-popup-header">
              <span class="donor-popup-name">${escapeHTML(donor.name)}</span>
              <span class="donor-popup-badge">${donor.bloodGroup}</span>
            </div>
            <div class="donor-popup-sub">@${escapeHTML(donor.username || 'donor')} &bull; Age ${donor.age || 'N/A'}</div>
            ${donor.email ? `<div class="donor-popup-email"><i class="fa-solid fa-envelope"></i> ${escapeHTML(donor.email)}</div>` : ''}
            <div class="donor-popup-sub"><i class="fa-solid fa-location-dot"></i> ${escapeHTML(donor.address || donor.city || 'Bangalore')}</div>
            <div class="donor-popup-dist"><i class="fa-solid fa-route"></i> Distance: ~${donor.distanceKm || '0'} km</div>
            <div style="font-size: 11px; margin-top: 4px;">Status: <span style="color: ${isAvailable ? '#16a34a' : '#64748b'}; font-weight: 700;">${isAvailable ? 'Available to Donate' : 'Unavailable'}</span> &bull; <span style="color: ${donor.isOnline ? '#16a34a' : '#94a3b8'};">${donor.isOnline ? 'Online Now' : 'Offline'}</span></div>
            <button class="btn btn-primary btn-sm donor-popup-btn" onclick="openDirectEmergencyRequest('${donor._id}', '${escapeHTML(donor.name)}', '${donor.bloodGroup}')">
              <i class="fa-solid fa-hand-holding-medical"></i> Request Directly
            </button>
          </div>
        `;

        const donorPopup = new maplibregl.Popup({ offset: [0, -25] }).setHTML(popupContent);
        const marker = new maplibregl.Marker({ element: donorEl })
          .setLngLat([dLng, dLat])
          .setPopup(donorPopup)
          .addTo(mapInstances.miniDonor);

        mapInstances.miniDonorMarkers.push(marker);
      }
    });
  }

  if (!mapInstances.miniDonor) {
    mapInstances.miniDonor = new maplibregl.Map({
      container: 'findDonorMiniMap',
      style: '/tiles/style.json',
      center: [lng, lat],
      zoom: 12
    });

    mapInstances.miniDonor.on('load', applyMiniRadiusAndDonors);

    mapInstances.miniDonor.on('click', (e) => {
      if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('.custom-maplibre-marker')) {
        return;
      }
      const cLng = Array.isArray(e.lngLat) ? e.lngLat[0] : (e.lngLat.lng !== undefined ? e.lngLat.lng : e.lngLat[0]);
      const cLat = Array.isArray(e.lngLat) ? e.lngLat[1] : (e.lngLat.lat !== undefined ? e.lngLat.lat : e.lngLat[1]);
      if (typeof onFindDonorMiniMapCenterChanged === 'function') {
        onFindDonorMiniMapCenterChanged([cLng, cLat]);
      }
    });
  } else {
    mapInstances.miniDonor.resize();
    mapInstances.miniDonor.setCenter([lng, lat]);
    applyMiniRadiusAndDonors();
  }
}
