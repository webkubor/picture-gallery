// ============================================================
// 图库前端逻辑（原生 ES module，零构建）
// 数据源：./data/assets.json   |   API：/api/upload、/api/delete、/api/me
// 鉴权：GitHub OAuth 登录态（cookie），看图公开，操作需登录
// ============================================================

// ---------- 全局状态 ----------
const state = {
  items: [],          // 全部图片项
  folders: [],        // 目录列表
  summary: null,      // 汇总信息
  loggedIn: false,    // 是否已登录（由 /api/me 决定）
  user: null,         // 已登录用户信息
  filter: {
    source: 'all',    // all | github | r2
    folder: 'all',    // all 或目录名
    search: '',       // 文本过滤
  },
  pendingFiles: [],   // 待上传文件
};

// ---------- DOM 引用 ----------
const $ = (sel) => document.querySelector(sel);
const els = {
  gallery: $('#gallery'),
  summary: $('#summary'),
  folderSelect: $('#folder-select'),
  search: $('#search'),
  sourceBtns: document.querySelectorAll('.source-btn'),
  uploadBtn: $('#upload-btn'),
  uploadZone: $('#upload-zone'),
  uploadDrop: $('#upload-drop'),
  fileInput: $('#file-input'),
  fileList: $('#file-list'),
  uploadPath: $('#upload-path'),
  doUploadBtn: $('#do-upload-btn'),
  lightbox: $('#lightbox'),
  lbImg: $('#lb-img'),
  lbUrl: $('#lb-url'),
  lbMeta: $('#lb-meta'),
  lbClose: $('#lb-close'),
  lbCopy: $('#lb-copy'),
  lbDelete: $('#lb-delete'),
  toast: $('#toast'),
  // 登录态
  loginBtn: $('#login-btn'),
  userArea: $('#user-area'),
  userInfo: $('#user-info'),
  userAvatar: $('#user-avatar'),
  userName: $('#user-name'),
  logoutBtn: $('#logout-btn'),
};

let currentLightboxItem = null; // 当前灯箱里的图

// ============================================================
// 登录态
// ============================================================

async function checkLogin() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const data = await res.json();
    if (data.loggedIn) {
      state.loggedIn = true;
      state.user = data;
      renderLoginState();
    }
  } catch (err) {
    console.error('checkLogin', err);
  }
}

function renderLoginState() {
  if (state.loggedIn && state.user) {
    els.loginBtn.hidden = true;
    els.userInfo.hidden = false;
    els.userAvatar.src = state.user.avatar || '';
    els.userAvatar.alt = state.user.login || '';
    els.userName.textContent = state.user.name || state.user.login || '';
    // 登录后才显示上传按钮
    els.uploadBtn.hidden = false;
  } else {
    els.loginBtn.hidden = false;
    els.userInfo.hidden = true;
    els.uploadBtn.hidden = true;
  }
}

// ============================================================
// 数据加载
// ============================================================

async function loadAssets() {
  try {
    const res = await fetch('./data/assets.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.items = Array.isArray(data.items) ? data.items : [];
    state.folders = data.summary?.folders ?? [];
    state.summary = data.summary ?? null;
    updateSummary(state.summary);
    renderFolders(state.folders);
    render();
  } catch (err) {
    console.error(err);
    toast('加载图片列表失败：' + err.message);
    els.summary.textContent = '加载失败';
  }
}

// ============================================================
// 渲染
// ============================================================

function updateSummary(summary) {
  if (!summary) {
    els.summary.textContent = '';
    return;
  }
  const gh = summary.sources?.github ?? 0;
  const r2 = summary.sources?.r2 ?? 0;
  els.summary.textContent =
    `${summary.total} 张图片 · ${summary.totalSizeMb} MB · GitHub ${gh} · R2 ${r2}`;
}

function renderFolders(folders) {
  // 按来源分组（optgroup），value 用 source:folder 复合键，彻底区分同名目录
  const bySource = { github: [], r2: [] };
  folders.forEach((f) => {
    (bySource[f.source] = bySource[f.source] || []).push(f);
  });

  const label = { github: 'GitHub 图床', r2: 'R2 对象存储' };
  let html = '<option value="all">全部目录</option>';
  for (const src of ['github', 'r2']) {
    if (!bySource[src]?.length) continue;
    html += `<optgroup label="${label[src]}">`;
    html += bySource[src]
      .map(
        (f) =>
          `<option value="${src}:${escapeAttr(f.name)}">${escapeText(f.name)}（${f.count}）</option>`
      )
      .join('');
    html += '</optgroup>';
  }
  els.folderSelect.innerHTML = html;
}

function applyFilter() {
  const { source, folder, search } = state.filter;
  const q = search.trim().toLowerCase();
  // folder 可能是 'all' 或 'source:foldername'（复合键）
  let folderSource = null;
  let folderName = null;
  if (folder !== 'all' && folder.includes(':')) {
    [folderSource, folderName] = folder.split(':');
  }
  return state.items.filter((it) => {
    if (source !== 'all' && it.source !== source) return false;
    // 目录筛选：若选了复合键，同时匹配 source 和 folder
    if (folderSource && (it.source !== folderSource || it.folder !== folderName)) return false;
    if (q && !it.name?.toLowerCase().includes(q)) return false;
    return true;
  });
}

function render() {
  const items = applyFilter();
  if (items.length === 0) {
    els.gallery.innerHTML = '';
    return;
  }
  els.gallery.innerHTML = items.map(cardHtml).join('');
  // 绑定卡片点击（点图片/信息区打开灯箱；点复制按钮单独处理）
  els.gallery.querySelectorAll('.card').forEach((node) => {
    const id = node.dataset.id;
    const item = state.items.find((i) => i.id === id);
    node.addEventListener('click', (e) => {
      // 点复制按钮不触发灯箱
      if (e.target.closest('.card-copy')) {
        e.stopPropagation();
        copyUrl(item);
        return;
      }
      if (item) openLightbox(item);
    });
  });
}

function cardHtml(it) {
  const badge =
    it.source === 'r2'
      ? '<span class="badge badge-r2">R2</span>'
      : '<span class="badge badge-github">GitHub</span>';
  return `
    <article class="card" data-id="${escapeAttr(it.id)}">
      <img src="${escapeAttr(it.url)}" alt="${escapeAttr(it.name)}"
           loading="lazy" referrerpolicy="no-referrer" />
      <div class="card-meta">
        <div class="meta-left">
          <span class="folder" title="${escapeAttr(it.path)}">${escapeText(it.folder || '(root)')}</span>
          <span class="time">${formatTime(it.uploadedAt, it.source)}</span>
        </div>
        <div class="meta-right">
          <span class="size">${formatSize(it.sizeMb)}</span>${badge}
          <button class="card-copy" type="button" title="复制链接" aria-label="复制链接">⧉</button>
        </div>
      </div>
    </article>`;
}

// ============================================================
// 灯箱
// ============================================================

function openLightbox(item) {
  currentLightboxItem = item;
  els.lbImg.src = item.url;
  els.lbImg.alt = item.name;
  els.lbUrl.textContent = item.url;
  // 元信息：来源、目录、完整路径、时间、大小
  const parts = [];
  parts.push(`<span class="badge badge-${item.source}">${item.source === 'r2' ? 'R2' : 'GitHub'}</span>`);
  parts.push(`<span class="lb-field"><b>路径</b> ${escapeText(item.path)}</span>`);
  parts.push(`<span class="lb-field"><b>时间</b> ${formatTime(item.uploadedAt, item.source)}</span>`);
  if (typeof item.sizeMb === 'number') parts.push(`<span class="lb-field"><b>大小</b> ${formatSize(item.sizeMb)}</span>`);
  els.lbMeta.innerHTML = parts.join('');
  // 登录后才显示删除按钮；GitHub 和 R2 都能删
  els.lbDelete.hidden = !state.loggedIn;
  els.lightbox.hidden = false;
}

function closeLightbox() {
  els.lightbox.hidden = true;
  els.lbImg.src = '';
  currentLightboxItem = null;
}

async function copyCurrentUrl() {
  if (!currentLightboxItem) return;
  await copyUrl(currentLightboxItem);
}

// 复制任意图片的 URL（卡片快捷复制 + 灯箱复制共用）
async function copyUrl(item) {
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.url);
    toast('已复制');
  } catch (e) {
    toast('复制失败：' + e.message);
  }
}

// ============================================================
// 删除（R2 和 GitHub 都支持；需登录）
// ============================================================

async function deleteCurrent() {
  const item = currentLightboxItem;
  if (!item) return;
  if (!state.loggedIn) {
    toast('请先登录');
    return;
  }
  if (!confirm(`确认删除 ${item.name}？此操作不可撤销。`)) return;

  try {
    // credentials: 'include' 带 cookie（同源默认就带，这里显式声明）
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        source: item.source,
        key: item.path,
        sha: item.sha || undefined, // GitHub 删除需要
      }),
    });
    if (!res.ok) {
      const msg = await safeErr(res);
      throw new Error(msg);
    }
    // 从本地 state 移除并重渲染
    state.items = state.items.filter((i) => i.id !== item.id);
    closeLightbox();
    render();
    updateSummaryAfterDelete(item.source);
    toast('已删除');
  } catch (err) {
    toast('删除失败：' + err.message);
  }
}

// 删除后更新副标题统计（本地估算）
function updateSummaryAfterDelete(source) {
  if (!state.summary) return;
  state.summary.total = Math.max(0, state.summary.total - 1);
  if (source && state.summary.sources?.[source]) {
    state.summary.sources[source] = Math.max(0, state.summary.sources[source] - 1);
  }
  updateSummary(state.summary);
}

// ============================================================
// 上传
// ============================================================

function toggleUploadZone() {
  els.uploadZone.hidden = !els.uploadZone.hidden;
}

function setPendingFiles(fileList) {
  const next = Array.from(fileList || []);
  if (next.length) state.pendingFiles = state.pendingFiles.concat(next);
  renderFileList();
}

function renderFileList() {
  els.fileList.innerHTML = state.pendingFiles
    .map(
      (f, i) =>
        `<li data-i="${i}"><span>${escapeText(f.name)}</span>` +
        `<span class="status">待上传</span></li>`
    )
    .join('');
}

function getTarget() {
  const checked = document.querySelector('input[name="target"]:checked');
  return checked ? checked.value : 'r2';
}

async function startUpload() {
  if (state.pendingFiles.length === 0) {
    toast('请先选择文件');
    return;
  }
  if (!state.loggedIn) {
    toast('请先 GitHub 登录');
    return;
  }
  const target = getTarget();
  let path = els.uploadPath.value.trim();
  if (!path) path = target === 'picx' ? 'assets' : '';

  els.doUploadBtn.disabled = true;
  let okCount = 0;

  for (let i = 0; i < state.pendingFiles.length; i++) {
    const file = state.pendingFiles[i];
    updateFileStatus(i, '上传中 ' + file.name + '…', '');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target', target);
      fd.append('path', path);
      const res = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) throw new Error(await safeErr(res));
      updateFileStatus(i, '成功', 'ok');
      okCount++;
    } catch (err) {
      updateFileStatus(i, '失败：' + err.message, 'err');
    }
  }

  els.doUploadBtn.disabled = false;
  toast(`上传完成：${okCount}/${state.pendingFiles.length} 成功`);

  // 全部成功则提示刷新；否则部分成功提示
  if (okCount === state.pendingFiles.length && okCount > 0) {
    await tryRefresh();
    state.pendingFiles = [];
    renderFileList();
  } else if (okCount > 0) {
    toast('部分成功，数据可能有延迟，请稍后手动刷新页面');
  }
}

function updateFileStatus(index, text, cls) {
  const li = els.fileList.querySelector(`li[data-i="${index}"] .status`);
  if (li) {
    li.textContent = text;
    li.className = 'status' + (cls ? ' ' + cls : '');
  }
}

// 上传后刷新数据列表（无独立 refresh 接口则提示手动刷新）
async function tryRefresh() {
  // 没有 /api/refresh 端点，数据由 GitHub Actions 定时或手动 pnpm refresh 生成
  // 这里只提示用户
  toast('上传成功，数据列表请稍后刷新页面更新');
}

// ============================================================
// 工具函数
// ============================================================

function formatSize(sizeMb) {
  if (typeof sizeMb === 'number') {
    return sizeMb < 1 ? Math.round(sizeMb * 1024) + ' KB' : sizeMb + ' MB';
  }
  return '';
}

// 格式化时间；github 图片无上传时间则显示来源说明
function formatTime(uploadedAt, source) {
  if (uploadedAt) {
    const d = new Date(uploadedAt);
    if (!isNaN(d)) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    }
  }
  return source === 'github' ? '时间未知' : '—';
}

function escapeText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

async function safeErr(res) {
  try {
    const t = await res.text();
    // 尝试解析 JSON 取 error 字段
    try {
      const j = JSON.parse(t);
      return j.error || j.message || ('HTTP ' + res.status);
    } catch {
      return t || 'HTTP ' + res.status;
    }
  } catch {
    return 'HTTP ' + res.status;
  }
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
}

// 搜索 debounce
function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ============================================================
// 事件绑定
// ============================================================

function bindEvents() {
  // 来源按钮
  els.sourceBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      els.sourceBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter.source = btn.dataset.source;
      render();
    });
  });

  // 目录 select
  els.folderSelect.addEventListener('change', () => {
    state.filter.folder = els.folderSelect.value;
    render();
  });

  // 搜索（debounce 300ms）
  els.search.addEventListener(
    'input',
    debounce((e) => {
      state.filter.search = e.target.value;
      render();
    }, 300)
  );

  // 登录 / 登出
  els.loginBtn.addEventListener('click', () => {
    // 跳到 OAuth 登录入口，回来时刷新登录态
    window.location.href = '/api/login';
  });
  els.logoutBtn.addEventListener('click', () => {
    window.location.href = '/api/logout';
  });

  // 上传区切换
  els.uploadBtn.addEventListener('click', toggleUploadZone);

  // 文件选择
  els.fileInput.addEventListener('change', (e) => setPendingFiles(e.target.files));

  // 拖拽
  ['dragenter', 'dragover'].forEach((ev) =>
    els.uploadDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      els.uploadDrop.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    els.uploadDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      els.uploadDrop.classList.remove('dragover');
    })
  );
  els.uploadDrop.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files) setPendingFiles(e.dataTransfer.files);
  });

  // 开始上传
  els.doUploadBtn.addEventListener('click', startUpload);

  // 灯箱
  els.lbClose.addEventListener('click', closeLightbox);
  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox) closeLightbox();
  });
  els.lbCopy.addEventListener('click', copyCurrentUrl);
  els.lbDelete.addEventListener('click', deleteCurrent);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.lightbox.hidden) closeLightbox();
  });
}

// ============================================================
// 启动
// ============================================================

bindEvents();
checkLogin();   // 先查登录态（决定是否显示上传按钮）
loadAssets();   // 加载图片列表（看图公开，无需登录）
