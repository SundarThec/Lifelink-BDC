/**
 * LifeLink Notifications & Alert Feed Manager
 */

let emailDiagnosticsLoaded = false;

async function loadNotifications() {
  if (!api.getToken()) return;

  try {
    const data = await api.get('/notifications');
    updateNotifBadge(data.unreadCount);
    renderNotificationsList(data.notifications);

    // Also update email diagnostics status pill
    loadEmailDiagnostics();
  } catch (err) {
    console.warn('Error loading notifications:', err.message);
  }
}

function updateNotifBadge(unreadCount) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;

  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotificationsList(notifications = []) {
  const container = document.getElementById('notificationsList');
  if (!container) return;

  if (notifications.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: #64748b;">
        <i class="fa-regular fa-bell-slash fa-3x" style="margin-bottom: 1rem; opacity: 0.5;"></i>
        <h4>No Alerts Yet</h4>
        <p style="font-size: 14px;">You will receive high-priority alerts here when blood requests matching your group are posted nearby.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = notifications.map((n) => {
    const isUnread = !n.isRead;
    const timeAgo = formatTimeAgo(new Date(n.createdAt));

    let icon = 'fa-solid fa-droplet text-emergency';
    let iconBg = '#fee2e2';

    if (n.type === 'REQUEST_ACCEPTED') {
      icon = 'fa-solid fa-user-check';
      iconBg = '#dcfce7';
    } else if (n.type === 'DONATION_FULFILLED') {
      icon = 'fa-solid fa-certificate';
      iconBg = '#fef3c7';
    } else if (n.type === 'ADMIN_BROADCAST') {
      icon = 'fa-solid fa-bullhorn';
      iconBg = '#e0e7ff';
    } else if (n.type === 'SYSTEM') {
      icon = 'fa-solid fa-bell';
      iconBg = '#f1f5f9';
    }

    // Build email delivery pill and preview triggers
    let emailMetaHtml = '';
    if (n.emailStatus === 'sent') {
      emailMetaHtml = `
        <div class="notif-email-meta">
          <span class="badge-email badge-email-sent" title="Notification dispatched via SMTP email">
            <i class="fa-solid fa-circle-check"></i> Email Sent
          </span>
          <button class="btn-notif-action" onclick="viewEmailNotification('${n._id}'); event.stopPropagation();" title="Preview rendered email notification">
            <i class="fa-solid fa-envelope-open-text"></i> View Email
          </button>
          ${n.emailPreviewUrl ? `
            <a href="${n.emailPreviewUrl}" target="_blank" class="link-preview-ethereal" onclick="event.stopPropagation();" title="Open Ethereal test mailbox">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Ethereal Link
            </a>
          ` : ''}
        </div>
      `;
    } else if (n.emailStatus === 'failed') {
      emailMetaHtml = `
        <div class="notif-email-meta">
          <span class="badge-email badge-email-failed" title="${escapeHTML(n.emailError || 'Email delivery failed')}">
            <i class="fa-solid fa-triangle-exclamation"></i> Email Failed
          </span>
          <button class="btn-notif-action" onclick="viewEmailNotification('${n._id}'); event.stopPropagation();" title="View email content">
            <i class="fa-solid fa-envelope-open-text"></i> View Content
          </button>
        </div>
      `;
    } else if (n.emailStatus === 'pending') {
      emailMetaHtml = `
        <div class="notif-email-meta">
          <span class="badge-email badge-email-pending">
            <i class="fa-solid fa-spinner fa-spin"></i> Dispatching Email...
          </span>
        </div>
      `;
    }

    return `
      <div class="notif-item ${isUnread ? 'unread' : ''}" onclick="handleNotifClick('${n._id}', '${n.requestId ? (n.requestId._id || n.requestId) : ''}')">
        <div class="notif-icon-box" style="background: ${iconBg};">
          <i class="${icon}"></i>
        </div>
        <div class="notif-content">
          <div class="notif-title">${escapeHTML(n.title)}</div>
          <div class="notif-message">${escapeHTML(n.message)}</div>
          <div class="notif-time"><i class="fa-regular fa-clock"></i> ${timeAgo}</div>
          ${emailMetaHtml}
        </div>
        ${isUnread ? '<span style="width: 8px; height: 8px; background: #dc2626; border-radius: 50%; margin-top: 6px; flex-shrink: 0;"></span>' : ''}
      </div>
    `;
  }).join('');
}

async function handleNotifClick(notifId, requestId) {
  try {
    await api.patch(`/notifications/${notifId}/read`);
    loadNotifications();

    if (requestId) {
      openRequestDetailsModal(requestId);
    }
  } catch (err) {
    console.error('Error handling notif click:', err.message);
  }
}

async function markAllNotificationsRead() {
  try {
    await api.patch('/notifications/mark-all-read');
    showToast('All notifications marked as read', 'success');
    loadNotifications();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Check and render Email Service Diagnostic pill
 */
async function loadEmailDiagnostics() {
  const pill = document.getElementById('emailStatusPill');
  if (!pill) return;

  try {
    const diag = await api.get('/notifications/diagnostics');
    if (diag.success) {
      if (diag.isRealSMTP) {
        pill.className = 'email-diag-pill smtp-active';
        pill.innerHTML = `<i class="fa-solid fa-circle-check"></i> Email: Active SMTP (${escapeHTML(diag.host)})`;
        pill.title = `Connected to production SMTP: ${diag.user} (${diag.fromAddress})`;
      } else {
        pill.className = 'email-diag-pill ethereal-active';
        pill.innerHTML = `<i class="fa-solid fa-flask"></i> Email: Test Mode (Ethereal Preview)`;
        pill.title = `Simulated verified delivery with web previews (${diag.fromAddress})`;
      }
    } else {
      pill.className = 'email-diag-pill smtp-error';
      pill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Email Error`;
      pill.title = diag.error || 'SMTP initialization failed';
    }
  } catch (err) {
    pill.className = 'email-diag-pill smtp-error';
    pill.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Email Service Unavailable`;
  }
}

/**
 * Trigger immediate test email to current user
 */
async function triggerTestEmail() {
  const btn = document.getElementById('testEmailBtn');
  if (btn) btn.disabled = true;

  try {
    showToast('Dispatching test notification email...', 'info');
    const res = await api.post('/notifications/test-email', {});

    if (res.success) {
      showToast(res.message, 'success');
      if (res.previewUrl) {
        console.log('Test email preview URL:', res.previewUrl);
      }
      loadNotifications();
    } else {
      showToast(res.message || 'Test email failed', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Failed to dispatch test email', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Open email preview modal for a notification
 */
async function viewEmailNotification(notifId) {
  try {
    const res = await api.get(`/notifications/${notifId}/email-preview`);
    if (!res.success) {
      showToast('Could not load email preview', 'error');
      return;
    }

    const titleEl = document.getElementById('emailPreviewModalTitle');
    const statusEl = document.getElementById('emailPreviewStatus');
    const etherealEl = document.getElementById('emailPreviewEtherealRow');
    const contentEl = document.getElementById('emailPreviewContent');

    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-solid fa-envelope-open-text text-primary"></i> ${escapeHTML(res.title)}`;
    }

    if (statusEl) {
      if (res.emailStatus === 'sent') {
        statusEl.innerHTML = '<span style="color: #16a34a; font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Dispatched Successfully</span>';
      } else if (res.emailStatus === 'failed') {
        statusEl.innerHTML = `<span style="color: #dc2626; font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Delivery Issue: ${escapeHTML(res.emailError || 'Failed')}</span>`;
      } else {
        statusEl.innerHTML = '<span style="color: #d97706; font-weight: bold;"><i class="fa-solid fa-clock"></i> Queued / In Transit</span>';
      }
    }

    if (etherealEl) {
      if (res.emailPreviewUrl) {
        etherealEl.innerHTML = `<strong>Ethereal Web Preview:</strong> <a href="${res.emailPreviewUrl}" target="_blank" style="color: #2563eb; text-decoration: underline;">Open External Mailbox <i class="fa-solid fa-arrow-up-right-from-square"></i></a>`;
      } else {
        etherealEl.innerHTML = '';
      }
    }

    if (contentEl) {
      contentEl.innerHTML = res.emailHtml || '<p style="color: #64748b; padding: 20px; text-align: center;">No email body preview available.</p>';
    }

    openModal('emailPreviewModal');
  } catch (err) {
    showToast('Failed to load email preview: ' + err.message, 'error');
  }
}

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// Hook up DOM event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const markNotifsBtn = document.getElementById('markAllNotifsReadBtn');
  if (markNotifsBtn) {
    markNotifsBtn.addEventListener('click', markAllNotificationsRead);
  }

  const testEmailBtn = document.getElementById('testEmailBtn');
  if (testEmailBtn) {
    testEmailBtn.addEventListener('click', triggerTestEmail);
  }

  const closeEmailPreviewModalBtn = document.getElementById('closeEmailPreviewModal');
  if (closeEmailPreviewModalBtn) {
    closeEmailPreviewModalBtn.addEventListener('click', () => closeModal('emailPreviewModal'));
  }

  const closeEmailPreviewBtn = document.getElementById('closeEmailPreviewBtn');
  if (closeEmailPreviewBtn) {
    closeEmailPreviewBtn.addEventListener('click', () => closeModal('emailPreviewModal'));
  }
});
