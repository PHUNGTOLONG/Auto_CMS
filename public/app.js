// -------------------------------------------------------------
// CMS Automation - Client-side App Logic (app.js)
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // --- UI Elements ---
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const globalStatusBadge = document.getElementById('global-status-badge');
  const globalStatusDot = globalStatusBadge.querySelector('.status-dot');
  const globalStatusText = globalStatusBadge.querySelector('.status-text');

  // Thống kê
  const statPendingFiles = document.getElementById('stat-pending-files');
  const statProcessedArticles = document.getElementById('stat-processed-articles');
  const statBotStatus = document.getElementById('stat-bot-status');

  // Điều khiển tiến trình
  const btnRunEditor = document.getElementById('btn-run-editor');
  const btnRunReviewer = document.getElementById('btn-run-reviewer');
  const btnStopBot = document.getElementById('btn-stop-bot');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const terminalLogs = document.getElementById('terminal-logs');

  // Quản lý file
  const dropzone = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('file-input');
  const fileListTbody = document.getElementById('file-list-tbody');
  const uploadProgressList = document.getElementById('upload-progress-list');

  // Cấu hình
  const configForm = document.getElementById('config-form');
  const btnResetConfig = document.getElementById('btn-reset-config');

  // Bài viết
  const articleSearchInput = document.getElementById('article-search-input');
  const articlesGridContainer = document.getElementById('articles-grid-container');

  // Modal chi tiết bài viết
  const articleModal = document.getElementById('article-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalAuthor = document.getElementById('modal-author');
  const modalFilename = document.getElementById('modal-filename');
  const modalDate = document.getElementById('modal-date');
  const modalBrief = document.getElementById('modal-brief');
  const modalContentBody = document.getElementById('modal-content-body');

  // --- Các thành phần AUTH mới ---
  const authContainer = document.getElementById('auth-container');
  const appMainContainer = document.getElementById('app-main-container');
  const authForm = document.getElementById('auth-form');
  const authTitle = document.getElementById('auth-title');
  const authUsernameInput = document.getElementById('auth-username');
  const authPasswordInput = document.getElementById('auth-password');
  const btnAuthSubmit = document.getElementById('btn-auth-submit');
  const btnAuthSwitch = document.getElementById('btn-auth-switch');
  const authSwitchText = document.getElementById('auth-switch-text');
  const userDisplayName = document.getElementById('user-display-name');
  const btnLogout = document.getElementById('btn-logout');

  // --- Trạng thái Client ---
  let currentActiveTab = 'dashboard';
  let isPollingLogs = false;
  let logPollInterval = null;
  let cachedConfig = {};
  let cachedArticles = [];
  let authMode = 'login'; // 'login' | 'register'

  // -------------------------------------------------------------
  // 0. HÀM GỌI API ĐÃ XÁC THỰC (AUTHENTICATED FETCH)
  // -------------------------------------------------------------
  async function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('auth_token');
    if (!options.headers) {
      options.headers = {};
    }
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, options);

    if (res.status === 401) {
      // Phiên làm việc hết hạn hoặc không hợp lệ
      localStorage.removeItem('auth_token');
      localStorage.removeItem('username');
      showAuthScreen();
      showToast('Phiên làm việc hết hạn hoặc chưa đăng nhập.', 'error');
      throw new Error('Unauthorized');
    }

    return res;
  }

  // Quản lý hiển thị màn hình
  function showAuthScreen() {
    authContainer.style.display = 'flex';
    appMainContainer.style.display = 'none';
    if (logPollInterval) {
      clearInterval(logPollInterval);
      logPollInterval = null;
    }
  }

  function hideAuthScreen() {
    authContainer.style.display = 'none';
    appMainContainer.style.display = 'grid';
  }

  function initApp() {
    const username = localStorage.getItem('username');
    userDisplayName.textContent = username || 'Người dùng';
    switchTab(currentActiveTab);
    fetchStatus();
  }

  // Chuyển đổi qua lại giữa Đăng nhập & Đăng ký
  btnAuthSwitch.addEventListener('click', () => {
    if (authMode === 'login') {
      authMode = 'register';
      authTitle.textContent = 'Đăng ký tài khoản mới';
      btnAuthSubmit.textContent = 'Đăng Ký';
      authSwitchText.textContent = 'Đã có tài khoản?';
      btnAuthSwitch.textContent = 'Đăng nhập';
    } else {
      authMode = 'login';
      authTitle.textContent = 'Đăng nhập vào hệ thống';
      btnAuthSubmit.textContent = 'Đăng Nhập';
      authSwitchText.textContent = 'Chưa có tài khoản?';
      btnAuthSwitch.textContent = 'Đăng ký ngay';
    }
    authPasswordInput.value = '';
  });

  // Submit form đăng nhập / đăng ký
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value;

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (res.ok) {
        if (authMode === 'login') {
          localStorage.setItem('auth_token', data.token);
          localStorage.setItem('username', data.username);
          showToast('Đăng nhập thành công!', 'success');
          hideAuthScreen();
          initApp();
        } else {
          showToast('Đăng ký tài khoản thành công! Hãy đăng nhập.', 'success');
          authMode = 'login';
          authTitle.textContent = 'Đăng nhập vào hệ thống';
          btnAuthSubmit.textContent = 'Đăng Nhập';
          authSwitchText.textContent = 'Chưa có tài khoản?';
          btnAuthSwitch.textContent = 'Đăng ký ngay';
          authPasswordInput.value = '';
        }
      } else {
        showToast(data.error || 'Xác thực thất bại.', 'error');
      }
    } catch (err) {
      showToast('Không thể kết nối đến máy chủ.', 'error');
    }
  });

  // Đăng xuất
  btnLogout.addEventListener('click', async () => {
    try {
      await authenticatedFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } finally {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('username');
      showAuthScreen();
      showToast('Đã đăng xuất thành công.', 'warning');
    }
  });

  // --- Toggles hiển thị Mật khẩu / API Key ---
  document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrapper = btn.closest('.input-password-wrapper');
      const input = wrapper.querySelector('input');
      if (input.type === 'password') {
        input.type = 'text';
        btn.classList.add('visible');
      } else {
        input.type = 'password';
        btn.classList.remove('visible');
      }
    });
  });

  // -------------------------------------------------------------
  // 1. CHUYỂN TAB & CẬP NHẬT GIAO DIỆN
  // -------------------------------------------------------------
  function switchTab(tabId) {
    currentActiveTab = tabId;
    
    // Cập nhật class active trên nút bấm sidebar
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === tabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Cập nhật class active trên pane nội dung
    tabPanes.forEach(pane => {
      if (pane.id === `${tabId}-pane`) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // Chỉ thực hiện tải khi đã có token
    if (!localStorage.getItem('auth_token')) return;

    // Tải dữ liệu tương ứng khi đổi sang Tab
    if (tabId === 'dashboard') {
      fetchStatus();
    } else if (tabId === 'files') {
      fetchFileList();
    } else if (tabId === 'config') {
      loadConfig();
    } else if (tabId === 'articles') {
      fetchArticlesList();
    }
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // -------------------------------------------------------------
  // 2. THÔNG BÁO TOAST
  // -------------------------------------------------------------
  function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '';
    if (type === 'success') icon = '✓';
    else if (type === 'error') icon = '✗';
    else icon = '⚠';

    toast.innerHTML = `
      <span>${icon} &nbsp;${message}</span>
      <button class="toast-close">&times;</button>
    `;

    toastContainer.appendChild(toast);

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });

    // Tự hủy sau 4 giây
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  // -------------------------------------------------------------
  // 3. TRẠNG THÁI & HỆ THỐNG LOGS (TERMINAL)
  // -------------------------------------------------------------
  async function fetchStatus() {
    try {
      const res = await authenticatedFetch('/api/status');
      const data = await res.json();
      
      statPendingFiles.textContent = data.inputFilesCount;
      statProcessedArticles.textContent = data.processedCount;
      
      updateBotStatusUI(data.status);
    } catch (err) {
      console.error('Lỗi khi lấy thông tin trạng thái:', err);
    }
  }

  function updateBotStatusUI(status) {
    if (status === 'idle') {
      globalStatusDot.className = 'status-dot dot-idle';
      globalStatusText.textContent = 'Đang rảnh';
      statBotStatus.textContent = 'Sẵn sàng';
      statBotStatus.className = 'stat-number text-highlight';

      btnRunEditor.disabled = false;
      btnRunReviewer.disabled = false;
      btnStopBot.disabled = true;
      
      if (isPollingLogs) {
        stopLogsPolling();
      }
    } else {
      globalStatusDot.className = 'status-dot dot-running';
      btnRunEditor.disabled = true;
      btnRunReviewer.disabled = true;
      btnStopBot.disabled = false;

      if (status === 'running_editor') {
        globalStatusText.textContent = 'Đang biên tập';
        statBotStatus.textContent = 'Đang biên tập...';
        statBotStatus.className = 'stat-number';
      } else if (status === 'running_reviewer') {
        globalStatusText.textContent = 'Đang kiểm duyệt';
        statBotStatus.textContent = 'Đang kiểm duyệt...';
        statBotStatus.className = 'stat-number';
      }

      if (!isPollingLogs) {
        startLogsPolling();
      }
    }
  }

  // Khởi động lấy Logs thời gian thực
  function startLogsPolling() {
    isPollingLogs = true;
    pollLogs();
    logPollInterval = setInterval(pollLogs, 1000);
  }

  function stopLogsPolling() {
    isPollingLogs = false;
    if (logPollInterval) {
      clearInterval(logPollInterval);
      logPollInterval = null;
    }
    pollLogs();
  }

  async function pollLogs() {
    try {
      const res = await authenticatedFetch('/api/logs');
      const data = await res.json();
      
      renderTerminalLogs(data.logs);
      updateBotStatusUI(data.status);
    } catch (err) {
      console.error('Lỗi khi kết nối lấy Logs:', err);
    }
  }

  function renderTerminalLogs(rawLogs) {
    if (!rawLogs) return;

    terminalLogs.innerHTML = '';
    const lines = rawLogs.split('\n');
    
    lines.forEach(line => {
      if (!line.trim() && line === '') return;
      
      const div = document.createElement('div');
      div.className = 'log-line';
      
      if (line.includes('[Lỗi]') || line.includes('[LỖI]') || line.includes('Error:') || line.includes('error:')) {
        div.classList.add('error');
      } else if (line.includes('[Cảnh báo]') || line.includes('[CẢNH BÁO]') || line.includes('Warning:')) {
        div.classList.add('warning');
      } else if (line.includes('thành công') || line.includes('[THÀNH CÔNG]') || line.includes('[Hoàn tất]') || line.includes('Biên tập xong bài:')) {
        div.classList.add('success');
      } else if (line.includes('[Tác vụ') || line.includes('[Hệ thống]')) {
        div.classList.add('system');
      }
      
      div.textContent = line;
      terminalLogs.appendChild(div);
    });

    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  // Khởi chạy editor
  btnRunEditor.addEventListener('click', async () => {
    try {
      const res = await authenticatedFetch('/api/run-editor', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Đã kích hoạt chương trình Biên tập & Đăng bài.', 'success');
        fetchStatus();
      } else {
        showToast(data.error || 'Có lỗi xảy ra.', 'error');
      }
    } catch (err) {
      showToast('Không thể kết nối đến máy chủ.', 'error');
    }
  });

  // Khởi chạy reviewer
  btnRunReviewer.addEventListener('click', async () => {
    try {
      const res = await authenticatedFetch('/api/run-reviewer', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Đã kích hoạt chương trình Kiểm duyệt bài viết.', 'success');
        fetchStatus();
      } else {
        showToast(data.error || 'Có lỗi xảy ra.', 'error');
      }
    } catch (err) {
      showToast('Không thể kết nối đến máy chủ.', 'error');
    }
  });

  // Dừng tiến trình
  btnStopBot.addEventListener('click', async () => {
    try {
      const res = await authenticatedFetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Đã gửi lệnh dừng tiến trình.', 'warning');
      } else {
        showToast(data.error || 'Có lỗi xảy ra.', 'error');
      }
    } catch (err) {
      showToast('Không thể kết nối đến máy chủ.', 'error');
    }
  });

  // Xóa màn hình log terminal
  btnClearLogs.addEventListener('click', () => {
    terminalLogs.innerHTML = '<div class="log-line system">[Hệ thống] Logs màn hình đã được làm sạch.</div>';
  });


  // -------------------------------------------------------------
  // 4. QUẢN LÝ TẢI FILE & LIỆT KÊ FILE
  // -------------------------------------------------------------
  async function fetchFileList() {
    try {
      const res = await authenticatedFetch('/api/files');
      const files = await res.json();
      
      fileListTbody.innerHTML = '';
      if (files.length === 0) {
        fileListTbody.innerHTML = '<tr><td colspan="4" class="table-empty">Thư mục đầu vào trống. Hãy tải file lên để xử lý.</td></tr>';
        return;
      }

      files.forEach(file => {
        const tr = document.createElement('tr');
        const sizeKB = (file.size / 1024).toFixed(1) + ' KB';
        const dateStr = new Date(file.createdAt).toLocaleString('vi-VN');

        tr.innerHTML = `
          <td><strong>${file.name}</strong></td>
          <td>${sizeKB}</td>
          <td>${dateStr}</td>
          <td style="text-align: right;">
            <button class="btn-icon btn-delete-file" data-name="${file.name}" title="Xóa file">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </td>
        `;
        fileListTbody.appendChild(tr);
      });

      fileListTbody.querySelectorAll('.btn-delete-file').forEach(btn => {
        btn.addEventListener('click', () => {
          const filename = btn.getAttribute('data-name');
          if (confirm(`Bạn chắc chắn muốn xóa file thô: "${filename}"?`)) {
            deleteFile(filename);
          }
        });
      });

    } catch (err) {
      if (err.message !== 'Unauthorized') {
        fileListTbody.innerHTML = '<tr><td colspan="4" class="table-empty text-error">Lỗi khi tải danh sách file đầu vào.</td></tr>';
      }
    }
  }

  async function deleteFile(filename) {
    try {
      const res = await authenticatedFetch(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(`Đã xóa file "${filename}".`, 'success');
        fetchFileList();
        fetchStatus();
      } else {
        showToast(data.error || 'Xóa file thất bại.', 'error');
      }
    } catch (err) {
      showToast('Không thể kết nối để xóa file.', 'error');
    }
  }

  // Upload file kéo thả & click
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('active');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('active');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('active');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesUpload(files);
    }
  });

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (files.length > 0) {
      handleFilesUpload(files);
    }
  });

  async function handleFilesUpload(files) {
    const formData = new FormData();
    let hasValidFiles = false;

    uploadProgressList.innerHTML = '';
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      
      if (ext === '.txt' || ext === '.pdf') {
        formData.append('files', file);
        hasValidFiles = true;

        const progressItem = document.createElement('div');
        progressItem.className = 'upload-progress-item';
        progressItem.innerHTML = `
          <div>Đang tải lên: <strong>${file.name}</strong></div>
          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" style="width: 50%;"></div>
          </div>
        `;
        uploadProgressList.appendChild(progressItem);
      } else {
        showToast(`Bỏ qua file không đúng định dạng (.txt, .pdf): ${file.name}`, 'warning');
      }
    }

    if (!hasValidFiles) return;

    try {
      const res = await authenticatedFetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        showToast('Tải file lên thành công.', 'success');
        uploadProgressList.innerHTML = '';
        fetchFileList();
        fetchStatus();
      } else {
        showToast(data.error || 'Tải file lên thất bại.', 'error');
        uploadProgressList.innerHTML = '';
      }
    } catch (err) {
      showToast('Không thể gửi file lên server.', 'error');
      uploadProgressList.innerHTML = '';
    }
  }


  // -------------------------------------------------------------
  // 5. CẤU HÌNH CONFIGURATION
  // -------------------------------------------------------------
  async function loadConfig() {
    try {
      const res = await authenticatedFetch('/api/config');
      const config = await res.json();
      cachedConfig = config;

      document.getElementById('cfg-gemini-key').value = config.GEMINI_API_KEY || '';
      document.getElementById('cfg-username').value = config.USERNAME || '';
      document.getElementById('cfg-password').value = config.PASSWORD || '';
      document.getElementById('cfg-author').value = config.Tacgia || 'AI Editor';
      document.getElementById('cfg-category').value = config.Danhmuc || config.CATEGORY || 'Tin tức';
      
      document.getElementById('cfg-url-login').value = config.URL_LOGIN || '';
      document.getElementById('cfg-url-create').value = config.URL_CREATE || '';
      document.getElementById('cfg-url-login-2').value = config.URL_LOGIN_2 || '';
      document.getElementById('cfg-url-create-2').value = config.URL_CREATE_2 || '';

      document.getElementById('cfg-email-sender').value = config.EMAIL_SENDER || '';
      document.getElementById('cfg-email-password').value = config.EMAIL_PASSWORD || '';
      document.getElementById('cfg-email-receiver').value = config.EMAIL_RECEIVER || '';
      
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        showToast('Lỗi khi tải dữ liệu cấu hình.', 'error');
      }
    }
  }

  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const configData = {
      URL_LOGIN: document.getElementById('cfg-url-login').value,
      URL_CREATE: document.getElementById('cfg-url-create').value,
      USERNAME: document.getElementById('cfg-username').value,
      PASSWORD: document.getElementById('cfg-password').value,
      Tacgia: document.getElementById('cfg-author').value,
      Danhmuc: document.getElementById('cfg-category').value,
      GEMINI_API_KEY: document.getElementById('cfg-gemini-key').value,
      URL_LOGIN_2: document.getElementById('cfg-url-login-2').value,
      URL_CREATE_2: document.getElementById('cfg-url-create-2').value,
      EMAIL_SENDER: document.getElementById('cfg-email-sender').value,
      EMAIL_PASSWORD: document.getElementById('cfg-email-password').value,
      EMAIL_RECEIVER: document.getElementById('cfg-email-receiver').value
    };

    try {
      const res = await authenticatedFetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(configData)
      });
      const data = await res.json();
      
      if (data.success) {
        showToast('Lưu thông tin cấu hình thành công.', 'success');
        cachedConfig = configData;
      } else {
        showToast(data.error || 'Lưu cấu hình thất bại.', 'error');
      }
    } catch (err) {
      showToast('Lỗi kết nối máy chủ.', 'error');
    }
  });

  btnResetConfig.addEventListener('click', () => {
    if (Object.keys(cachedConfig).length > 0) {
      document.getElementById('cfg-gemini-key').value = cachedConfig.GEMINI_API_KEY || '';
      document.getElementById('cfg-username').value = cachedConfig.USERNAME || '';
      document.getElementById('cfg-password').value = cachedConfig.PASSWORD || '';
      document.getElementById('cfg-author').value = cachedConfig.Tacgia || 'AI Editor';
      document.getElementById('cfg-category').value = cachedConfig.Danhmuc || 'Tin tức';
      document.getElementById('cfg-url-login').value = cachedConfig.URL_LOGIN || '';
      document.getElementById('cfg-url-create').value = cachedConfig.URL_CREATE || '';
      document.getElementById('cfg-url-login-2').value = cachedConfig.URL_LOGIN_2 || '';
      document.getElementById('cfg-url-create-2').value = cachedConfig.URL_CREATE_2 || '';
      document.getElementById('cfg-email-sender').value = cachedConfig.EMAIL_SENDER || '';
      document.getElementById('cfg-email-password').value = cachedConfig.EMAIL_PASSWORD || '';
      document.getElementById('cfg-email-receiver').value = cachedConfig.EMAIL_RECEIVER || '';
      showToast('Đã hoàn tác cấu hình.', 'warning');
    }
  });


  // -------------------------------------------------------------
  // 6. BÀI VIẾT ĐÃ BIÊN TẬP
  // -------------------------------------------------------------
  async function fetchArticlesList() {
    try {
      const res = await authenticatedFetch('/api/articles');
      const data = await res.json();
      cachedArticles = data;
      renderArticles(data);
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        articlesGridContainer.innerHTML = '<div class="table-empty text-error">Lỗi khi tải lịch sử bài viết.</div>';
      }
    }
  }

  function renderArticles(articles) {
    articlesGridContainer.innerHTML = '';
    
    if (articles.length === 0) {
      articlesGridContainer.innerHTML = '<div class="table-empty">Chưa có bài viết nào được biên tập thành công.</div>';
      return;
    }

    articles.forEach((art, index) => {
      const card = document.createElement('div');
      card.className = 'article-card';
      
      const dateText = art['Ngày đăng'] || 'Không rõ ngày';
      
      card.innerHTML = `
        <h3>${art['Tiêu đề']}</h3>
        <p class="article-card-brief">${art['Tóm tắt']}</p>
        <div class="article-card-footer">
          <span class="author">${art['Tác giả'] || 'AI'}</span>
          <span>${dateText}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        openArticleModal(art);
      });

      articlesGridContainer.appendChild(card);
    });
  }

  articleSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      renderArticles(cachedArticles);
      return;
    }

    const filtered = cachedArticles.filter(art => {
      const title = (art['Tiêu đề'] || '').toLowerCase();
      const brief = (art['Tóm tắt'] || '').toLowerCase();
      const content = (art['Nội dung'] || '').toLowerCase();
      return title.includes(query) || brief.includes(query) || content.includes(query);
    });

    renderArticles(filtered);
  });

  function openArticleModal(article) {
    modalTitle.textContent = article['Tiêu đề'];
    modalAuthor.textContent = article['Tác giả'] || 'AI Editor';
    modalFilename.textContent = article['Tên File'] || '-';
    modalDate.textContent = article['Ngày đăng'] || '-';
    modalBrief.textContent = article['Tóm tắt'];
    
    const rawContent = article['Nội dung'] || '';
    const formattedContent = rawContent.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    modalContentBody.innerHTML = formattedContent;

    articleModal.classList.add('active');
  }

  function closeModal() {
    articleModal.classList.remove('active');
  }

  btnCloseModal.addEventListener('click', closeModal);
  
  articleModal.addEventListener('click', (e) => {
    if (e.target === articleModal) {
      closeModal();
    }
  });

  // --- Khởi động kiểm tra trạng thái Đăng nhập ---
  const token = localStorage.getItem('auth_token');
  if (token) {
    hideAuthScreen();
    initApp();
  } else {
    showAuthScreen();
  }
});
