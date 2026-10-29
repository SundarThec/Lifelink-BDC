/**
 * LifeLink Authentication & Session State Manager
 */

let currentUser = null;

/**
 * Update UI for authenticated / unauthenticated states
 */
function updateAuthUI() {
  currentUser = api.getCurrentUser();
  const token = api.getToken();

  const authButtons = document.getElementById('authButtons');
  const userMenuWrap = document.getElementById('userMenuWrap');
  const navAdminBtn = document.getElementById('navAdminBtn');

  if (token && currentUser) {
    if (authButtons) authButtons.classList.add('hidden');
    if (userMenuWrap) userMenuWrap.classList.remove('hidden');

    // Populate user details in header
    const headerName = document.getElementById('headerUserName');
    const headerBlood = document.getElementById('headerBloodGroup');
    const headerAvatar = document.getElementById('headerAvatar');
    const dropdownName = document.getElementById('dropdownFullName');
    const dropdownEmail = document.getElementById('dropdownEmail');
    const availToggle = document.getElementById('headerAvailabilityToggle');

    if (headerName) headerName.textContent = currentUser.name.split(' ')[0];
    if (headerBlood) headerBlood.textContent = currentUser.bloodGroup;
    if (dropdownName) dropdownName.textContent = currentUser.name;
    if (dropdownEmail) dropdownEmail.textContent = currentUser.email;

    if (headerAvatar) {
      if (currentUser.avatar) {
        headerAvatar.style.backgroundImage = `url(${currentUser.avatar})`;
        headerAvatar.textContent = '';
      } else {
        headerAvatar.style.backgroundImage = 'none';
        headerAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
      }
    }

    if (availToggle) {
      availToggle.checked = currentUser.isAvailableToDonate !== false;
    }

    // Admin button visibility
    if (navAdminBtn) {
      if (currentUser.role === 'admin') {
        navAdminBtn.classList.remove('hidden');
      } else {
        navAdminBtn.classList.add('hidden');
      }
    }

    // Show authenticated user elements
    document.querySelectorAll('.user-only').forEach((el) => el.classList.remove('hidden'));

    // Register user with Socket.IO for live emergency alerts
    if (window.appSocket && window.appSocket.connected) {
      window.appSocket.emit('register_user', { userId: currentUser._id, token: api.getToken() });
    }
  } else {
    if (authButtons) authButtons.classList.remove('hidden');
    if (userMenuWrap) userMenuWrap.classList.add('hidden');
    if (navAdminBtn) navAdminBtn.classList.add('hidden');
    document.querySelectorAll('.user-only').forEach((el) => el.classList.add('hidden'));
  }
}

/**
 * Handle user registration
 */
async function handleRegister(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('regSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const name = document.getElementById('regName').value;
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const password = document.getElementById('regPassword').value;
    const age = document.getElementById('regAge').value;
    const bloodGroup = document.getElementById('regBloodGroup').value;
    const city = document.getElementById('regCity').value;
    const address = document.getElementById('regAddress').value;
    const coordinates = document.getElementById('regCoordinates').value;
    const isAvailableToDonate = document.getElementById('regAvailable').checked;

    const data = await api.post('/auth/register', {
      name,
      username,
      email,
      phone,
      password,
      age,
      bloodGroup,
      city,
      address,
      coordinates,
      isAvailableToDonate
    });

    api.setToken(data.token);
    api.setCurrentUser(data.user);
    updateAuthUI();

    showToast('Account registered successfully! Welcome to LifeLink.', 'success');
    closeModal('registerModal');
    switchView('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Switch Login Mode: 'user' | 'admin'
 */
function setLoginRoleTab(role) {
  const tabUser = document.getElementById('tabUserLogin');
  const tabAdmin = document.getElementById('tabAdminLogin');
  const hiddenType = document.getElementById('loginType');
  const notice = document.getElementById('adminLoginNotice');
  const submitText = document.getElementById('loginSubmitText');
  const modalTitle = document.getElementById('loginModalTitle');
  const modalSubtitle = document.getElementById('loginModalSubtitle');
  const regFooter = document.getElementById('loginRegisterFooter');

  if (role === 'admin') {
    if (tabAdmin) {
      tabAdmin.classList.add('active');
      tabAdmin.style.background = '#ffffff';
      tabAdmin.style.color = '#b91c1c';
      tabAdmin.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    }
    if (tabUser) {
      tabUser.classList.remove('active');
      tabUser.style.background = 'transparent';
      tabUser.style.color = '#64748b';
      tabUser.style.boxShadow = 'none';
    }
    if (hiddenType) hiddenType.value = 'admin';
    if (notice) notice.classList.remove('hidden');
    if (submitText) submitText.textContent = 'Login as Administrator';
    if (modalTitle) modalTitle.textContent = 'Administrator Portal Login';
    if (modalSubtitle) modalSubtitle.textContent = 'Restricted access for system administrators & moderators only.';
    if (regFooter) regFooter.classList.add('hidden');
  } else {
    if (tabUser) {
      tabUser.classList.add('active');
      tabUser.style.background = '#ffffff';
      tabUser.style.color = 'var(--text-color)';
      tabUser.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    }
    if (tabAdmin) {
      tabAdmin.classList.remove('active');
      tabAdmin.style.background = 'transparent';
      tabAdmin.style.color = '#64748b';
      tabAdmin.style.boxShadow = 'none';
    }
    if (hiddenType) hiddenType.value = 'user';
    if (notice) notice.classList.add('hidden');
    if (submitText) submitText.textContent = 'Login';
    if (modalTitle) modalTitle.textContent = 'Login to LifeLink';
    if (modalSubtitle) modalSubtitle.textContent = 'Access your donor dashboard, active emergencies, and coordination chat.';
    if (regFooter) regFooter.classList.remove('hidden');
  }
}

function initLoginTabs() {
  document.getElementById('tabUserLogin')?.addEventListener('click', () => setLoginRoleTab('user'));
  document.getElementById('tabAdminLogin')?.addEventListener('click', () => setLoginRoleTab('admin'));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginTabs);
  } else {
    initLoginTabs();
  }
}

/**
 * Handle user login
 */
async function handleLogin(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('loginSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const loginId = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const loginType = document.getElementById('loginType')?.value || 'user';

    const endpoint = loginType === 'admin' ? '/auth/admin-login' : '/auth/login';
    const data = await api.post(endpoint, { loginId, password });

    api.setToken(data.token);
    api.setCurrentUser(data.user);
    updateAuthUI();

    closeModal('loginModal');

    if (data.user.role === 'admin') {
      showToast(`Welcome Administrator, ${data.user.name}!`, 'success');
      switchView('admin');
      if (typeof loadAdminDashboard === 'function') {
        loadAdminDashboard();
      }
    } else {
      showToast(`Welcome back, ${data.user.name.split(' ')[0]}!`, 'success');
      switchView('dashboard');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * Handle user logout
 */
async function handleLogout() {
  try {
    await api.post('/auth/logout');
  } catch (e) {}

  api.setToken(null);
  api.setCurrentUser(null);
  updateAuthUI();
  showToast('You have been logged out.', 'info');
  switchView('intro');
}

/**
 * Toggle ready to donate status
 */
async function handleToggleAvailability() {
  try {
    const res = await api.patch('/users/availability');
    currentUser.isAvailableToDonate = res.isAvailableToDonate;
    api.setCurrentUser(currentUser);
    showToast(res.message, 'success');
    updateAuthUI();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
