/**
 * LifeLink Main SPA Controller & Orchestrator
 */

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  initSocketConnection();
  updateAuthUI();
  initNavigation();
  initRequestFilters();
  initModalTriggers();
  initFormSubmissions();
  initGeocodingInputs();
  initAdminHandlers();
  initCertificateHandlers();

  // Initial view resolution
  const user = api.getCurrentUser();
  if (user) {
    if (user.role === 'admin') {
      switchView('admin');
    } else {
      switchView('dashboard');
    }
    loadNotifications();
  } else {
    switchView('intro');
  }
}

/**
 * SPA View Switcher
 * @param {string} viewName
 */
function switchView(viewName) {
  const user = api.getCurrentUser();

  // Protected views check
  if (!user && viewName !== 'intro') {
    openModal('loginModal');
    return;
  }

  // Admin view check
  if (viewName === 'admin' && user.role !== 'admin') {
    showToast('Unauthorized access. Admin privileges required.', 'error');
    switchView('dashboard');
    return;
  }

  // Update active nav button
  document.querySelectorAll('.nav-item').forEach((btn) => {
    if (btn.getAttribute('data-view') === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Hide all view panels
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.add('hidden');
  });

  // Show target panel
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Load view-specific dynamic data
  switch (viewName) {
    case 'dashboard':
      loadDashboardFeed();
      break;
    case 'find-donor':
      searchDonors();
      break;
    case 'requests':
      loadAllRequestsFeed();
      break;
    case 'donor-map':
      loadDonorMapData();
      break;
    case 'notifications':
      loadNotifications();
      break;
    case 'chat':
      loadChatConversations();
      break;
    case 'profile':
      loadUserProfileData();
      break;
    case 'admin':
      loadAdminDashboard();
      break;
  }
}

/**
 * Setup navigation listeners
 */
function initNavigation() {
  document.querySelectorAll('[data-view]').forEach((elem) => {
    elem.addEventListener('click', (e) => {
      e.preventDefault();
      const view = elem.getAttribute('data-view');
      if (view) switchView(view);
      // Close dropdown if open
      const userDropdown = document.getElementById('userDropdown');
      if (userDropdown) userDropdown.classList.add('hidden');
    });
  });

  // Brand Logo Click
  const brandBtn = document.getElementById('brandLogoBtn');
  if (brandBtn) {
    brandBtn.addEventListener('click', () => {
      const user = api.getCurrentUser();
      switchView(user ? 'dashboard' : 'intro');
    });
  }

  // User Dropdown toggle
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userDropdown = document.getElementById('userDropdown');
  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      userDropdown.classList.add('hidden');
    });
  }

  // Availability Toggle in Header
  const headerAvailToggle = document.getElementById('headerAvailabilityToggle');
  if (headerAvailToggle) {
    headerAvailToggle.addEventListener('change', handleToggleAvailability);
  }

  // Logout Button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  // Mark all notifs read
  const markNotifsBtn = document.getElementById('markAllNotifsReadBtn');
  if (markNotifsBtn) {
    markNotifsBtn.addEventListener('click', markAllNotificationsRead);
  }

  // Donor Radius Slider & No Radius Limit
  const radiusSlider = document.getElementById('donorRadiusSlider');
  const radiusVal = document.getElementById('donorRadiusVal');
  const noRadiusCheck = document.getElementById('donorNoRadiusLimit');

  if (radiusSlider && radiusVal) {
    radiusSlider.addEventListener('input', (e) => {
      radiusVal.textContent = `${e.target.value} km`;
    });
  }

  if (noRadiusCheck) {
    noRadiusCheck.addEventListener('change', (e) => {
      if (radiusSlider) radiusSlider.disabled = e.target.checked;
      if (radiusVal) radiusVal.textContent = e.target.checked ? 'Any' : `${radiusSlider?.value || 25} km`;
      searchDonors();
    });
  }

  // Donor Search Query Input & Enter key
  const donorSearchInput = document.getElementById('donorSearchQuery');
  const clearDonorQueryBtn = document.getElementById('clearDonorSearchQueryBtn');
  if (donorSearchInput) {
    donorSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchDonors();
      }
    });
    donorSearchInput.addEventListener('input', (e) => {
      if (clearDonorQueryBtn) {
        if (e.target.value.trim().length > 0) clearDonorQueryBtn.classList.remove('hidden');
        else clearDonorQueryBtn.classList.add('hidden');
      }
    });
  }

  if (clearDonorQueryBtn) {
    clearDonorQueryBtn.addEventListener('click', () => {
      if (donorSearchInput) donorSearchInput.value = '';
      clearDonorQueryBtn.classList.add('hidden');
      searchDonors();
    });
  }

  // Instant filtering on Blood Group and Status Toggles
  document.getElementById('donorFilterBloodGroup')?.addEventListener('change', () => searchDonors());
  document.getElementById('filterAvailableOnly')?.addEventListener('change', () => searchDonors());
  document.getElementById('filterOnlineOnly')?.addEventListener('change', () => searchDonors());
  document.getElementById('filterCompatibleOnly')?.addEventListener('change', () => searchDonors());

  // Apply & Reset Donor Filters Buttons
  document.getElementById('applyDonorFilterBtn')?.addEventListener('click', () => searchDonors());
  document.getElementById('resetDonorFiltersBtn')?.addEventListener('click', () => resetDonorFilters());

  // Reset Center Pill Button
  document.getElementById('resetCenterPillBtn')?.addEventListener('click', () => {
    currentDonorSearchCoords = null;
    currentDonorSearchLocationName = '';
    const locInput = document.getElementById('donorSearchLocation');
    if (locInput) locInput.value = '';
    const centerLabel = document.getElementById('activeCenterLabel');
    if (centerLabel) centerLabel.textContent = 'Registered Location';
    searchDonors();
    showToast('Search center reset to your registered location', 'info');
  });

  // View Mode Toggles (Cards vs Split Map)
  document.getElementById('findDonorViewListBtn')?.addEventListener('click', () => setFindDonorViewMode('list'));
  document.getElementById('findDonorViewSplitBtn')?.addEventListener('click', () => setFindDonorViewMode('split'));

  // Donor Map Filter Changes (View 5)
  document.getElementById('mapRadiusSelect')?.addEventListener('change', () => loadDonorMapData());
  document.getElementById('mapBloodSelect')?.addEventListener('change', () => loadDonorMapData());
  document.getElementById('mapAvailabilitySelect')?.addEventListener('change', () => loadDonorMapData());
  document.getElementById('mapOnlineOnly')?.addEventListener('change', () => loadDonorMapData());
  document.getElementById('applyMapFilterBtn')?.addEventListener('click', () => loadDonorMapData());
  document.getElementById('resetMapFiltersBtn')?.addEventListener('click', () => resetMapFilters());

  const mapSearchInput = document.getElementById('mapSearchInput');
  if (mapSearchInput) {
    mapSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadDonorMapData();
      }
    });
  }
}

/**
 * Setup Emergency Blood Request Filter Tabs (Open, In Progress / Accepted, Fulfilled)
 */
function initRequestFilters() {
  const tablist = document.querySelector('.tab-pills[role="tablist"]');
  const pills = document.querySelectorAll('.tab-pills .tab-pill');
  if (!pills.length) return;

  pills.forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      pills.forEach((p) => {
        p.classList.remove('active');
        p.setAttribute('aria-selected', 'false');
        p.setAttribute('tabindex', '-1');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-selected', 'true');
      pill.setAttribute('tabindex', '0');

      const status = pill.getAttribute('data-req-status') || 'open';
      loadAllRequestsFeed(status);
    });
  });

  // WAI-ARIA arrow navigation between tabs
  if (tablist) {
    tablist.addEventListener('keydown', (e) => {
      const tabs = Array.from(tablist.querySelectorAll('.tab-pill'));
      const currentIndex = tabs.indexOf(document.activeElement);
      if (currentIndex === -1) return;

      let nextIndex = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      }

      if (nextIndex !== null) {
        e.preventDefault();
        tabs[nextIndex].focus();
        tabs[nextIndex].click();
      }
    });
  }
}

/**
 * Modal management
 */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');

    // Initialize and resize MapLibre GL map on modal open
    setTimeout(() => {
      try {
        if (modalId === 'registerModal') {
          const coordsStr = document.getElementById('regCoordinates')?.value;
          const coords = coordsStr ? JSON.parse(coordsStr) : [77.6412, 12.9719];
          initRegisterMap(coords);
          if (mapInstances.register) mapInstances.register.resize();
        } else if (modalId === 'createRequestModal') {
          const coordsStr = document.getElementById('reqCoordinates')?.value;
          let coords = null;
          try {
            coords = coordsStr ? JSON.parse(coordsStr) : null;
          } catch (e) {
            coords = null;
          }
          initRequestMap(coords, Boolean(coords));
          if (mapInstances.request) {
            mapInstances.request.resize();
            setTimeout(() => { if (mapInstances.request) mapInstances.request.resize(); }, 60);
            setTimeout(() => { if (mapInstances.request) mapInstances.request.resize(); }, 200);
            setTimeout(() => { if (mapInstances.request) mapInstances.request.resize(); }, 400);
          }
        } else if (modalId === 'editProfileModal') {
          const coordsStr = document.getElementById('editCoordinates')?.value;
          const coords = coordsStr ? JSON.parse(coordsStr) : [77.6033, 12.9756];
          initProfileMap(coords);
          if (mapInstances.profile) mapInstances.profile.resize();
        }
      } catch (err) {
        console.warn('Map initialization notice on modal open:', err.message);
      }
    }, 150);
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

function initModalTriggers() {
  if (typeof initLoginTabs === 'function') {
    initLoginTabs();
  }

  // Login / Register Modal buttons
  document.getElementById('loginModalBtn')?.addEventListener('click', () => openModal('loginModal'));
  document.getElementById('registerModalBtn')?.addEventListener('click', () => openModal('registerModal'));
  document.getElementById('heroRegisterBtn')?.addEventListener('click', () => openModal('registerModal'));
  document.getElementById('heroRequestBtn')?.addEventListener('click', () => {
    if (api.getCurrentUser()) openModal('createRequestModal');
    else openModal('loginModal');
  });

  document.getElementById('headerEmergencyBtn')?.addEventListener('click', () => {
    if (api.getCurrentUser()) openModal('createRequestModal');
    else openModal('loginModal');
  });
  document.getElementById('dashNewRequestBtn')?.addEventListener('click', () => openModal('createRequestModal'));
  document.getElementById('requestsNewBtn')?.addEventListener('click', () => openModal('createRequestModal'));

  // Switch Links
  document.getElementById('switchToRegisterLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal('loginModal');
    openModal('registerModal');
  });
  document.getElementById('switchToLoginLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal('registerModal');
    openModal('loginModal');
  });

  // Close buttons
  document.getElementById('closeLoginModal')?.addEventListener('click', () => closeModal('loginModal'));
  document.getElementById('closeRegisterModal')?.addEventListener('click', () => closeModal('registerModal'));
  document.getElementById('closeRequestModal')?.addEventListener('click', () => closeModal('createRequestModal'));
  document.getElementById('closeDetailsModal')?.addEventListener('click', () => closeModal('requestDetailsModal'));
  document.getElementById('closeCertModal')?.addEventListener('click', () => closeModal('certificateModal'));
  document.getElementById('openComplaintModalBtn')?.addEventListener('click', () => openModal('complaintModal'));
  document.getElementById('closeComplaintModal')?.addEventListener('click', () => closeModal('complaintModal'));

  // Backdrop clicks
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.add('hidden');
      }
    });
  });
}

/**
 * Setup forms
 */
function initFormSubmissions() {
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
  document.getElementById('createRequestForm')?.addEventListener('submit', handleCreateRequest);
  document.getElementById('chatMessageForm')?.addEventListener('submit', handleSendChatMessage);
  document.getElementById('editProfileForm')?.addEventListener('submit', handleUpdateProfile);
  document.getElementById('complaintForm')?.addEventListener('submit', handleComplaintSubmit);

  // Profile avatar upload
  const avatarInput = document.getElementById('avatarFileInput');
  if (avatarInput) {
    avatarInput.addEventListener('change', handleAvatarUpload);
  }
}

/**
 * Live Geocoding Autocomplete for Form Inputs
 */
function initGeocodingInputs() {
  function setupAutocomplete(inputId, suggestionsId, onSelectCoord, options = {}) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionsId);
    if (!input || !box) return { resolveAndLocate: () => {} };

    const badgeId = options.badgeId;
    const coordsInputId = options.coordsInputId;
    const coordsLabelId = options.coordsLabelId;
    let autoLocateTimer = null;
    let activeIndex = -1;
    let searchSequence = 0; // Sequence counter to prevent stale asynchronous responses from overwriting newer queries

    function invalidateCoordinates(statusType = 'error', statusText = 'Location not found. Click map to set pin manually.') {
      if (coordsInputId) {
        const coordsInput = document.getElementById(coordsInputId);
        if (coordsInput) coordsInput.value = '';
      }
      if (coordsLabelId) {
        const coordsLabel = document.getElementById(coordsLabelId);
        if (coordsLabel) coordsLabel.textContent = statusText;
      }
      if (badgeId) {
        updateLocationStatusBadge(badgeId, statusType, statusText);
      }
    }

    async function resolveAndLocate(text, isExplicit = false, seqId = null) {
      if (!text || text.trim().length < 2) {
        invalidateCoordinates('waiting', 'Waiting for address input');
        return;
      }

      const currentSeq = seqId !== null ? seqId : ++searchSequence;
      if (badgeId) updateLocationStatusBadge(badgeId, 'searching', 'Locating address...');

      try {
        const res = await resolveAddressCoordinates(text.trim());

        // Stale response check: discard if a newer query has been initiated
        if (currentSeq !== searchSequence) return;

        if (res && res.success && res.coordinates) {
          const isApprox = Boolean(res.isApproximate);
          const hasMultiple = res.totalMatches > 1;

          let statusType = isApprox ? 'approximate' : 'verified';
          let statusText = isApprox
            ? 'Approximate Locality Found (Refine address or adjust pin)'
            : 'Hospital Location Found';

          if (hasMultiple && isApprox) {
            statusText = 'Approximate Locality Found (Multiple matches below)';
          }

          if (onSelectCoord) {
            try {
              onSelectCoord(res.lat, res.lon, res.displayName || text, {
                isApproximate: isApprox,
                statusType,
                statusText,
                zoom: isApprox ? 13 : 16
              });
            } catch (mapErr) {
              console.warn('Map centering notice:', mapErr.message);
            }
          }

          if (badgeId) updateLocationStatusBadge(badgeId, statusType, statusText);

          if (isExplicit) {
            showToast(`Located: ${res.name || res.displayName}`, 'success');
          }
        } else {
          // Address resolution did not succeed or returned 0 results
          if (currentSeq !== searchSequence) return;

          if (res && res.reason === 'NETWORK_ERROR') {
            invalidateCoordinates('error', 'Geocoding service unavailable. Click map to set pin.');
            if (isExplicit) {
              showToast('Geocoding service unavailable. Please click or drag on map to set pin.', 'error');
            }
          } else {
            invalidateCoordinates('error', 'Location could not be found. Click map to set pin manually.');
            if (isExplicit) {
              showToast('Location could not be found. Please click or drag on map to set pin manually.', 'info');
            }
          }
        }
      } catch (err) {
        if (currentSeq !== searchSequence) return;
        invalidateCoordinates('error', 'Geocoding service unavailable. Click map to set pin.');
        if (isExplicit) {
          showToast('Geocoding service unavailable. Please click map to set pin manually.', 'error');
        }
      }
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      activeIndex = -1;
      clearTimeout(autoLocateTimer);
      const seq = ++searchSequence;

      if (!q || q.length < 2) {
        box.classList.add('hidden');
        invalidateCoordinates('waiting', 'Waiting for address input');
        return;
      }

      if (badgeId) updateLocationStatusBadge(badgeId, 'searching', 'Locating address...');

      // 1. Fetch suggestions for dropdown
      fetchAddressSuggestions(q, (results, err) => {
        if (seq !== searchSequence) return;

        if (!results || results.length === 0) {
          box.classList.add('hidden');
          return;
        }

        box.innerHTML = results.map((item, idx) => `
          <div class="suggestion-item" data-idx="${idx}" data-lat="${item.lat}" data-lon="${item.lon}" data-approx="${item.isApproximate ? '1' : '0'}" data-type="${item.matchType || ''}">
            <i class="fa-solid ${item.matchType === 'hospital' ? 'fa-hospital' : 'fa-location-dot'} suggestion-icon"></i>
            <div class="suggestion-content">
              <span class="suggestion-name">${escapeHTML(item.name || item.display_name)} ${item.isApproximate ? '<span class="suggestion-tag">Approximate</span>' : ''}</span>
              <span class="suggestion-sub">${escapeHTML(item.display_name)}</span>
            </div>
          </div>
        `).join('');
        box.classList.remove('hidden');

        box.querySelectorAll('.suggestion-item').forEach((elem) => {
          elem.addEventListener('click', () => {
            const lat = parseFloat(elem.getAttribute('data-lat'));
            const lon = parseFloat(elem.getAttribute('data-lon'));
            const isApprox = elem.getAttribute('data-approx') === '1';
            const nameEl = elem.querySelector('.suggestion-name');
            const itemText = nameEl ? nameEl.textContent.replace('Approximate', '').trim() : elem.textContent.trim();
            input.value = itemText;
            box.classList.add('hidden');
            clearTimeout(autoLocateTimer);

            const statusType = isApprox ? 'approximate' : 'verified';
            const statusText = isApprox ? 'Approximate Locality Found (Refine address or adjust pin)' : 'Hospital Location Found';

            if (onSelectCoord) {
              onSelectCoord(lat, lon, itemText, {
                isApproximate: isApprox,
                statusType,
                statusText,
                zoom: isApprox ? 13 : 16
              });
            }
            if (badgeId) updateLocationStatusBadge(badgeId, statusType, statusText);
          });
        });
      });

      // 2. Automatically locate on map after typing pause (500ms)
      autoLocateTimer = setTimeout(() => {
        if (seq !== searchSequence) return;
        resolveAndLocate(q, false, seq);
      }, 500);
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const items = box.querySelectorAll('.suggestion-item');
      if (box.classList.contains('hidden') || items.length === 0) {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(autoLocateTimer);
          resolveAndLocate(input.value.trim(), true);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex]) {
          items[activeIndex].click();
        } else {
          box.classList.add('hidden');
          clearTimeout(autoLocateTimer);
          resolveAndLocate(input.value.trim(), true);
        }
      } else if (e.key === 'Escape') {
        box.classList.add('hidden');
      }
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !box.contains(e.target)) {
        box.classList.add('hidden');
      }
    });

    return { resolveAndLocate };
  }

  // 1. Registration address lookup
  const regAuto = setupAutocomplete('regAddress', 'regAddressSuggestions', (lat, lon) => {
    initRegisterMap([lon, lat], true);
  }, { badgeId: 'regLocationBadge' });

  // Registration GPS / Pin button
  const regDetectBtn = document.getElementById('regDetectLocationBtn');
  if (regDetectBtn) {
    regDetectBtn.addEventListener('click', () => {
      const addr = document.getElementById('regAddress')?.value?.trim();
      if (addr) {
        regAuto.resolveAndLocate(addr, true);
      } else if (navigator.geolocation) {
        showToast('Detecting current GPS coordinates...', 'info');
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const [lon, lat] = [pos.coords.longitude, pos.coords.latitude];
            const humanAddr = await reverseGeocodeCoordinates(lat, lon);
            const input = document.getElementById('regAddress');
            if (input) input.value = humanAddr;
            initRegisterMap([lon, lat], true);
            showToast('Location updated to GPS position', 'success');
          },
          (err) => {
            showToast('GPS detection failed: ' + err.message, 'error');
          }
        );
      } else {
        showToast('Please type your address or location', 'info');
      }
    });
  }

  // 2. Hospital request address lookup
  const reqAuto = setupAutocomplete(
    'reqHospitalAddress',
    'reqAddressSuggestions',
    (lat, lon, addr, opts = {}) => {
      initRequestMap([lon, lat], true, opts);
    },
    {
      badgeId: 'reqLocationBadge',
      coordsInputId: 'reqCoordinates',
      coordsLabelId: 'reqCoordsLabel'
    }
  );

  // Hospital Pin button handler
  const reqPinBtn = document.getElementById('reqPinHospitalBtn');
  if (reqPinBtn) {
    reqPinBtn.addEventListener('click', () => {
      const addr = document.getElementById('reqHospitalAddress')?.value?.trim();
      if (!addr) {
        showToast('Please type a hospital name or address to locate on map.', 'info');
        return;
      }
      reqAuto.resolveAndLocate(addr, true);
    });
  }

  // 3. Profile edit address lookup
  const editAuto = setupAutocomplete('editAddress', 'editAddressSuggestions', (lat, lon) => {
    initProfileMap([lon, lat], true);
  }, { badgeId: 'editLocationBadge' });

  // Profile Pin button handler
  const editPinBtn = document.getElementById('editPinAddressBtn');
  if (editPinBtn) {
    editPinBtn.addEventListener('click', () => {
      const addr = document.getElementById('editAddress')?.value?.trim();
      if (!addr) {
        showToast('Please type an address to locate on map.', 'info');
        return;
      }
      editAuto.resolveAndLocate(addr, true);
    });
  }

  // 4. Donor search location lookup (View 3)
  setupAutocomplete('donorSearchLocation', 'donorLocationSuggestions', (lat, lon) => {
    searchDonors([lon, lat]);
  });

  // GPS current location detection for Find Donor
  const useGpsBtn = document.getElementById('useCurrentLocationBtn');
  if (useGpsBtn) {
    useGpsBtn.addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            reverseGeocodeCoordinates(coords[1], coords[0]).then((addr) => {
              const input = document.getElementById('donorSearchLocation');
              if (input) input.value = addr;
            });
            searchDonors(coords);
            showToast('Using your current GPS coordinates', 'info');
          },
          (err) => {
            showToast('Unable to retrieve GPS coordinates: ' + err.message, 'error');
          }
        );
      } else {
        showToast('Geolocation is not supported by your browser', 'error');
      }
    });
  }

  // 5. Map location entrance lookup (View 5)
  setupAutocomplete('mapLocationInput', 'mapLocationSuggestions', (lat, lon) => {
    loadDonorMapData([lon, lat]);
  });

  // GPS location detection for Map (View 5)
  const mapGpsBtn = document.getElementById('mapUseGpsBtn');
  if (mapGpsBtn) {
    mapGpsBtn.addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            reverseGeocodeCoordinates(coords[1], coords[0]).then((addr) => {
              const input = document.getElementById('mapLocationInput');
              if (input) input.value = addr;
            });
            loadDonorMapData(coords);
            showToast('Centered map on your GPS location', 'info');
          },
          (err) => {
            showToast('Unable to retrieve GPS coordinates: ' + err.message, 'error');
          }
        );
      } else {
        showToast('Geolocation is not supported by your browser', 'error');
      }
    });
  }
}

/**
 * Load Dashboard Feed: Priority Emergencies & Community Requests (Section 14)
 */
async function loadDashboardFeed() {
  if (!api.getToken()) return;

  const priorityContainer = document.getElementById('priorityRequestsContainer');
  const communityContainer = document.getElementById('communityRequestsContainer');

  try {
    const data = await api.get('/requests');

    // Update counts
    const priorityCount = document.getElementById('priorityRequestsCount');
    const communityCount = document.getElementById('communityRequestsCount');
    const totalRequests = document.getElementById('dashTotalRequests');

    if (priorityCount) priorityCount.textContent = data.priorityRequests.length;
    if (communityCount) communityCount.textContent = data.communityRequests.length;
    if (totalRequests) totalRequests.textContent = data.count;

    // Render Priority Requests
    if (priorityContainer) {
      if (data.priorityRequests.length === 0) {
        priorityContainer.innerHTML = `
          <div style="grid-column: 1 / -1; background: #ffffff; border: 1px dashed var(--border-color); border-radius: 10px; padding: 2.5rem; text-align: center; color: #64748b;">
            <i class="fa-solid fa-heart-circle-check fa-3x" style="color: #10b981; margin-bottom: 0.75rem;"></i>
            <h4>No Urgent Compatible Emergencies in Your Radius</h4>
            <p style="font-size: 14px; margin-top: 4px;">You will be alerted immediately if a patient within your radius requires your blood type.</p>
          </div>
        `;
      } else {
        priorityContainer.innerHTML = data.priorityRequests.map((r) => renderRequestCard(r, true)).join('');
      }
    }

    // Render Community Requests
    if (communityContainer) {
      if (data.communityRequests.length === 0) {
        communityContainer.innerHTML = `
          <div style="grid-column: 1 / -1; background: #ffffff; border: 1px dashed var(--border-color); border-radius: 10px; padding: 2rem; text-align: center; color: #64748b;">
            <p>No other open community blood requests.</p>
          </div>
        `;
      } else {
        communityContainer.innerHTML = data.communityRequests.map((r) => renderRequestCard(r, false)).join('');
      }
    }

    // Load donor stats for dashboard metrics
    loadDashboardMetrics();
  } catch (err) {
    console.error('Error loading dashboard feed:', err.message);
  }
}

async function loadDashboardMetrics() {
  try {
    const [donorsRes, donationsRes] = await Promise.all([
      api.get('/users/find-donors', { radiusKm: 25 }),
      api.get('/donations/my-donations')
    ]);

    document.getElementById('dashNearbyDonors').textContent = donorsRes.count || 0;
    document.getElementById('dashMyDonations').textContent = donationsRes.totalDonations || 0;
    document.getElementById('dashLivesSaved').textContent = donationsRes.estimatedLivesSaved || 0;
  } catch (err) {}
}

function renderRequestCard(req, isPriority = false) {
  const urgencyClass = (req.urgency || 'urgent').toLowerCase();
  const hasValidDistance = req.formattedDistance && req.distanceKm !== null && req.distanceKm !== undefined;
  const distText = hasValidDistance
    ? `Distance from your location: ~${req.formattedDistance} away`
    : `Distance unavailable`;
  const currentUserId = (api.getCurrentUser() || {})._id;
  const isMyRequest = req.requesterId && (req.requesterId._id === currentUserId || req.requesterId === currentUserId);

  return `
    <div class="request-card ${isPriority ? 'priority-card' : ''}">
      <div class="card-top">
        <span class="blood-badge">${req.requiredBloodGroup}</span>
        <span class="urgency-pill ${urgencyClass}">${req.urgency}</span>
      </div>
      <h4 class="card-patient-name">${escapeHTML(req.patientName)} (Age: ${req.patientAge})</h4>
      <div class="card-info-item">
        <i class="fa-solid fa-hospital"></i>
        <span>${escapeHTML(req.hospitalName)}</span>
      </div>
      <div class="card-info-item">
        <i class="fa-solid fa-droplet"></i>
        <span>${req.unitsRequired} Unit(s) Needed</span>
      </div>
      <div class="card-distance-pill">
        <i class="fa-solid fa-location-arrow"></i> ${distText}
      </div>

      <div class="card-actions">
        <button class="btn btn-outline btn-sm" onclick="openRequestDetailsModal('${req._id}')">
          <i class="fa-solid fa-eye"></i> Details
        </button>
        ${!isMyRequest && req.requestStatus === 'open' ? `
          <button class="btn btn-primary btn-sm" onclick="acceptBloodRequest('${req._id}')">
            <i class="fa-solid fa-handshake-angle"></i> Accept Help
          </button>
        ` : ''}
        ${isMyRequest ? '<span style="font-size: 11px; font-weight: 700; color: #64748b; margin-left: auto;">Your Request</span>' : ''}
      </div>
    </div>
  `;
}

/**
 * Open Request Details Modal (with Medical Document Access)
 */
async function openRequestDetailsModal(requestId) {
  try {
    const data = await api.get(`/requests/${requestId}`);
    const req = data.request;

    document.getElementById('detailBloodGroup').textContent = req.requiredBloodGroup;
    document.getElementById('detailPatientName').textContent = `${req.patientName} (Age: ${req.patientAge})`;

    const urgencyBadge = document.getElementById('detailUrgencyBadge');
    if (urgencyBadge) {
      urgencyBadge.textContent = req.urgency;
      urgencyBadge.className = `urgency-badge ${req.urgency.toLowerCase()}`;
    }

    const currentUserId = (api.getCurrentUser() || {})._id;
    const isRequester = req.requesterId && req.requesterId._id === currentUserId;
    const isAcceptedDonor = req.acceptedDonors && req.acceptedDonors.some((d) => d.donorId?._id === currentUserId);
    const isAdmin = (api.getCurrentUser() || {}).role === 'admin';

    // Medical documents section
    let docsHtml = '<p class="text-muted" style="font-size: 13px;">No medical documents attached.</p>';
    if (req.medicalDocuments && req.medicalDocuments.length > 0) {
      const token = api.getToken();
      docsHtml = req.medicalDocuments.map((doc) => {
        const canView = isRequester || isAcceptedDonor || isAdmin;
        if (canView) {
          return `
            <a href="/api/requests/${req._id}/documents/${doc.filename}?token=${token}" target="_blank" class="btn btn-outline btn-sm" style="margin: 4px 4px 4px 0;">
              <i class="fa-solid fa-file-pdf"></i> View ${escapeHTML(doc.originalName)}
            </a>
          `;
        } else {
          return `
            <div style="font-size: 12px; color: #64748b; padding: 6px; background: #f1f5f9; border-radius: 4px; margin-top: 4px;">
              <i class="fa-solid fa-lock"></i> Confidential Medical Report attached (${escapeHTML(doc.originalName)}) &bull; Accessible upon accepting this emergency.
            </div>
          `;
        }
      }).join('');
    }

    // Automatic Radius Escalation Timeline HTML
    let escalationHtml = '';
    const historyList = req.radiusHistory || [];
    let historyRows = historyList.map((h) => `
      <div style="font-size: 12px; color: #475569; margin: 3px 0; display: flex; justify-content: space-between;">
        <span><i class="fa-solid fa-circle-check" style="color: #10b981;"></i> <strong>${h.radiusKm} km</strong> &bull; Triggered: ${new Date(h.triggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="text-muted">${h.donorsNotified || 0} notified</span>
      </div>
    `).join('');

    let nextEscalationText = '';
    if (req.requestStatus === 'open' && req.nextEscalationAt) {
      const nextTime = new Date(req.nextEscalationAt);
      const minsLeft = Math.max(0, Math.round((nextTime.getTime() - Date.now()) / 60000));
      nextEscalationText = `
        <div style="font-size: 12px; color: #be185d; font-weight: 600; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #fbcfe8;">
          <i class="fa-solid fa-clock-rotate-left"></i> Next auto-expansion: ${nextTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (~${minsLeft} min remaining)
        </div>
      `;
    } else if (req.requestStatus === 'open') {
      nextEscalationText = `
        <div style="font-size: 12px; color: #64748b; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e2e8f0;">
          <i class="fa-solid fa-circle-nodes"></i> Maximum broadcast tier reached (50 km). All regional donors notified.
        </div>
      `;
    } else {
      nextEscalationText = `
        <div style="font-size: 12px; color: #64748b; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e2e8f0;">
          <i class="fa-solid fa-lock"></i> Request ${req.requestStatus} &mdash; radius escalation concluded.
        </div>
      `;
    }

    escalationHtml = `
      <div style="background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 8px; padding: 0.85rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <strong style="color: #9d174d; font-size: 13px;"><i class="fa-solid fa-satellite-dish"></i> Automatic Radius Escalation Timeline</strong>
          <span style="background: #fce7f3; color: #be185d; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 11px;">Current: ${req.searchRadiusKm || 5} km</span>
        </div>
        ${historyRows || '<p style="font-size: 12px; color: #64748b;">Initial tier active.</p>'}
        ${nextEscalationText}
      </div>
    `;

    const bodyContainer = document.getElementById('requestDetailsBody');
    bodyContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.85rem;">
        <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px solid var(--border-color);">
          <p><strong>Hospital:</strong> ${escapeHTML(req.hospitalName)}</p>
          <p><strong>Hospital Location:</strong> ${escapeHTML(req.hospitalAddress)}</p>
          <p><strong>Distance:</strong> ${data.formattedDistance ? `Distance from your location: ~${data.formattedDistance} away` : 'Distance unavailable'}</p>
          <p><strong>Units Required:</strong> ${req.unitsRequired} unit(s)</p>
          <p><strong>Search Broadcast Radius:</strong> ${req.searchRadiusKm || 5} km</p>
          <p><strong>Status:</strong> <span style="text-transform: capitalize; font-weight: 700; color: #0284c7;">${req.requestStatus}</span></p>
          <p><strong>Contact Phone:</strong> <a href="tel:${req.contactPhone}">${escapeHTML(req.contactPhone)}</a></p>
          <p><strong>Contact Email:</strong> <a href="mailto:${req.contactEmail}">${escapeHTML(req.contactEmail)}</a></p>
          ${req.medicalCondition ? `<p style="margin-top: 6px;"><strong>Clinical Condition / Notes:</strong> ${escapeHTML(req.medicalCondition)}</p>` : ''}
        </div>

        ${escalationHtml}

        <div>
          <h4 style="font-size: 14px; margin-bottom: 6px;"><i class="fa-solid fa-shield-virus"></i> Confidential Medical Documentation</h4>
          ${docsHtml}
        </div>
      </div>
    `;

    // Footer actions
    const footer = document.getElementById('requestDetailsFooter');
    let buttons = '';

    if (!isRequester && req.requestStatus === 'open') {
      buttons += `
        <button class="btn btn-emergency" onclick="acceptBloodRequest('${req._id}')">
          <i class="fa-solid fa-handshake-angle"></i> Accept & Pledge Blood Donation
        </button>
      `;
    }

    if (isAcceptedDonor || isRequester) {
      buttons += `
        <button class="btn btn-primary" onclick="closeModal('requestDetailsModal'); switchView('chat'); openChatRoom('${req._id}');">
          <i class="fa-solid fa-comments"></i> Open Coordination Chat
        </button>
      `;
    }

    if ((isRequester || isAdmin) && req.requestStatus === 'accepted') {
      buttons += `
        <button class="btn btn-outline" style="color: #16a34a; border-color: #16a34a;" onclick="fulfillBloodRequest('${req._id}')">
          <i class="fa-solid fa-check"></i> Mark Fulfilled & Issue Certificate
        </button>
      `;
    }

    footer.innerHTML = buttons;
    openModal('requestDetailsModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Accept Blood Request (Section 25)
 */
async function acceptBloodRequest(requestId) {
  if (!confirm('Are you ready to pledge blood donation for this patient?')) return;

  try {
    const res = await api.put(`/requests/${requestId}/accept`);
    showToast('Thank you! You have accepted this blood request.', 'success');
    closeModal('requestDetailsModal');
    loadDashboardFeed();

    // Open chat room directly
    switchView('chat');
    openChatRoom(requestId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Fulfill Blood Request & generate certificate
 */
async function fulfillBloodRequest(requestId) {
  if (!confirm('Confirm blood donation fulfillment? This will generate official certificates of appreciation.')) return;

  try {
    const res = await api.put(`/requests/${requestId}/fulfill`);
    showToast(res.message, 'success');
    closeModal('requestDetailsModal');
    loadDashboardFeed();

    if (res.certificates && res.certificates.length > 0) {
      viewCertificate(res.certificates[0]._id);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Create Blood Request Handler
 */
async function handleCreateRequest(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('submitRequestBtn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const form = document.getElementById('createRequestForm');
    const formData = new FormData(form);

    // Read and trim form values
    const patientName = document.getElementById('reqPatientName')?.value?.trim();
    const patientAge = document.getElementById('reqPatientAge')?.value?.trim();
    const requiredBloodGroup = document.getElementById('reqBloodGroup')?.value;
    const unitsRequired = document.getElementById('reqUnits')?.value?.trim();
    const urgency = document.getElementById('reqUrgency')?.value || 'Urgent';
    const searchRadiusKm = document.getElementById('reqRadius')?.value || '15';
    const hospitalName = document.getElementById('reqHospitalName')?.value?.trim();
    const contactPhone = document.getElementById('reqContactPhone')?.value?.trim();
    const hospitalAddress = document.getElementById('reqHospitalAddress')?.value?.trim();
    const coordinates = document.getElementById('reqCoordinates')?.value;
    const medicalCondition = document.getElementById('reqMedicalCondition')?.value?.trim();

    // Frontend validation: check mandatory fields
    const missing = [];
    if (!patientName) missing.push('patientName');
    if (!requiredBloodGroup) missing.push('requiredBloodGroup');
    if (!unitsRequired) missing.push('unitsRequired');
    if (!hospitalName) missing.push('hospitalName');
    if (!hospitalAddress) missing.push('hospitalAddress');
    if (!contactPhone) missing.push('contactPhone');

    if (missing.length > 0) {
      const msg = missing.length === 1
        ? `Please fill mandatory field: ${missing[0]}.`
        : `Please fill all mandatory fields: ${missing.join(', ')}.`;
      showToast(msg, 'error');
      return;
    }

    if (!coordinates || coordinates.trim() === '' || coordinates === '""') {
      showToast('Please confirm hospital coordinates by clicking on the map.', 'error');
      return;
    }

    let parsedCoords = null;
    try {
      parsedCoords = JSON.parse(coordinates);
    } catch (e) {
      showToast('Invalid coordinates format. Please pick a location on the map.', 'error');
      return;
    }

    if (!Array.isArray(parsedCoords) || parsedCoords.length !== 2 || isNaN(parsedCoords[0]) || isNaN(parsedCoords[1])) {
      showToast('Please confirm hospital coordinates by clicking on the map.', 'error');
      return;
    }

    const [lon, lat] = parsedCoords;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      showToast('Selected coordinates are out of valid geographic range.', 'error');
      return;
    }

    // Ensure all collected values are set on formData (safeguard)
    formData.set('patientName', patientName);
    if (patientAge) formData.set('patientAge', patientAge);
    formData.set('requiredBloodGroup', requiredBloodGroup);
    formData.set('unitsRequired', unitsRequired);
    formData.set('urgency', urgency);
    formData.set('searchRadiusKm', searchRadiusKm);
    formData.set('hospitalName', hospitalName);
    formData.set('contactPhone', contactPhone);
    formData.set('hospitalAddress', hospitalAddress);
    formData.set('coordinates', coordinates);
    if (medicalCondition) formData.set('medicalCondition', medicalCondition);

    const data = await api.upload('/requests', formData);
    showToast(data.message, 'success');

    closeModal('createRequestModal');
    form.reset();

    // Reset default coordinates and label to unselected state
    const coordsInput = document.getElementById('reqCoordinates');
    if (coordsInput) coordsInput.value = '';
    const coordsLabel = document.getElementById('reqCoordsLabel');
    if (coordsLabel) coordsLabel.textContent = 'No location selected yet. Enter hospital address or click map.';
    updateLocationStatusBadge('reqLocationBadge', 'waiting', 'Waiting for address input');

    switchView('dashboard');
    loadDashboardFeed();
    if (typeof loadNotifications === 'function') {
      loadNotifications();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Submit User Complaint / Report Handler
 */
async function handleComplaintSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('complaintSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const subject = document.getElementById('complaintSubject').value.trim();
    const description = document.getElementById('complaintDescription').value.trim();
    if (!subject || !description) {
      showToast('Please provide both subject and description.', 'error');
      return;
    }

    const data = await api.post('/complaints', { subject, description });
    showToast(data.message || 'Report submitted successfully. Administrators will review it.', 'success');
    closeModal('complaintModal');
    document.getElementById('complaintForm').reset();
  } catch (err) {
    showToast(err.message || 'Failed to submit complaint', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Find Donors Search, Map & Filtering State & Logic (Section 16 & 17)
 */
let currentDonorSearchCoords = null;
let currentDonorSearchLocationName = '';
let currentDonorViewMode = 'list'; // 'list' | 'split'
let lastFoundDonors = [];
let currentMapCoords = null;

// Map center callbacks for interactive clicking
window.onDonorMapCenterChanged = function(coords) {
  loadDonorMapData(coords);
  if (typeof reverseGeocodeCoordinates === 'function') {
    reverseGeocodeCoordinates(coords[1], coords[0]).then((addr) => {
      const locInput = document.getElementById('mapLocationInput');
      if (locInput) locInput.value = addr;
      const centerLabel = document.getElementById('mapActiveCenterText');
      if (centerLabel) centerLabel.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Center: ${escapeHTML(addr)}`;
      showToast(`Search center updated to: ${addr}`, 'info');
    });
  }
};

window.onFindDonorMiniMapCenterChanged = function(coords) {
  searchDonors(coords);
  if (typeof reverseGeocodeCoordinates === 'function') {
    reverseGeocodeCoordinates(coords[1], coords[0]).then((addr) => {
      const locInput = document.getElementById('donorSearchLocation');
      if (locInput) locInput.value = addr;
      const centerLabel = document.getElementById('activeCenterLabel');
      if (centerLabel) centerLabel.textContent = addr;
      showToast(`Search center updated to: ${addr}`, 'info');
    });
  }
};

function setFindDonorViewMode(mode) {
  currentDonorViewMode = mode;
  const layout = document.getElementById('findDonorLayout');
  const mapPane = document.getElementById('findDonorMapPane');
  const listBtn = document.getElementById('findDonorViewListBtn');
  const splitBtn = document.getElementById('findDonorViewSplitBtn');

  if (mode === 'split') {
    layout?.classList.add('split-mode');
    mapPane?.classList.remove('hidden');
    listBtn?.classList.remove('active');
    splitBtn?.classList.add('active');

    const radiusKm = parseInt(document.getElementById('donorRadiusSlider')?.value, 10) || 25;
    setTimeout(() => {
      if (typeof renderFindDonorMiniMap === 'function') {
        renderFindDonorMiniMap(currentDonorSearchCoords || [77.6033, 12.9756], radiusKm, lastFoundDonors);
      }
    }, 100);
  } else {
    layout?.classList.remove('split-mode');
    mapPane?.classList.add('hidden');
    listBtn?.classList.add('active');
    splitBtn?.classList.remove('active');
  }
}

function resetDonorFilters() {
  const queryInput = document.getElementById('donorSearchQuery');
  if (queryInput) queryInput.value = '';

  const clearQueryBtn = document.getElementById('clearDonorSearchQueryBtn');
  if (clearQueryBtn) clearQueryBtn.classList.add('hidden');

  const locInput = document.getElementById('donorSearchLocation');
  if (locInput) locInput.value = '';

  const bloodGroupSelect = document.getElementById('donorFilterBloodGroup');
  if (bloodGroupSelect) bloodGroupSelect.value = '';

  const radiusSlider = document.getElementById('donorRadiusSlider');
  const radiusVal = document.getElementById('donorRadiusVal');
  if (radiusSlider) {
    radiusSlider.value = 25;
    radiusSlider.disabled = false;
  }
  if (radiusVal) radiusVal.textContent = '25 km';

  const noRadiusLimit = document.getElementById('donorNoRadiusLimit');
  if (noRadiusLimit) noRadiusLimit.checked = false;

  const availCheckbox = document.getElementById('filterAvailableOnly');
  if (availCheckbox) availCheckbox.checked = true;

  const onlineCheckbox = document.getElementById('filterOnlineOnly');
  if (onlineCheckbox) onlineCheckbox.checked = false;

  const compCheckbox = document.getElementById('filterCompatibleOnly');
  if (compCheckbox) compCheckbox.checked = false;

  currentDonorSearchCoords = null;
  currentDonorSearchLocationName = '';
  const centerLabel = document.getElementById('activeCenterLabel');
  if (centerLabel) centerLabel.textContent = 'Registered Location';

  searchDonors();
  showToast('Filters reset to default', 'info');
}

async function searchDonors(customCoords = null, locationTextOverride = null) {
  const container = document.getElementById('donorsContainer');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching eligible donors...</div>';

  try {
    const searchQuery = document.getElementById('donorSearchQuery')?.value?.trim();
    let locationText = locationTextOverride !== null ? locationTextOverride : document.getElementById('donorSearchLocation')?.value?.trim();
    const bloodGroup = document.getElementById('donorFilterBloodGroup')?.value;
    const isNoRadius = document.getElementById('donorNoRadiusLimit')?.checked;
    const radiusKm = isNoRadius ? 0 : (parseInt(document.getElementById('donorRadiusSlider')?.value, 10) || 25);
    const compatibleOnly = document.getElementById('filterCompatibleOnly')?.checked;
    const availableOnly = document.getElementById('filterAvailableOnly')?.checked;
    const onlineOnly = document.getElementById('filterOnlineOnly')?.checked;

    if (customCoords) {
      currentDonorSearchCoords = customCoords;
    }

    const params = {
      radiusKm: isNoRadius ? '0' : radiusKm,
      availableOnly: availableOnly ? 'true' : 'false',
      onlineOnly: onlineOnly ? 'true' : 'false'
    };

    if (searchQuery) params.search = searchQuery;
    if (locationText) params.locationText = locationText;
    if (bloodGroup) params.bloodGroup = bloodGroup;
    if (compatibleOnly) params.compatibleOnly = true;

    if (currentDonorSearchCoords) {
      params.centerLng = currentDonorSearchCoords[0];
      params.centerLat = currentDonorSearchCoords[1];
    }

    const data = await api.get('/users/find-donors', params);
    lastFoundDonors = data.donors || [];

    if (data.center && Array.isArray(data.center)) {
      currentDonorSearchCoords = data.center;
    }
    if (data.resolvedLocationName) {
      currentDonorSearchLocationName = data.resolvedLocationName;
      const centerLabel = document.getElementById('activeCenterLabel');
      if (centerLabel) centerLabel.textContent = data.resolvedLocationName;
    }

    const countText = document.getElementById('donorsFoundCount');
    if (countText) {
      const radiusLabel = isNoRadius ? 'all distances' : `${radiusKm} km`;
      countText.textContent = `Found ${data.count} eligible donors within ${radiusLabel}`;
    }

    const clearQueryBtn = document.getElementById('clearDonorSearchQueryBtn');
    if (clearQueryBtn) {
      if (searchQuery) clearQueryBtn.classList.remove('hidden');
      else clearQueryBtn.classList.add('hidden');
    }

    // Refresh mini map if in split mode
    if (currentDonorViewMode === 'split' && typeof renderFindDonorMiniMap === 'function') {
      renderFindDonorMiniMap(currentDonorSearchCoords || [77.6033, 12.9756], isNoRadius ? 50 : radiusKm, lastFoundDonors);
    }

    if (data.donors.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; color: #64748b; background: #ffffff; border-radius: 8px; border: 1px dashed var(--border-color);">
          <i class="fa-solid fa-users-slash fa-3x" style="opacity: 0.4; margin-bottom: 1rem;"></i>
          <h4>No Donors Found Within Filter Criteria</h4>
          <p style="font-size: 14px; margin-top: 4px;">Try expanding your search radius, unchecking filters, or searching nationwide.</p>
          <button class="btn btn-outline btn-sm" style="margin-top: 1rem;" onclick="resetDonorFilters()">
            <i class="fa-solid fa-rotate-left"></i> Reset All Filters
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = data.donors.map((d) => renderDonorCard(d, searchQuery)).join('');
  } catch (err) {
    container.innerHTML = `<div class="loading-spinner text-danger">${escapeHTML(err.message)}</div>`;
  }
}

function renderDonorCard(donor, searchQuery = '') {
  const isOnline = donor.isOnline;
  const isAvail = donor.isAvailableToDonate;
  const avatarStyle = donor.avatar ? `style="background-image: url(${donor.avatar});"` : '';
  const initial = (donor.name || 'D').charAt(0).toUpperCase();

  return `
    <div class="donor-card">
      <div class="donor-card-header">
        <div class="donor-avatar-wrap">
          <div class="donor-avatar" ${avatarStyle}>${donor.avatar ? '' : initial}</div>
          <span class="online-indicator ${isOnline ? 'online' : ''}" title="${isOnline ? 'Online Now' : 'Offline'}"></span>
        </div>
        <div class="donor-meta">
          <h4>${escapeHTML(donor.name)}</h4>
          <span class="donor-username">@${escapeHTML(donor.username || 'donor')} &bull; Age ${donor.age || 'N/A'}</span>
        </div>
      </div>

      <div class="donor-badges-row">
        <span class="blood-badge" style="font-size: 14px;">${donor.bloodGroup}</span>
        <span class="status-badge ${isAvail ? 'active' : 'inactive'}">
          ${isAvail ? 'Available to Donate' : 'Unavailable'}
        </span>
      </div>

      ${donor.email ? `
        <div class="donor-email-text" title="Registered Email">
          <i class="fa-solid fa-envelope"></i>
          <span>${escapeHTML(donor.email)}</span>
        </div>
      ` : ''}

      <div class="donor-location-text">
        <i class="fa-solid fa-location-dot"></i>
        <span>${escapeHTML(donor.city || donor.address || 'Bangalore')}</span>
      </div>
      <div class="donor-distance-text">
        <i class="fa-solid fa-route"></i> Distance: ~${donor.distanceKm || '0'} km
      </div>

      <div class="donor-card-footer">
        <button class="btn btn-outline btn-block btn-sm" onclick="openDirectEmergencyRequest('${donor._id}', '${escapeHTML(donor.name)}', '${donor.bloodGroup}')">
          <i class="fa-solid fa-hand-holding-medical"></i> Request Directly
        </button>
      </div>
    </div>
  `;
}

function openDirectEmergencyRequest(donorId, donorName, bloodGroup) {
  openModal('createRequestModal');
  const bgSelect = document.getElementById('reqBloodGroup');
  if (bgSelect) bgSelect.value = bloodGroup;
  showToast(`Creating request targeted for ${donorName} (${bloodGroup})`, 'info');
}

/**
 * Load Donor Map with Range Circle & Filters (Section 18)
 */
async function loadDonorMapData(customCoords = null) {
  if (!api.getToken()) return;

  const radiusKm = parseInt(document.getElementById('mapRadiusSelect')?.value || '15', 10);
  const bloodGroup = document.getElementById('mapBloodSelect')?.value;
  const searchInput = document.getElementById('mapSearchInput')?.value?.trim();
  const locationInput = document.getElementById('mapLocationInput')?.value?.trim();
  const availabilityVal = document.getElementById('mapAvailabilitySelect')?.value || 'available';
  const onlineOnly = document.getElementById('mapOnlineOnly')?.checked;

  if (customCoords) {
    currentMapCoords = customCoords;
  }

  try {
    const user = api.getCurrentUser();
    if (!currentMapCoords) {
      currentMapCoords = user?.location?.coordinates || [77.6033, 12.9756];
    }

    const params = {
      centerLng: currentMapCoords[0],
      centerLat: currentMapCoords[1],
      radiusKm: radiusKm === 0 ? '0' : radiusKm,
      availableOnly: availabilityVal === 'available' ? 'true' : (availabilityVal === 'unavailable' ? 'unavailable' : 'all'),
      onlineOnly: onlineOnly ? 'true' : 'false'
    };

    if (bloodGroup) params.bloodGroup = bloodGroup;
    if (searchInput) params.search = searchInput;
    if (locationInput) params.locationText = locationInput;

    const data = await api.get('/users/find-donors', params);

    if (data.center && Array.isArray(data.center)) {
      currentMapCoords = data.center;
    }

    const centerText = document.getElementById('mapActiveCenterText');
    if (centerText) {
      centerText.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Center: ${escapeHTML(data.resolvedLocationName || (user?.city || 'Bangalore'))}`;
    }

    renderDonorMap(currentMapCoords, radiusKm === 0 ? 50 : radiusKm, data.donors);
  } catch (err) {
    console.error('Error loading map data:', err.message);
  }
}

function resetMapFilters() {
  const locInput = document.getElementById('mapLocationInput');
  if (locInput) locInput.value = '';

  const searchInput = document.getElementById('mapSearchInput');
  if (searchInput) searchInput.value = '';

  const radiusSelect = document.getElementById('mapRadiusSelect');
  if (radiusSelect) radiusSelect.value = '15';

  const bloodSelect = document.getElementById('mapBloodSelect');
  if (bloodSelect) bloodSelect.value = '';

  const availSelect = document.getElementById('mapAvailabilitySelect');
  if (availSelect) availSelect.value = 'available';

  const onlineCheck = document.getElementById('mapOnlineOnly');
  if (onlineCheck) onlineCheck.checked = false;

  currentMapCoords = null;
  loadDonorMapData();
  showToast('Map filters reset to default', 'info');
}

/**
 * Load All Requests Feed View
 * @param {string} [status] - Blood request status to filter by ('open', 'accepted', 'fulfilled')
 */
async function loadAllRequestsFeed(status) {
  const container = document.getElementById('allRequestsFeedContainer');
  if (!container) return;

  // Resolve status from active tab pill if not explicitly passed
  if (status === undefined) {
    const activePill = document.querySelector('.tab-pills .tab-pill.active');
    status = activePill ? (activePill.getAttribute('data-req-status') || 'open') : 'open';
  }

  container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Fetching emergency requests...</div>';

  try {
    const endpoint = status ? `/requests?status=${encodeURIComponent(status)}` : '/requests';
    const data = await api.get(endpoint);
    const requests = data.allRequests || [];

    if (requests.length === 0) {
      let emptyMsg = 'No open blood requests currently.';
      if (status === 'accepted') {
        emptyMsg = 'No in-progress or accepted blood requests currently.';
      } else if (status === 'fulfilled') {
        emptyMsg = 'No fulfilled blood requests recorded.';
      }
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 3rem 1.5rem; text-align: center; color: var(--text-muted); background: #ffffff; border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
          <i class="fa-solid fa-notes-medical fa-3x" style="opacity: 0.35; margin-bottom: 0.75rem; color: var(--primary);"></i>
          <h4 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 0.35rem;">${emptyMsg}</h4>
          <p style="font-size: 0.88rem;">New requests will be displayed here in real time as they are submitted.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = requests.map((r) => renderRequestCard(r, false)).join('');
  } catch (err) {
    container.innerHTML = `<div class="loading-spinner text-danger" style="grid-column: 1 / -1;">${escapeHTML(err.message)}</div>`;
  }
}

/**
 * User Profile & History (Section 20, 21, 22)
 */
async function loadUserProfileData() {
  const user = api.getCurrentUser();
  if (!user) return;

  document.getElementById('profileFullName').textContent = user.name;
  document.getElementById('profileUsername').textContent = `@${user.username}`;
  document.getElementById('profileBloodPill').textContent = `Blood Group: ${user.bloodGroup}`;

  const availBadge = document.getElementById('profileAvailabilityBadge');
  if (availBadge) {
    availBadge.textContent = user.isAvailableToDonate ? 'Available' : 'Unavailable';
    availBadge.className = `status-badge ${user.isAvailableToDonate ? 'active' : 'inactive'}`;
  }

  // Populate Edit Form
  document.getElementById('editName').value = user.name || '';
  document.getElementById('editPhone').value = user.phone || '';
  document.getElementById('editAge').value = user.age || 25;
  document.getElementById('editCity').value = user.city || '';
  document.getElementById('editAddress').value = user.address || '';
  document.getElementById('editMedicalNotes').value = user.medicalNotes || '';

  const userCoords = user.location?.coordinates || [77.6033, 12.9756];
  document.getElementById('editCoordinates').value = JSON.stringify(userCoords);

  setTimeout(() => {
    initProfileMap(userCoords);
  }, 200);

  // Load donation history & requests history
  loadDonationsHistory();
  loadUserRequestsHistory();
}

async function loadDonationsHistory() {
  const list = document.getElementById('donationsHistoryList');
  if (!list) return;

  try {
    const data = await api.get('/donations/my-donations');

    document.getElementById('profileDonationsCount').textContent = data.totalDonations;
    document.getElementById('profileLivesSaved').textContent = data.estimatedLivesSaved;

    const cooldownText = document.getElementById('profileCooldownText');
    if (cooldownText) {
      cooldownText.textContent = data.daysUntilEligible > 0
        ? `In ${data.daysUntilEligible} days`
        : 'Eligible Now';
    }

    if (data.donations.length === 0) {
      list.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #64748b;">
          <i class="fa-solid fa-award fa-3x" style="opacity: 0.4; margin-bottom: 0.75rem;"></i>
          <h4>No Completed Donations Yet</h4>
          <p style="font-size: 14px;">Once you accept and fulfill a blood request, your verified donation record and Certificate of Appreciation will appear here.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = data.donations.map((d) => `
      <div style="background: #ffffff; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h4 style="font-size: 15px; margin-bottom: 2px;">${escapeHTML(d.hospitalName)}</h4>
          <p style="font-size: 13px; color: #64748b;">Donated for: <strong>${escapeHTML(d.patientName)}</strong> &bull; Blood: <strong>${d.bloodGroup}</strong> (${d.unitsDonated} Unit)</p>
          <small class="text-muted">Date: ${new Date(d.donationDate).toLocaleDateString()} &bull; Certificate ID: <strong style="color: #b91c1c;">${d.certificateId}</strong></small>
        </div>
        <button class="btn btn-outline btn-sm" onclick="viewCertificate('${d._id}')">
          <i class="fa-solid fa-certificate"></i> View Certificate
        </button>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p class="text-danger">${escapeHTML(err.message)}</p>`;
  }
}

async function loadUserRequestsHistory() {
  const list = document.getElementById('myRequestsHistoryList');
  if (!list) return;

  try {
    const data = await api.get('/donations/my-requests');
    document.getElementById('profileRequestsCount').textContent = data.count;

    if (data.requests.length === 0) {
      list.innerHTML = '<p class="text-muted" style="padding: 2rem; text-align: center;">You have not created any emergency blood requests yet.</p>';
      return;
    }

    list.innerHTML = data.requests.map((r) => `
      <div style="background: #ffffff; border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h4 style="font-size: 15px; margin-bottom: 2px;">${escapeHTML(r.patientName)} (${r.requiredBloodGroup})</h4>
          <p style="font-size: 13px; color: #64748b;">${escapeHTML(r.hospitalName)} &bull; ${r.unitsRequired} Unit(s)</p>
          <small class="text-muted">Status: <strong style="text-transform: capitalize;">${r.requestStatus}</strong> &bull; ${new Date(r.createdAt).toLocaleDateString()}</small>
        </div>
        <button class="btn btn-outline btn-sm" onclick="openRequestDetailsModal('${r._id}')">
          Manage
        </button>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p class="text-danger">${escapeHTML(err.message)}</p>`;
  }
}

/**
 * Handle Profile Update
 */
async function handleUpdateProfile(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('saveProfileBtn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const name = document.getElementById('editName').value;
    const phone = document.getElementById('editPhone').value;
    const age = document.getElementById('editAge').value;
    const city = document.getElementById('editCity').value;
    const address = document.getElementById('editAddress').value;
    const coordinates = document.getElementById('editCoordinates').value;
    const medicalNotes = document.getElementById('editMedicalNotes').value;

    const data = await api.put('/users/profile', {
      name,
      phone,
      age,
      city,
      address,
      coordinates,
      medicalNotes
    });

    api.setCurrentUser(data.user);
    updateAuthUI();
    showToast('Profile updated successfully.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Handle Profile Avatar Upload
 */
async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const res = await fetch('/api/users/profile', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${api.getToken()}`
      },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    api.setCurrentUser(data.user);
    updateAuthUI();
    showToast('Profile photo updated!', 'success');

    const large = document.getElementById('profileAvatarLarge');
    if (large && data.user.avatar) {
      large.style.backgroundImage = `url(${data.user.avatar})`;
      large.textContent = '';
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Profile Subtabs Switching
document.querySelectorAll('.profile-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.profile-tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.profile-tab-content').forEach((c) => c.classList.add('hidden'));

    btn.classList.add('active');
    const target = document.getElementById(btn.getAttribute('data-ptab'));
    if (target) target.classList.remove('hidden');
  });
});
