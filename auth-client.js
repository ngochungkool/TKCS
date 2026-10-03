/**
 * auth-client.js - Global Authentication Badge & Session Manager
 * Khoa Ngoại Thần Kinh - Cột Sống (BVĐK Tỉnh Gia Lai)
 */
(function () {
  'use strict';

  // Inject CSS styles dynamically
  function injectStyles() {
    if (document.getElementById('tkcs-auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'tkcs-auth-styles';
    style.textContent = `
      /* Global Auth Header Elements */
      .tkcs-auth-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        font-family: 'Be Vietnam Pro', sans-serif;
      }

      .tkcs-auth-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 5px 12px 5px 6px;
        background: #ffffff;
        border: 1.5px solid #cbd5e1;
        border-radius: 9999px;
        cursor: pointer;
        user-select: none;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease;
      }

      .tkcs-auth-pill:hover {
        background: #f8fafc;
        border-color: #0284c7;
        box-shadow: 0 2px 8px rgba(2, 132, 199, 0.15);
      }

      .tkcs-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 0.88rem;
        color: #ffffff;
        flex-shrink: 0;
        background: #0284c7;
      }

      .tkcs-avatar.role-admin {
        background: linear-gradient(135deg, #7c3aed, #4f46e5);
      }

      .tkcs-avatar.role-doctor {
        background: linear-gradient(135deg, #0284c7, #2563eb);
      }

      .tkcs-avatar.role-nurse {
        background: linear-gradient(135deg, #0d9488, #059669);
      }

      .tkcs-avatar.role-staff {
        background: linear-gradient(135deg, #64748b, #475569);
      }

      .tkcs-user-info {
        display: flex;
        flex-direction: column;
        line-height: 1.15;
        text-align: left;
      }

      .tkcs-user-name {
        font-weight: 700;
        font-size: 0.86rem;
        color: #0f172a;
        white-space: nowrap;
      }

      .tkcs-user-role-badge {
        font-size: 0.7rem;
        font-weight: 700;
        color: #64748b;
      }

      .tkcs-dropdown-caret {
        font-size: 0.7rem;
        color: #94a3b8;
        margin-left: 2px;
        transition: transform 0.2s ease;
      }

      .tkcs-auth-wrap.open .tkcs-dropdown-caret {
        transform: rotate(180deg);
      }

      /* Dropdown Menu */
      .tkcs-auth-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 270px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.04);
        padding: 8px 0;
        display: none;
        z-index: 10000;
        animation: tkcsMenuFade 0.18s ease-out;
      }

      @keyframes tkcsMenuFade {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .tkcs-auth-wrap.open .tkcs-auth-menu {
        display: block;
      }

      .tkcs-menu-header {
        padding: 10px 16px 12px;
        border-bottom: 1px solid #f1f5f9;
        margin-bottom: 4px;
      }

      .tkcs-menu-fullname {
        font-weight: 800;
        font-size: 0.95rem;
        color: #0f172a;
        line-height: 1.3;
      }

      .tkcs-menu-sub {
        font-size: 0.78rem;
        color: #64748b;
        margin-top: 3px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .tkcs-menu-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 0.72rem;
        font-weight: 700;
      }

      .tkcs-menu-badge.admin {
        background: #f3e8ff;
        color: #7e22ce;
      }

      .tkcs-menu-badge.doctor {
        background: #dbeafe;
        color: #1d4ed8;
      }

      .tkcs-menu-badge.nurse {
        background: #ccfbf1;
        color: #0f766e;
      }

      .tkcs-menu-badge.staff {
        background: #f1f5f9;
        color: #475569;
      }

      .tkcs-menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 16px;
        color: #334155;
        font-size: 0.88rem;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        transition: background 0.15s;
        border: none;
        width: 100%;
        background: transparent;
        text-align: left;
      }

      .tkcs-menu-item:hover {
        background: #f8fafc;
        color: #0284c7;
      }

      .tkcs-menu-item i {
        font-size: 0.95rem;
        width: 18px;
        text-align: center;
        color: #64748b;
      }

      .tkcs-menu-item:hover i {
        color: #0284c7;
      }

      .tkcs-menu-divider {
        height: 1px;
        background: #f1f5f9;
        margin: 4px 0;
      }

      .tkcs-menu-item.logout {
        color: #dc2626;
      }

      .tkcs-menu-item.logout:hover {
        background: #fef2f2;
        color: #b91c1c;
      }

      .tkcs-menu-item.logout i {
        color: #dc2626;
      }

      /* Login Button when not authenticated */
      .tkcs-btn-login {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 16px;
        background: linear-gradient(135deg, #0284c7, #2563eb);
        color: #ffffff !important;
        font-family: 'Be Vietnam Pro', sans-serif;
        font-weight: 700;
        font-size: 0.86rem;
        border-radius: 9999px;
        text-decoration: none;
        box-shadow: 0 2px 8px rgba(2, 132, 199, 0.25);
        transition: all 0.2s ease;
        border: none;
        cursor: pointer;
      }

      .tkcs-btn-login:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
        color: #ffffff;
      }

      /* Modal Popups (Password Change / Profile) */
      .tkcs-auth-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 16px;
      }

      .tkcs-auth-modal-box {
        background: #ffffff;
        width: 100%;
        max-width: 440px;
        border-radius: 18px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        overflow: hidden;
        animation: tkcsMenuFade 0.2s ease-out;
      }

      .tkcs-modal-header {
        padding: 16px 20px;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #f8fafc;
      }

      .tkcs-modal-title {
        font-weight: 800;
        font-size: 1.05rem;
        color: #0f172a;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .tkcs-modal-close {
        background: transparent;
        border: none;
        font-size: 1.15rem;
        color: #64748b;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
      }

      .tkcs-modal-body {
        padding: 20px;
      }

      .tkcs-form-row {
        margin-bottom: 14px;
      }

      .tkcs-form-row label {
        display: block;
        font-size: 0.84rem;
        font-weight: 700;
        color: #334155;
        margin-bottom: 5px;
      }

      .tkcs-form-row input {
        width: 100%;
        height: 42px;
        padding: 0 12px;
        border: 1.5px solid #cbd5e1;
        border-radius: 8px;
        font-family: inherit;
        font-size: 0.92rem;
        outline: none;
      }

      .tkcs-form-row input:focus {
        border-color: #0284c7;
        box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
      }

      .tkcs-modal-btn-save {
        width: 100%;
        height: 44px;
        background: #0284c7;
        color: #ffffff;
        font-weight: 800;
        font-size: 0.95rem;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.15s;
        margin-top: 8px;
      }

      .tkcs-modal-btn-save:hover {
        background: #0369a1;
      }

      .tkcs-profile-item {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px dashed #e2e8f0;
        font-size: 0.88rem;
      }

      .tkcs-profile-label {
        color: #64748b;
        font-weight: 600;
      }

      .tkcs-profile-val {
        color: #0f172a;
        font-weight: 700;
        text-align: right;
      }
    `;
    document.head.appendChild(style);
  }

  let currentUser = null;

  // Fetch current user from server
  async function fetchCurrentUser() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      if (data && data.ok && data.user) {
        currentUser = data.user;
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        return currentUser;
      }
    } catch (e) {
      console.error('TKCSAuth: Failed to fetch current user', e);
    }
    currentUser = null;
    localStorage.removeItem('auth_user');
    return null;
  }

  // Render auth pill or login button in header
  function renderAuthBadge(user) {
    const headerRight = document.querySelector('.header-right-group');
    if (!headerRight) return;

    // Remove existing badge if any
    const existing = headerRight.querySelector('.tkcs-auth-wrap, .tkcs-btn-login');
    if (existing) existing.remove();

    if (!user) {
      // Show Login button
      const loginBtn = document.createElement('a');
      loginBtn.className = 'tkcs-btn-login';
      const redirectTarget = encodeURIComponent(window.location.pathname + window.location.search);
      loginBtn.href = `/dang-nhap?redirect=${redirectTarget}`;
      loginBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Đăng nhập`;
      loginBtn.title = 'Đăng nhập hệ thống khoa';
      headerRight.prepend(loginBtn);
      return;
    }

    // Determine initials & role styling
    const nameParts = (user.name || 'User').trim().split(/\s+/);
    const lastName = nameParts[nameParts.length - 1] || 'U';
    const initial = lastName.charAt(0).toUpperCase();

    let prefix = '';
    if (user.specialty === 'Bác sĩ') prefix = 'BS. ';
    else if (user.specialty === 'Điều dưỡng') prefix = 'ĐD. ';

    const displayName = `${prefix}${lastName}`;
    const roleClass = `role-${user.role || 'staff'}`;
    const roleBadgeName = user.role === 'admin' ? 'Quản trị viên' : (user.specialty || 'Cán bộ');

    const authWrap = document.createElement('div');
    authWrap.className = 'tkcs-auth-wrap';
    authWrap.innerHTML = `
      <div class="tkcs-auth-pill" id="tkcsAuthPill" title="${user.name} (${user.specialty || user.role})">
        <div class="tkcs-avatar ${roleClass}">${initial}</div>
        <div class="tkcs-user-info">
          <span class="tkcs-user-name">${displayName}</span>
          <span class="tkcs-user-role-badge">${roleBadgeName}</span>
        </div>
        <i class="fa-solid fa-chevron-down tkcs-dropdown-caret"></i>
      </div>

      <div class="tkcs-auth-menu" id="tkcsAuthMenu">
        <div class="tkcs-menu-header">
          <div class="tkcs-menu-fullname">${user.name}</div>
          <div class="tkcs-menu-sub">
            <span class="tkcs-menu-badge ${user.role || 'staff'}">${roleBadgeName}</span>
            <span>@${user.username}</span>
          </div>
        </div>

        <button type="button" class="tkcs-menu-item" onclick="window.TKCSAuth.showProfileModal()">
          <i class="fa-solid fa-id-card"></i> Hồ sơ cá nhân
        </button>

        <button type="button" class="tkcs-menu-item" onclick="window.TKCSAuth.showChangePasswordModal()">
          <i class="fa-solid fa-key"></i> Đổi mật khẩu
        </button>

        <div class="tkcs-menu-divider"></div>

        <button type="button" class="tkcs-menu-item logout" onclick="window.TKCSAuth.logout()">
          <i class="fa-solid fa-right-from-bracket"></i> Đăng xuất
        </button>
      </div>
    `;

    // Toggle menu
    const pill = authWrap.querySelector('#tkcsAuthPill');
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      authWrap.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!authWrap.contains(e.target)) {
        authWrap.classList.remove('open');
      }
    });

    headerRight.prepend(authWrap);
  }

  // Profile modal
  function showProfileModal() {
    if (!currentUser) return;
    closeAnyModal();

    const u = currentUser;
    const modal = document.createElement('div');
    modal.className = 'tkcs-auth-modal-overlay';
    modal.id = 'tkcsProfileModal';
    modal.innerHTML = `
      <div class="tkcs-auth-modal-box">
        <div class="tkcs-modal-header">
          <div class="tkcs-modal-title">
            <i class="fa-solid fa-user-doctor" style="color: #0284c7;"></i> Thông Tin Cán Bộ
          </div>
          <button type="button" class="tkcs-modal-close" onclick="window.TKCSAuth.closeModal('tkcsProfileModal')">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="tkcs-modal-body">
          <div class="tkcs-profile-item">
            <span class="tkcs-profile-label">Họ và tên:</span>
            <span class="tkcs-profile-val">${u.name}</span>
          </div>
          <div class="tkcs-profile-item">
            <span class="tkcs-profile-label">Tên đăng nhập:</span>
            <span class="tkcs-profile-val" style="font-family: monospace; color: #0284c7;">${u.username}</span>
          </div>
          <div class="tkcs-profile-item">
            <span class="tkcs-profile-label">Chức danh / Chuyên môn:</span>
            <span class="tkcs-profile-val">${u.specialty || '--'}</span>
          </div>
          <div class="tkcs-profile-item">
            <span class="tkcs-profile-label">Ngày sinh:</span>
            <span class="tkcs-profile-val">${u.dob || u.birthYear || '--'}</span>
          </div>
          <div class="tkcs-profile-item">
            <span class="tkcs-profile-label">Giới tính:</span>
            <span class="tkcs-profile-val">${u.gender || '--'}</span>
          </div>
          <div class="tkcs-profile-item">
            <span class="tkcs-profile-label">Số điện thoại:</span>
            <span class="tkcs-profile-val">${u.phone || '--'}</span>
          </div>
          <div class="tkcs-profile-item">
            <span class="tkcs-profile-label">Nơi công tác:</span>
            <span class="tkcs-profile-val">${u.workplace || 'Khoa Ngoại Thần Kinh - Cột Sống'}</span>
          </div>
          <button type="button" class="tkcs-modal-btn-save" style="margin-top: 18px;" onclick="window.TKCSAuth.closeModal('tkcsProfileModal')">
            Đóng
          </button>
        </div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  // Change password modal
  function showChangePasswordModal() {
    closeAnyModal();

    const modal = document.createElement('div');
    modal.className = 'tkcs-auth-modal-overlay';
    modal.id = 'tkcsChangePassModal';
    modal.innerHTML = `
      <div class="tkcs-auth-modal-box">
        <div class="tkcs-modal-header">
          <div class="tkcs-modal-title">
            <i class="fa-solid fa-key" style="color: #0284c7;"></i> Đổi Mật Khẩu
          </div>
          <button type="button" class="tkcs-modal-close" onclick="window.TKCSAuth.closeModal('tkcsChangePassModal')">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="tkcs-modal-body">
          <div id="changePassAlert" style="display:none; padding: 10px 12px; border-radius: 8px; font-size: 0.86rem; margin-bottom: 12px; font-weight: 600;"></div>
          <form id="changePassForm" onsubmit="window.TKCSAuth.handleChangePassSubmit(event)">
            <div class="tkcs-form-row">
              <label for="currentPassInput">Mật khẩu hiện tại</label>
              <input type="password" id="currentPassInput" required placeholder="Nhập mật khẩu đang dùng" autocomplete="current-password" />
            </div>
            <div class="tkcs-form-row">
              <label for="newPassInput">Mật khẩu mới</label>
              <input type="password" id="newPassInput" required placeholder="Tối thiểu 5 ký tự" autocomplete="new-password" />
            </div>
            <div class="tkcs-form-row">
              <label for="confirmPassInput">Xác nhận mật khẩu mới</label>
              <input type="password" id="confirmPassInput" required placeholder="Nhập lại mật khẩu mới" autocomplete="new-password" />
            </div>
            <button type="submit" class="tkcs-modal-btn-save" id="btnChangePassSubmit">
              Cập Nhật Mật Khẩu
            </button>
          </form>
        </div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
    setTimeout(() => {
      document.getElementById('currentPassInput')?.focus();
    }, 100);
  }

  async function handleChangePassSubmit(e) {
    e.preventDefault();
    const cur = document.getElementById('currentPassInput').value;
    const n = document.getElementById('newPassInput').value;
    const c = document.getElementById('confirmPassInput').value;
    const alertBox = document.getElementById('changePassAlert');
    const submitBtn = document.getElementById('btnChangePassSubmit');

    if (n !== c) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fef2f2';
      alertBox.style.border = '1px solid #fecaca';
      alertBox.style.color = '#b91c1c';
      alertBox.textContent = 'Mật khẩu mới và xác nhận mật khẩu không trùng khớp!';
      return;
    }

    if (n.length < 5) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fef2f2';
      alertBox.style.border = '1px solid #fecaca';
      alertBox.style.color = '#b91c1c';
      alertBox.textContent = 'Mật khẩu mới phải có tối thiểu 5 ký tự!';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang cập nhật...';

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: cur, newPassword: n })
      });
      const data = await res.json();

      if (data.ok) {
        alertBox.style.display = 'block';
        alertBox.style.background = '#f0fdf4';
        alertBox.style.border = '1px solid #bbf7d0';
        alertBox.style.color = '#15803d';
        alertBox.textContent = data.message || 'Đổi mật khẩu thành công!';
        setTimeout(() => {
          closeAnyModal();
        }, 1500);
      } else {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fef2f2';
        alertBox.style.border = '1px solid #fecaca';
        alertBox.style.color = '#b91c1c';
        alertBox.textContent = data.error || 'Đổi mật khẩu thất bại!';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Cập Nhật Mật Khẩu';
      }
    } catch (err) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fef2f2';
      alertBox.style.border = '1px solid #fecaca';
      alertBox.style.color = '#b91c1c';
      alertBox.textContent = 'Lỗi kết nối máy chủ!';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Cập Nhật Mật Khẩu';
    }
  }

  function closeAnyModal() {
    document.querySelectorAll('.tkcs-auth-modal-overlay').forEach(m => m.remove());
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.remove();
  }

  async function logout() {
    if (!confirm('Bạn có chắc chắn muốn đăng xuất?')) return;
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.reload();
    } catch (e) {
      console.error('Logout error:', e);
      window.location.reload();
    }
  }

  // Global exports
  window.TKCSAuth = {
    getUser: () => currentUser,
    logout,
    showProfileModal,
    showChangePasswordModal,
    closeModal,
    handleChangePassSubmit
  };

  // Init on DOM ready
  async function init() {
    injectStyles();
    const user = await fetchCurrentUser();
    renderAuthBadge(user);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
