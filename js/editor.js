// js/editor.js
// Browser-based CMS editor for GuanYuPortfolio.
// Auth: tester / 123  (sessionStorage-based, resets on tab close)
// Metadata: localStorage["gyu_meta"]
// Files:    IndexedDB["gyu_files"] → object store "files"

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const CREDS = { user: 'tester', pass: '123' };
const SESSION_KEY = 'gyu_editor';
const META_KEY = 'gyu_meta';
const IDB_NAME = 'gyu_files';
const IDB_STORE = 'files';

// Detect which page we're on
const PAGE = (() => {
  const p = location.pathname;
  if (p.includes('3d-projects')) return '3d-projects';
  if (p.includes('blog'))        return 'blog';
  if (p.includes('hub'))         return 'hub';
  return 'intro';
})();

// ─────────────────────────────────────────────────────────────
// IndexedDB helpers
// ─────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveFile(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ id, blob });
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function loadFile(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly')
                  .objectStore(IDB_STORE).get(id);
    req.onsuccess = e => resolve(e.result ? e.result.blob : null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function deleteFile(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

// ─────────────────────────────────────────────────────────────
// Metadata helpers (localStorage)
// ─────────────────────────────────────────────────────────────
function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
  catch { return {}; }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function getPageEntries(page) {
  return loadMeta()[page] || [];
}

function savePageEntry(page, entry) {
  const meta = loadMeta();
  if (!meta[page]) meta[page] = [];
  const idx = meta[page].findIndex(e => e.id === entry.id);
  if (idx >= 0) meta[page][idx] = entry;
  else meta[page].unshift(entry); // newest first
  saveMeta(meta);
}

function deletePageEntry(page, id) {
  const meta = loadMeta();
  if (meta[page]) meta[page] = meta[page].filter(e => e.id !== id);
  saveMeta(meta);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────
function isEditorActive() {
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

function activateEditor() {
  sessionStorage.setItem(SESSION_KEY, '1');
  document.body.classList.add('editor-active');
}

function deactivateEditor() {
  sessionStorage.removeItem(SESSION_KEY);
  document.body.classList.remove('editor-active');
}

// ─────────────────────────────────────────────────────────────
// Modal factory
// ─────────────────────────────────────────────────────────────
function buildModal(id, titleText, wide = false) {
  const existing = document.getElementById(id);
  if (existing) return existing;

  const modal = document.createElement('div');
  modal.id = id;
  modal.className = 'editor-modal';
  modal.innerHTML = `
    <div class="editor-modal__card ${wide ? 'editor-modal__card--wide' : ''}">
      <div class="editor-modal__header">
        <span class="editor-modal__title">${titleText}</span>
        <button class="editor-modal__close" aria-label="Close">×</button>
      </div>
      <div class="editor-modal__body"></div>
    </div>
  `;

  modal.querySelector('.editor-modal__close').addEventListener('click', () => closeModal(modal));
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal); });
  document.body.appendChild(modal);
  return modal;
}

function openModal(modal) {
  modal.classList.add('is-open');
  const first = modal.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeModal(modal) {
  modal.classList.remove('is-open');
}

// ─────────────────────────────────────────────────────────────
// Login modal
// ─────────────────────────────────────────────────────────────
function buildLoginModal() {
  const modal = buildModal('editor-login-modal', 'Studio Access');
  const body = modal.querySelector('.editor-modal__body');
  body.innerHTML = `
    <form class="editor-form" id="editor-login-form" novalidate>
      <div class="editor-field">
        <label for="ed-user">Username</label>
        <input id="ed-user" type="text" autocomplete="username" spellcheck="false">
      </div>
      <div class="editor-field">
        <label for="ed-pass">Password</label>
        <input id="ed-pass" type="password" autocomplete="current-password">
      </div>
      <p class="editor-error" id="editor-login-error">Incorrect credentials.</p>
      <div class="editor-btn-row">
        <button type="submit" class="editor-btn editor-btn--primary">Enter Studio</button>
      </div>
    </form>
  `;

  document.getElementById('editor-login-form').addEventListener('submit', e => {
    e.preventDefault();
    const user = document.getElementById('ed-user').value.trim();
    const pass = document.getElementById('ed-pass').value;
    if (user === CREDS.user && pass === CREDS.pass) {
      closeModal(modal);
      activateEditor();
    } else {
      const card = modal.querySelector('.editor-modal__card');
      card.classList.remove('shake');
      void card.offsetWidth; // reflow to re-trigger animation
      card.classList.add('shake');
      document.getElementById('editor-login-error').classList.add('is-visible');
    }
  });

  return modal;
}

// ─────────────────────────────────────────────────────────────
// Edit-key button injection
// ─────────────────────────────────────────────────────────────
function injectEditKey() {
  const loginModal = buildLoginModal();

  if (PAGE === 'intro') {
    // Intro has no .site-nav — render as fixed button
    const btn = document.createElement('button');
    btn.className = 'editor-key editor-key--fixed';
    btn.title = 'Editor login';
    btn.textContent = '✎';
    btn.addEventListener('click', () => {
      if (isEditorActive()) deactivateEditor();
      else openModal(loginModal);
    });
    document.body.appendChild(btn);
    return;
  }

  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  const badge = document.createElement('span');
  badge.className = 'editor-badge';
  badge.textContent = 'Editing';

  const logout = document.createElement('button');
  logout.className = 'editor-logout';
  logout.textContent = 'Exit Editor';
  logout.addEventListener('click', deactivateEditor);

  const editKey = document.createElement('button');
  editKey.className = 'editor-key';
  editKey.title = 'Editor login';
  editKey.textContent = '✎ Edit';
  editKey.addEventListener('click', () => openModal(loginModal));

  nav.appendChild(badge);
  nav.appendChild(logout);
  nav.appendChild(editKey);
}

// ─────────────────────────────────────────────────────────────
// Project card builder
// ─────────────────────────────────────────────────────────────
async function buildProjectCard(entry) {
  const card = document.createElement('article');
  card.className = 'project-card';
  card.dataset.category = entry.category || 'other';
  card.dataset.dynamic = '1';
  card.dataset.entryId = entry.id;

  const tags = (entry.tags || []).map(t => `<span class="tag">${t}</span>`).join('');

  card.innerHTML = `
    <div class="project-card__thumb">
      <span class="project-card__label">// ${entry.fileName || 'upload'}</span>
    </div>
    <div class="project-card__body">
      <p class="mono-label project-card__meta">${entry.category ? entry.category.charAt(0).toUpperCase() + entry.category.slice(1) : 'Work'} — ${entry.year || new Date().getFullYear()}</p>
      <h2 class="project-card__title">${entry.title}</h2>
      <p class="project-card__desc">${entry.description || ''}</p>
      <div class="project-card__tags">${tags}</div>
    </div>
    <div class="card-editor-controls">
      <button class="card-ctrl-btn card-ctrl-btn--edit" title="Edit">✎</button>
      <button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete">×</button>
    </div>
  `;

  const thumb = card.querySelector('.project-card__thumb');

  // Populate thumb with file content
  const blob = await loadFile(entry.fileId);
  if (blob) {
    const isFBX = entry.type === 'fbx';
    if (isFBX) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;';
      thumb.appendChild(canvas);
      // Lazy-import the FBX viewer so Three.js only loads when needed
      const arrayBuffer = await blob.arrayBuffer();
      import('./fbx-viewer.js').then(({ initFBXViewer }) => {
        initFBXViewer(canvas, arrayBuffer);
      });
    } else {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.alt = entry.title;
      thumb.appendChild(img);
    }
  }

  // Edit button
  card.querySelector('.card-ctrl-btn--edit').addEventListener('click', e => {
    e.stopPropagation();
    openEditProjectModal(entry);
  });

  // Delete button
  card.querySelector('.card-ctrl-btn--delete').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete "${entry.title}"?`)) return;
    await deleteFile(entry.fileId);
    deletePageEntry('3d-projects', entry.id);
    card.remove();
  });

  return card;
}

// ─────────────────────────────────────────────────────────────
// Load and render all stored project cards
// ─────────────────────────────────────────────────────────────
async function renderStoredProjects() {
  const grid = document.getElementById('project-grid');
  if (!grid) return;

  const entries = getPageEntries('3d-projects');
  for (const entry of entries) {
    const card = await buildProjectCard(entry);
    grid.prepend(card);
  }

  // Re-run filter so dynamic cards respect active filter
  refreshProjectFilter();
}

function refreshProjectFilter() {
  const activeBtn = document.querySelector('.filter-btn.is-active');
  if (!activeBtn) return;
  const filter = activeBtn.dataset.filter;
  document.querySelectorAll('.project-card').forEach(card => {
    card.classList.toggle('is-hidden',
      filter !== 'all' && card.dataset.category !== filter);
  });
}

// ─────────────────────────────────────────────────────────────
// Upload modal for 3D projects
// ─────────────────────────────────────────────────────────────
function openUploadModal(prefill = null) {
  const modal = buildModal('editor-upload-modal', prefill ? 'Edit Project' : 'Add Project', true);
  const body = modal.querySelector('.editor-modal__body');

  const isEdit = !!prefill;
  const p = prefill || {};

  body.innerHTML = `
    <form class="editor-form" id="upload-form" novalidate>
      <div class="upload-dropzone" id="upload-dropzone" ${isEdit ? 'style="border-style:solid;opacity:0.6;"' : ''}>
        <span class="upload-dropzone__icon">⬆</span>
        <span class="upload-dropzone__label">${isEdit ? 'Drop a new file to replace (optional)' : 'Drop file here or click to browse'}</span>
        <span class="upload-dropzone__sub">Accepts .fbx · .png · .jpg · .jpeg · .webp</span>
        <span class="upload-dropzone__filename" id="upload-filename"></span>
        <input type="file" id="upload-file-input" accept=".fbx,.png,.jpg,.jpeg,.webp" style="display:none">
      </div>

      <div class="editor-field__row">
        <div class="editor-field">
          <label for="up-title">Title</label>
          <input id="up-title" type="text" value="${p.title || ''}" required>
        </div>
        <div class="editor-field">
          <label for="up-year">Year</label>
          <input id="up-year" type="text" value="${p.year || new Date().getFullYear()}" maxlength="4">
        </div>
      </div>

      <div class="editor-field">
        <label for="up-desc">Description</label>
        <textarea id="up-desc">${p.description || ''}</textarea>
      </div>

      <div class="editor-field__row">
        <div class="editor-field">
          <label for="up-category">Category</label>
          <select id="up-category">
            ${['character','environment','product','motion','other'].map(c =>
              `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="editor-field">
          <label for="up-tags">Tags (comma-separated)</label>
          <input id="up-tags" type="text" value="${(p.tags || []).join(', ')}">
        </div>
      </div>

      <div class="editor-btn-row">
        <button type="button" class="editor-btn editor-btn--ghost" id="upload-cancel">Cancel</button>
        <button type="submit" class="editor-btn editor-btn--primary">${isEdit ? 'Save Changes' : 'Add to Portfolio'}</button>
      </div>
    </form>
  `;

  // File pick logic
  let pickedFile = null;
  const dropzone = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('upload-file-input');
  const fileLabel = document.getElementById('upload-filename');

  function handleFile(file) {
    pickedFile = file;
    fileLabel.textContent = file.name;
    dropzone.classList.add('has-file');
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  document.getElementById('upload-cancel').addEventListener('click', () => closeModal(modal));

  document.getElementById('upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('up-title').value.trim();
    if (!title) return;
    if (!isEdit && !pickedFile) { alert('Please pick a file.'); return; }

    const entry = {
      id: p.id || genId(),
      type: pickedFile
        ? (pickedFile.name.toLowerCase().endsWith('.fbx') ? 'fbx' : 'image')
        : p.type,
      title,
      description: document.getElementById('up-desc').value.trim(),
      category: document.getElementById('up-category').value,
      year: document.getElementById('up-year').value.trim(),
      tags: document.getElementById('up-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      fileId: p.fileId || genId(),
      fileName: pickedFile ? pickedFile.name : p.fileName,
    };

    if (pickedFile) {
      await saveFile(entry.fileId, pickedFile);
    }

    savePageEntry('3d-projects', entry);
    closeModal(modal);

    // Update DOM
    const existing = document.querySelector(`.project-card[data-entry-id="${entry.id}"]`);
    if (existing) existing.remove();
    const grid = document.getElementById('project-grid');
    const card = await buildProjectCard(entry);
    grid.prepend(card);
    refreshProjectFilter();
  });

  openModal(modal);
}

function openEditProjectModal(entry) {
  // Remove stale modal so it rebuilds with fresh prefill
  const old = document.getElementById('editor-upload-modal');
  if (old) old.remove();
  openUploadModal(entry);
}

// ─────────────────────────────────────────────────────────────
// Blog post builder
// ─────────────────────────────────────────────────────────────
function buildPostRow(entry, isFeatured = false) {
  if (isFeatured) {
    const el = document.createElement('a');
    el.href = '#';
    el.className = 'post-featured';
    el.dataset.dynamic = '1';
    el.dataset.entryId = entry.id;
    el.innerHTML = `
      <div class="post-featured__eyebrow">
        <span class="badge">Latest</span>
        <time class="post-featured__date" datetime="${entry.date}">${formatDate(entry.date)}</time>
      </div>
      <h2 class="post-featured__title">${entry.title}</h2>
      <p class="post-featured__excerpt">${entry.excerpt || ''}</p>
      <span class="read-time">${entry.readTime || ''}</span>
      <div class="post-editor-controls">
        <button class="card-ctrl-btn card-ctrl-btn--edit" title="Edit">✎</button>
        <button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete">×</button>
      </div>
    `;
    el.querySelector('.card-ctrl-btn--edit').addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation(); openEditPostModal(entry);
    });
    el.querySelector('.card-ctrl-btn--delete').addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!confirm(`Delete "${entry.title}"?`)) return;
      deletePageEntry('blog', entry.id);
      el.remove();
    });
    return el;
  }

  const el = document.createElement('a');
  el.href = '#';
  el.className = 'post-row';
  el.setAttribute('role', 'listitem');
  el.dataset.dynamic = '1';
  el.dataset.entryId = entry.id;
  el.innerHTML = `
    <time class="post-row__date" datetime="${entry.date}">${formatDate(entry.date)}</time>
    <div class="post-row__body">
      <span class="post-row__tag">${entry.tag || ''}</span>
      <h2 class="post-row__title">${entry.title}</h2>
      <p class="post-row__excerpt">${entry.excerpt || ''}</p>
      <div class="post-row__meta"><span class="read-time">${entry.readTime || ''}</span></div>
    </div>
    <span class="post-row__arrow" aria-hidden="true">→</span>
    <div class="post-editor-controls">
      <button class="card-ctrl-btn card-ctrl-btn--edit" title="Edit">✎</button>
      <button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete">×</button>
    </div>
  `;
  el.querySelector('.card-ctrl-btn--edit').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation(); openEditPostModal(entry);
  });
  el.querySelector('.card-ctrl-btn--delete').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(`Delete "${entry.title}"?`)) return;
    deletePageEntry('blog', entry.id);
    el.remove();
  });
  return el;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function renderStoredPosts() {
  const list = document.querySelector('.post-list');
  if (!list) return;

  const entries = getPageEntries('blog');
  entries.forEach((entry, i) => {
    const isFeatured = i === 0;
    const el = buildPostRow(entry, isFeatured);
    if (isFeatured) {
      // Insert before the existing .post-featured (or at top of content)
      const existingFeatured = document.querySelector('.post-featured');
      if (existingFeatured) existingFeatured.before(el);
      else list.before(el);
    } else {
      list.prepend(el);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Blog post modal
// ─────────────────────────────────────────────────────────────
function openAddPostModal(prefill = null) {
  const old = document.getElementById('editor-post-modal');
  if (old) old.remove();

  const modal = buildModal('editor-post-modal', prefill ? 'Edit Post' : 'Add Post', true);
  const body = modal.querySelector('.editor-modal__body');
  const p = prefill || {};
  const today = new Date().toISOString().split('T')[0];

  body.innerHTML = `
    <form class="editor-form" id="post-form" novalidate>
      <div class="editor-field">
        <label for="post-title">Title</label>
        <input id="post-title" type="text" value="${p.title || ''}" required>
      </div>
      <div class="editor-field">
        <label for="post-excerpt">Excerpt</label>
        <textarea id="post-excerpt">${p.excerpt || ''}</textarea>
      </div>
      <div class="editor-field__row">
        <div class="editor-field">
          <label for="post-tag">Tag / Category</label>
          <input id="post-tag" type="text" value="${p.tag || ''}">
        </div>
        <div class="editor-field">
          <label for="post-date">Date (YYYY-MM-DD)</label>
          <input id="post-date" type="date" value="${p.date || today}">
        </div>
      </div>
      <div class="editor-field">
        <label for="post-readtime">Read time (e.g. "5 min read")</label>
        <input id="post-readtime" type="text" value="${p.readTime || ''}">
      </div>
      <div class="editor-btn-row">
        <button type="button" class="editor-btn editor-btn--ghost" id="post-cancel">Cancel</button>
        <button type="submit" class="editor-btn editor-btn--primary">${prefill ? 'Save Changes' : 'Publish Post'}</button>
      </div>
    </form>
  `;

  document.getElementById('post-cancel').addEventListener('click', () => closeModal(modal));

  document.getElementById('post-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('post-title').value.trim();
    if (!title) return;

    const entry = {
      id: p.id || genId(),
      title,
      excerpt: document.getElementById('post-excerpt').value.trim(),
      tag: document.getElementById('post-tag').value.trim(),
      date: document.getElementById('post-date').value,
      readTime: document.getElementById('post-readtime').value.trim(),
    };

    savePageEntry('blog', entry);
    closeModal(modal);

    // Remove old element and re-render
    const existing = document.querySelector(`[data-entry-id="${entry.id}"]`);
    if (existing) existing.remove();

    const entries = getPageEntries('blog');
    const isFeatured = entries[0]?.id === entry.id;
    const el = buildPostRow(entry, isFeatured);

    const list = document.querySelector('.post-list');
    if (isFeatured) {
      const ef = document.querySelector('.post-featured[data-dynamic]');
      if (ef) ef.before(el);
      else if (list) list.before(el);
    } else {
      if (list) list.prepend(el);
    }
  });

  openModal(modal);
}

function openEditPostModal(entry) {
  openAddPostModal(entry);
}

// ─────────────────────────────────────────────────────────────
// "Add Content" / "Add Post" button injection
// ─────────────────────────────────────────────────────────────
function injectAddContentBtn() {
  if (PAGE === '3d-projects') {
    const filterBar = document.querySelector('.filter-bar');
    if (!filterBar) return;
    const btn = document.createElement('button');
    btn.className = 'add-content-btn';
    btn.innerHTML = '+ Add Project';
    btn.addEventListener('click', () => openUploadModal());
    filterBar.after(btn);
  }

  if (PAGE === 'blog') {
    const list = document.querySelector('.post-list');
    if (!list) return;
    const btn = document.createElement('button');
    btn.className = 'add-content-btn';
    btn.innerHTML = '+ Add Post';
    btn.addEventListener('click', () => openAddPostModal());
    list.before(btn);
  }
}

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
async function init() {
  // Restore editor session if already active
  if (isEditorActive()) {
    document.body.classList.add('editor-active');
  }

  injectEditKey();
  injectAddContentBtn();

  // Load stored content for the current page
  if (PAGE === '3d-projects') {
    await renderStoredProjects();
    // Re-wire filter buttons to also affect dynamic cards
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(refreshProjectFilter, 0));
    });
  }

  if (PAGE === 'blog') {
    renderStoredPosts();
  }
}

init();
