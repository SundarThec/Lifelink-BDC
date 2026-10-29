/**
 * LifeLink Administrator Management Console
 * Enhanced with User Moderation (Block/Unblock, Verify, Soft-Delete)
 * and Administrative Broadcast Controls.
 */

async function loadAdminDashboard() {
  if (!api.getToken()) return;

  try {
    const data = await api.get('/admin/metrics');
    const m = data.metrics;

    document.getElementById('adminTotalUsers').textContent = m.totalUsers;
    document.getElementById('adminActiveDonors').textContent = m.activeDonors;
    document.getElementById('adminTotalRequests').textContent = m.totalRequests;
    document.getElementById('adminFulfillmentRate').textContent = `${m.fulfillmentRate}%`;
    document.getElementById('adminLivesSaved').textContent = m.estimatedLivesSaved;

    loadAdminUsers();
    loadAdminRequests();
    loadAdminComplaints();
    loadAdminBroadcastLogs();
    loadAdminAuditLogs();
  } catch (err) {
    showToast(`Admin access error: ${err.message}`, 'error');
  }
}

let adminUsersCurrentPage = 1;
const adminUsersLimit = 25;

/**
 * 1. User Management Table with Live Filters & Server Pagination
 */
async function loadAdminUsers(page = 1) {
  try {
    adminUsersCurrentPage = page;
    const search = document.getElementById('adminUserSearch')?.value || '';
    const city = document.getElementById('adminUserCity')?.value || '';
    const bloodGroup = document.getElementById('adminUserBloodGroup')?.value || '';
    const minAge = document.getElementById('adminUserMinAge')?.value || '';
    const maxAge = document.getElementById('adminUserMaxAge')?.value || '';
    const availability = document.getElementById('adminUserAvailability')?.value || '';
    const isOnline = document.getElementById('adminUserOnline')?.value || '';
    const role = document.getElementById('adminUserRole')?.value || '';
    const blockedStatus = document.getElementById('adminUserBlocked')?.value || '';

    const params = {
      page: adminUsersCurrentPage,
      limit: adminUsersLimit
    };
    if (search.trim()) params.search = search.trim();
    if (city.trim()) params.city = city.trim();
    if (bloodGroup) params.bloodGroup = bloodGroup;
    if (minAge) params.minAge = minAge;
    if (maxAge) params.maxAge = maxAge;
    if (availability !== '') params.availability = availability;
    if (isOnline !== '') params.isOnline = isOnline;
    if (role !== '') params.role = role;
    if (blockedStatus !== '') params.isBlocked = blockedStatus;

    const data = await api.get('/admin/users', params);
    const tbody = document.querySelector('#adminUsersTable tbody');
    if (!tbody) return;

    // Update Pagination UI
    const countDisplay = document.getElementById('adminUserCountDisplay');
    const pageInfo = document.getElementById('adminUserPageInfo');
    const prevBtn = document.getElementById('adminUserPrevPage');
    const nextBtn = document.getElementById('adminUserNextPage');

    if (countDisplay) countDisplay.textContent = `Showing ${data.count || 0} of ${data.total || 0} users`;
    if (pageInfo) pageInfo.textContent = `Page ${data.page || 1} of ${data.pages || 1}`;
    if (prevBtn) prevBtn.disabled = !data.page || data.page <= 1;
    if (nextBtn) nextBtn.disabled = !data.page || !data.pages || data.page >= data.pages;

    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 2rem;">No matching users found.</td></tr>';
      return;
    }

    tbody.innerHTML = data.users.map((u) => {
      const isBlocked = !!u.isBlocked;
      const isVerified = !!u.isVerified;
      const isAvail = !!u.isAvailableToDonate;
      const online = !!u.isOnline;

      return `
        <tr style="${isBlocked ? 'background-color: #fff1f2;' : ''}">
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span title="${online ? 'Online' : 'Offline'}" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${online ? '#10b981' : '#94a3b8'};"></span>
              <div>
                <strong>${escapeHTML(u.name)}</strong>
                ${isVerified ? '<span title="Verified Donor" style="color: #0284c7; margin-left: 4px;"><i class="fa-solid fa-circle-check"></i></span>' : ''}
                <br>
                <small class="text-muted">@${escapeHTML(u.username)} ${u.role === 'admin' ? '<span style="color:#b91c1c; font-weight:bold;">(Admin)</span>' : ''} &bull; Age: ${u.age || 'N/A'}${u.city ? ` &bull; ${escapeHTML(u.city)}` : ''}</small>
              </div>
            </div>
          </td>
          <td>
            <small>${escapeHTML(u.email)}</small><br>
            <small class="text-muted">${escapeHTML(u.phone)}</small>
          </td>
          <td><span class="blood-badge" style="font-size: 13px;">${u.bloodGroup}</span></td>
          <td>
            <span class="status-badge ${isAvail ? 'active' : 'inactive'}" style="font-size: 11px;">
              ${isAvail ? 'Available' : 'Unavailable'}
            </span>
          </td>
          <td>
            ${isBlocked ? '<span class="status-badge" style="background:#fecaca; color:#b91c1c; font-weight:700;">Blocked</span>' : '<span class="status-badge active">Active</span>'}
          </td>
          <td>
            ${isVerified ? '<span class="text-primary font-weight-bold" style="font-size:12px;"><i class="fa-solid fa-check"></i> Verified</span>' : '<span class="text-muted" style="font-size:12px;">Unverified</span>'}
          </td>
          <td>${u.totalDonations || 0}</td>
          <td>
            <div style="display: flex; gap: 4px; align-items: center;">
              <!-- Verify / Unverify Button -->
              <button class="btn btn-outline btn-sm" onclick="adminToggleVerifyUser('${u._id}')" title="${isVerified ? 'Unverify' : 'Verify'} Profile" style="color: ${isVerified ? '#0284c7' : '#64748b'};">
                <i class="fa-solid fa-stamp"></i>
              </button>

              <!-- Role Toggle Button -->
              <button class="btn btn-outline btn-sm" onclick="adminChangeUserRole('${u._id}', '${u.role}')" title="Change Role (Current: ${u.role})" style="color: #6366f1;">
                <i class="fa-solid fa-user-shield"></i>
              </button>

              <!-- Block / Unblock Button -->
              ${u.role !== 'admin' ? `
                <button class="btn btn-outline btn-sm ${isBlocked ? 'text-primary' : 'text-danger'}" onclick="adminToggleBlockUser('${u._id}', ${isBlocked})" title="${isBlocked ? 'Unblock user' : 'Block user'}">
                  <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'}"></i>
                </button>

                <!-- Soft Delete Button -->
                <button class="btn btn-outline btn-sm text-danger" onclick="adminSoftDeleteUser('${u._id}', '${escapeHTML(u.name)}')" title="Deactivate / Delete user">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '<small class="text-muted">Protected</small>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading admin users:', err.message);
  }
}

/**
 * Change User Role (Admin <-> User)
 */
async function adminChangeUserRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  if (!confirm(`Change user role from "${currentRole}" to "${newRole}"?`)) return;
  try {
    const res = await api.patch(`/admin/users/${userId}/role`, { role: newRole });
    showToast(res.message, 'success');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Block / Unblock User
 */
async function adminToggleBlockUser(userId, currentBlockedState) {
  const actionText = currentBlockedState ? 'unblock' : 'block';
  if (!confirm(`Are you sure you want to ${actionText} this user account?`)) return;

  try {
    const endpoint = currentBlockedState
      ? `/admin/users/${userId}/unblock`
      : `/admin/users/${userId}/block`;

    const res = await api.patch(endpoint);
    showToast(res.message, 'success');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Verify / Unverify User Profile
 */
async function adminToggleVerifyUser(userId) {
  try {
    const res = await api.patch(`/admin/users/${userId}/verify`);
    showToast(res.message, 'success');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Soft Delete User Account
 */
async function adminSoftDeleteUser(userId, userName) {
  if (!confirm(`Are you sure you want to deactivate and remove user "${userName}"? This will soft-delete their account.`)) return;

  try {
    const res = await api.delete(`/admin/users/${userId}`);
    showToast(res.message, 'success');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * 2. Administrative Broadcast & Announcements
 */
async function handleSendBroadcast(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('sendBroadcastBtn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const title = document.getElementById('broadcastTitle').value;
    const message = document.getElementById('broadcastMessage').value;
    const availableOnly = document.getElementById('broadcastAvailableOnly')?.checked || false;

    // Selected blood groups
    const bgChecks = document.querySelectorAll('.broadcast-bg-check:checked');
    const bloodGroups = Array.from(bgChecks).map((cb) => cb.value);

    // Optional region filtering
    let region = null;
    const centerLat = parseFloat(document.getElementById('broadcastCenterLat')?.value);
    const centerLng = parseFloat(document.getElementById('broadcastCenterLng')?.value);
    const radiusKm = parseFloat(document.getElementById('broadcastRadiusKm')?.value);

    if (!isNaN(centerLat) && !isNaN(centerLng) && !isNaN(radiusKm) && radiusKm > 0) {
      region = {
        center: [centerLng, centerLat],
        radiusKm
      };
    }

    const payload = {
      title,
      message,
      target: {
        bloodGroups,
        availableOnly,
        region
      }
    };

    const res = await api.post('/admin/broadcast', payload);
    showToast(`Broadcast sent to ${res.recipientCount} community member(s)!`, 'success');

    // Reset form
    document.getElementById('adminBroadcastForm').reset();
    loadAdminBroadcastLogs();
  } catch (err) {
    showToast(`Broadcast failed: ${err.message}`, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * 3. Load Broadcast Logs History
 */
async function loadAdminBroadcastLogs() {
  try {
    const data = await api.get('/admin/broadcasts');
    const tbody = document.querySelector('#adminBroadcastLogsTable tbody');
    if (!tbody) return;

    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 2rem;">No broadcast announcements recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.logs.map((log) => {
      const target = log.targetCriteria || {};
      const bgText = target.bloodGroups && target.bloodGroups.length > 0 ? target.bloodGroups.join(', ') : 'All Groups';
      const regionText = target.region ? `Within ${target.region.radiusKm} km` : 'All Regions';
      const availText = target.availableOnly ? ' (Available Only)' : '';

      return `
        <tr>
          <td><small>${new Date(log.sentAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</small></td>
          <td><strong>${escapeHTML(log.title)}</strong></td>
          <td><small>${escapeHTML(log.message)}</small></td>
          <td><small class="text-muted">${escapeHTML(bgText)} &bull; ${escapeHTML(regionText)}${availText}</small></td>
          <td><span class="blood-badge" style="background:#e0e7ff; color:#3730a3; font-weight:700;">${log.recipientCount}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error loading broadcast logs:', err.message);
  }
}

/**
 * 4. Request Oversight
 */
async function loadAdminRequests() {
  try {
    const data = await api.get('/admin/requests');
    const tbody = document.querySelector('#adminRequestsTable tbody');
    if (!tbody) return;

    if (!data.requests || data.requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">No blood requests on record.</td></tr>';
      return;
    }

    tbody.innerHTML = data.requests.map((r) => {
      const isFlagged = !!r.isFlagged;
      const isInactive = r.requestStatus === 'cancelled' || r.requestStatus === 'fulfilled';

      return `
        <tr style="${isFlagged ? 'background-color: #fef2f2;' : ''}">
          <td>
            <strong>${escapeHTML(r.patientName)}</strong>
            ${isFlagged ? `<br><small style="color:#dc2626; font-weight:700;"><i class="fa-solid fa-flag"></i> Flagged: ${escapeHTML(r.flagReason || 'Suspicious')}</small>` : ''}
          </td>
          <td><span class="blood-badge" style="font-size: 13px;">${r.requiredBloodGroup}</span></td>
          <td>${r.unitsRequired} Unit(s)</td>
          <td>${escapeHTML(r.hospitalName)}</td>
          <td><span class="urgency-pill ${r.urgency.toLowerCase()}">${r.urgency}</span></td>
          <td><span class="status-badge ${r.requestStatus === 'fulfilled' ? 'active' : 'inactive'}">${r.requestStatus}</span></td>
          <td><small>${new Date(r.createdAt).toLocaleDateString()}</small></td>
          <td>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button class="btn btn-outline btn-sm" onclick="openRequestDetailsModal('${r._id}')" title="View Details">
                View
              </button>
              ${isFlagged ? `
                <button class="btn btn-outline btn-sm text-primary" onclick="adminUnflagRequest('${r._id}')" title="Unflag Request">
                  <i class="fa-solid fa-flag"></i>
                </button>
              ` : `
                <button class="btn btn-outline btn-sm text-danger" onclick="adminFlagRequest('${r._id}')" title="Flag as Suspicious">
                  <i class="fa-regular fa-flag"></i>
                </button>
              `}
              ${!isInactive ? `
                <button class="btn btn-outline btn-sm text-danger" onclick="adminCancelFraudRequest('${r._id}')" title="Cancel Suspicious/Fraudulent Request">
                  <i class="fa-solid fa-ban"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading admin requests:', err.message);
  }
}

async function adminFlagRequest(id) {
  const reason = prompt('Enter reason for flagging this request as suspicious:');
  if (!reason) return;
  try {
    await api.patch(`/admin/requests/${id}/flag`, { reason });
    showToast('Request flagged for review.', 'success');
    loadAdminRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminUnflagRequest(id) {
  try {
    await api.patch(`/admin/requests/${id}/unflag`);
    showToast('Flag removed from request.', 'success');
    loadAdminRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminCancelFraudRequest(id) {
  const reason = prompt('Enter reason for cancelling this fraudulent/suspicious request:');
  if (!reason) return;
  try {
    await api.patch(`/admin/requests/${id}/cancel`, { reason });
    showToast('Request administratively cancelled.', 'success');
    loadAdminRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * 5. Complaints Oversight
 */
async function loadAdminComplaints() {
  try {
    const data = await api.get('/admin/complaints');
    const tbody = document.querySelector('#adminComplaintsTable tbody');
    if (!tbody) return;

    if (!data.complaints || data.complaints.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No complaints or inquiries pending.</td></tr>';
      return;
    }

    tbody.innerHTML = data.complaints.map((c) => {
      const isResolved = c.status === 'resolved';
      const isRejected = c.status === 'rejected';

      return `
        <tr>
          <td><strong>${escapeHTML(c.subject)}</strong></td>
          <td>${escapeHTML(c.userId?.name || 'Anonymous')}</td>
          <td><small>${escapeHTML(c.description)}</small></td>
          <td><span class="status-badge ${isResolved ? 'active' : (isRejected ? 'inactive' : 'warning')}">${c.status}</span></td>
          <td><small>${new Date(c.createdAt).toLocaleDateString()}</small></td>
          <td>
            ${!isResolved && !isRejected ? `
              <div style="display: flex; gap: 4px;">
                <button class="btn btn-outline btn-sm" onclick="adminResolveComplaint('${c._id}')" title="Resolve Complaint">
                  Resolve
                </button>
                <button class="btn btn-outline btn-sm text-danger" onclick="adminRejectComplaint('${c._id}')" title="Reject Complaint">
                  Reject
                </button>
              </div>
            ` : (isResolved ? '<span class="text-primary"><i class="fa-solid fa-check"></i> Resolved</span>' : '<span class="text-danger"><i class="fa-solid fa-xmark"></i> Rejected</span>')}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading admin complaints:', err.message);
  }
}

async function adminResolveComplaint(id) {
  const reply = prompt('Enter administrative resolution notes:');
  if (reply === null) return;

  try {
    await api.patch(`/admin/complaints/${id}/resolve`, { adminResponse: reply });
    showToast('Complaint resolved successfully.', 'success');
    loadAdminComplaints();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminRejectComplaint(id) {
  const reason = prompt('Enter reason for rejecting this complaint:');
  if (reason === null) return;

  try {
    await api.patch(`/admin/complaints/${id}/reject`, { reason });
    showToast('Complaint marked as rejected.', 'success');
    loadAdminComplaints();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * 6. Audit Trail History
 */
async function loadAdminAuditLogs() {
  try {
    const action = document.getElementById('auditActionFilter')?.value || '';
    const targetType = document.getElementById('auditTargetFilter')?.value || '';
    const date = document.getElementById('auditDateFilter')?.value || '';

    const params = { limit: 50 };
    if (action) params.action = action;
    if (targetType) params.targetType = targetType;
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      params.startDate = start.toISOString();
      params.endDate = end.toISOString();
    }

    const data = await api.get('/admin/audit-logs', params);
    const tbody = document.querySelector('#adminAuditLogsTable tbody');
    if (!tbody) return;

    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 2rem;">No audit logs recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.logs.map((log) => {
      const details = typeof log.details === 'object' ? JSON.stringify(log.details) : (log.details || '');
      return `
        <tr>
          <td><small>${new Date(log.createdAt || log.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</small></td>
          <td><strong>${escapeHTML(log.adminName || 'Admin')}</strong></td>
          <td><span class="status-badge active" style="font-size:11px;">${escapeHTML(log.action)}</span></td>
          <td><small>${escapeHTML(log.targetType || '')} ${escapeHTML(log.targetId ? `(${log.targetId})` : '')}</small></td>
          <td><small>${escapeHTML(log.reason || details || 'N/A')}</small></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error loading audit logs:', err.message);
  }
}

/**
 * Initialize Admin Event Handlers
 */
function initAdminHandlers() {
  // Admin Sub Tab Switching
  const tabs = document.querySelectorAll('.admin-tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-panel').forEach((p) => p.classList.add('hidden'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(tab.getAttribute('data-atab'));
      if (targetPanel) targetPanel.classList.remove('hidden');

      if (tab.getAttribute('data-atab') === 'admin-broadcast-logs-tab') {
        loadAdminBroadcastLogs();
      } else if (tab.getAttribute('data-atab') === 'admin-audit-tab') {
        loadAdminAuditLogs();
      }
    });
  });

  // User Filter Listeners
  const searchInput = document.getElementById('adminUserSearch');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => loadAdminUsers(1), 300));
  }

  const cityInput = document.getElementById('adminUserCity');
  if (cityInput) {
    cityInput.addEventListener('input', debounce(() => loadAdminUsers(1), 300));
  }

  const minAgeInput = document.getElementById('adminUserMinAge');
  if (minAgeInput) {
    minAgeInput.addEventListener('input', debounce(() => loadAdminUsers(1), 300));
  }

  const maxAgeInput = document.getElementById('adminUserMaxAge');
  if (maxAgeInput) {
    maxAgeInput.addEventListener('input', debounce(() => loadAdminUsers(1), 300));
  }

  const bgFilter = document.getElementById('adminUserBloodGroup');
  if (bgFilter) {
    bgFilter.addEventListener('change', () => loadAdminUsers(1));
  }

  const availFilter = document.getElementById('adminUserAvailability');
  if (availFilter) {
    availFilter.addEventListener('change', () => loadAdminUsers(1));
  }

  const onlineFilter = document.getElementById('adminUserOnline');
  if (onlineFilter) {
    onlineFilter.addEventListener('change', () => loadAdminUsers(1));
  }

  const roleFilter = document.getElementById('adminUserRole');
  if (roleFilter) {
    roleFilter.addEventListener('change', () => loadAdminUsers(1));
  }

  const blockFilter = document.getElementById('adminUserBlocked');
  if (blockFilter) {
    blockFilter.addEventListener('change', () => loadAdminUsers(1));
  }

  // User Pagination
  document.getElementById('adminUserPrevPage')?.addEventListener('click', () => {
    if (adminUsersCurrentPage > 1) {
      loadAdminUsers(adminUsersCurrentPage - 1);
    }
  });

  document.getElementById('adminUserNextPage')?.addEventListener('click', () => {
    loadAdminUsers(adminUsersCurrentPage + 1);
  });

  // User Filter Reset
  document.getElementById('adminUserResetFiltersBtn')?.addEventListener('click', () => {
    if (document.getElementById('adminUserSearch')) document.getElementById('adminUserSearch').value = '';
    if (document.getElementById('adminUserCity')) document.getElementById('adminUserCity').value = '';
    if (document.getElementById('adminUserBloodGroup')) document.getElementById('adminUserBloodGroup').value = '';
    if (document.getElementById('adminUserMinAge')) document.getElementById('adminUserMinAge').value = '';
    if (document.getElementById('adminUserMaxAge')) document.getElementById('adminUserMaxAge').value = '';
    if (document.getElementById('adminUserAvailability')) document.getElementById('adminUserAvailability').value = '';
    if (document.getElementById('adminUserOnline')) document.getElementById('adminUserOnline').value = '';
    if (document.getElementById('adminUserRole')) document.getElementById('adminUserRole').value = '';
    if (document.getElementById('adminUserBlocked')) document.getElementById('adminUserBlocked').value = '';
    loadAdminUsers(1);
  });

  // Audit Filter Listeners
  document.getElementById('auditActionFilter')?.addEventListener('change', loadAdminAuditLogs);
  document.getElementById('auditTargetFilter')?.addEventListener('change', loadAdminAuditLogs);
  document.getElementById('auditDateFilter')?.addEventListener('change', loadAdminAuditLogs);
  document.getElementById('auditResetFilterBtn')?.addEventListener('click', () => {
    if (document.getElementById('auditActionFilter')) document.getElementById('auditActionFilter').value = '';
    if (document.getElementById('auditTargetFilter')) document.getElementById('auditTargetFilter').value = '';
    if (document.getElementById('auditDateFilter')) document.getElementById('auditDateFilter').value = '';
    loadAdminAuditLogs();
  });

  // Admin Broadcast Form Submission
  const broadcastForm = document.getElementById('adminBroadcastForm');
  if (broadcastForm) {
    broadcastForm.addEventListener('submit', handleSendBroadcast);
  }

  // CSV Export Buttons
  const exportUsersBtn = document.getElementById('exportUsersCsvBtn');
  if (exportUsersBtn) {
    exportUsersBtn.addEventListener('click', () => {
      const token = api.getToken();
      window.open(`/api/v1/admin/export/users-csv?token=${token}`, '_blank');
    });
  }

  const exportRequestsBtn = document.getElementById('exportRequestsCsvBtn');
  if (exportRequestsBtn) {
    exportRequestsBtn.addEventListener('click', () => {
      const token = api.getToken();
      window.open(`/api/v1/admin/export/requests-csv?token=${token}`, '_blank');
    });
  }
}

// Utility debounce
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
