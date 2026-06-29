// js/editor.js
// Browser-based CMS editor.
// Access: Ctrl+Shift+E to open login (no visible button)
// Auth:   tester / 123
// Data:   localStorage["gyu_meta"] + IndexedDB["gyu_files"]

const CREDS      = { user: 'tester', pass: '123' };
const SESSION_KEY = 'gyu_editor';
const META_KEY    = 'gyu_meta';
const CV_KEY      = 'gyu_cv';
const TEXT_KEY    = 'gyu_text';   // per-page inline text overrides
const CARDS_KEY   = 'gyu_cards';  // per static-card overrides (media/tags/deleted)
const IDB_NAME    = 'gyu_files';
const IDB_STORE   = 'files';

const PAGE = (() => {
  const p = location.pathname;
  if (p.includes('3d-projects')) return '3d-projects';
  if (p.includes('blog'))        return 'blog';
  if (p.includes('hub'))         return 'hub';
  if (p.includes('cv'))          return 'cv';
  return 'intro';
})();

// ─── IndexedDB ───────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
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
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(id);
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

// ─── Metadata ────────────────────────────────────────────────
function loadMeta()           { try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; } }
function saveMeta(m)          { localStorage.setItem(META_KEY, JSON.stringify(m)); }
function getPageEntries(p)    { return loadMeta()[p] || []; }
function savePageEntry(p, e)  {
  const m = loadMeta();
  if (!m[p]) m[p] = [];
  const i = m[p].findIndex(x => x.id === e.id);
  if (i >= 0) m[p][i] = e; else m[p].unshift(e);
  saveMeta(m);
}
function deletePageEntry(p,id){ const m=loadMeta(); if(m[p]) m[p]=m[p].filter(e=>e.id!==id); saveMeta(m); }
function genId()              { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// ─── Inline text editing (page titles, descriptions, static cards) ──
function loadTextStore()  { try { return JSON.parse(localStorage.getItem(TEXT_KEY) || '{}'); } catch { return {}; } }
function saveTextStore(s) { localStorage.setItem(TEXT_KEY, JSON.stringify(s)); }

// Tag elements as inline-editable, assign stable keys, apply saved overrides.
function initInlineText() {
  const store = loadTextStore();
  const apply = (el, key) => {
    if (!el) return;
    el.dataset.editKey = key;
    el.classList.add('editable-text');
    const k = PAGE + ':' + key;
    if (store[k] !== undefined) el.innerHTML = store[k];
  };

  // Page hero title + subtitle. Skip CV — it has its own cv-field system.
  if (PAGE !== 'cv') {
    apply(document.querySelector('.page-hero__title'), 'hero-title');
    apply(document.querySelector('.page-hero__sub'),   'hero-sub');
  }

  // Static project cards — keyed by the stable data-card-key (survives deletions)
  if (PAGE === '3d-projects') {
    document.querySelectorAll('.project-card:not([data-dynamic])').forEach(card => {
      const ck = card.dataset.cardKey ?? '';
      ['title', 'desc', 'meta'].forEach(part =>
        apply(card.querySelector('.project-card__' + part), `card-${ck}-${part}`));
    });
  }

  // Static blog posts (no deletion yet — positional keys are stable)
  if (PAGE === 'blog') {
    [['.post-featured:not([data-dynamic]) .post-featured__title',   'feat-title'],
     ['.post-featured:not([data-dynamic]) .post-featured__excerpt', 'feat-excerpt']]
      .forEach(([sel, key]) => apply(document.querySelector(sel), key));
    document.querySelectorAll('.post-row:not([data-dynamic])').forEach((row, i) => {
      apply(row.querySelector('.post-row__title'),   `row-${i}-title`);
      apply(row.querySelector('.post-row__excerpt'), `row-${i}-excerpt`);
    });
  }
}

function enableInlineEditing() {
  document.querySelectorAll('.editable-text').forEach(el => {
    el.contentEditable = 'true';
    if (!el._inlineWired) {
      el.addEventListener('blur', () => {
        const store = loadTextStore();
        store[PAGE + ':' + el.dataset.editKey] = el.innerHTML;
        saveTextStore(store);
      });
      // Enter commits (no newline) for single-line headings
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
      });
      el._inlineWired = true;
    }
  });
}

function disableInlineEditing() {
  document.querySelectorAll('.editable-text').forEach(el => { el.contentEditable = 'false'; });
}

// ─── Static project-card overrides (delete / media / tags) ──────
function loadCards()                 { try { return JSON.parse(localStorage.getItem(CARDS_KEY) || '{}'); } catch { return {}; } }
function saveCards(c)                { localStorage.setItem(CARDS_KEY, JSON.stringify(c)); }
function getCardOverride(page, key)  { const c = loadCards(); return (c[page] && c[page][key]) || {}; }
function setCardOverride(page, key, patch) {
  const c = loadCards();
  if (!c[page]) c[page] = {};
  c[page][key] = { ...(c[page][key] || {}), ...patch };
  saveCards(c);
}
const staticFileId = key => `static-3d-projects-${key}`;

// Render a media blob (image or fbx) into a card thumb
async function applyCardMedia(card, key, media) {
  const thumb = card.querySelector('.project-card__thumb');
  if (!thumb || !media) return;
  const blob = await loadFile(staticFileId(key));
  if (!blob) return;

  thumb.querySelectorAll('canvas, img.thumb-media').forEach(n => n.remove());
  card.classList.add('has-media');

  if (media.type === 'fbx') {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    thumb.appendChild(canvas);
    const buf = await blob.arrayBuffer();
    import('./fbx-viewer.js').then(({ initFBXViewer }) => initFBXViewer(canvas, buf));
  } else {
    const img = document.createElement('img');
    img.className = 'thumb-media';
    img.src = URL.createObjectURL(blob);
    img.alt = card.querySelector('.project-card__title')?.textContent || '';
    thumb.appendChild(img);
  }

  const label = thumb.querySelector('.project-card__label');
  if (label && media.fileName) label.textContent = `// ${media.fileName}`;
}

function clearCardMedia(card) {
  const thumb = card.querySelector('.project-card__thumb');
  if (!thumb) return;
  thumb.querySelectorAll('canvas, img.thumb-media').forEach(n => n.remove());
  card.classList.remove('has-media');
  const label = thumb.querySelector('.project-card__label');
  if (label && card.dataset.origLabel) label.textContent = card.dataset.origLabel;
}

function renderCardTags(card, tags) {
  const wrap = card.querySelector('.project-card__tags');
  if (!wrap) return;
  wrap.innerHTML = (tags || []).map(t => `<span class="tag">${t}</span>`).join('');
}

// Attach editor controls + media uploader to one static card
function setupStaticCardControls(card, key) {
  // Delete-the-whole-box button (top-right overlay)
  if (!card.querySelector('.card-editor-controls')) {
    const ctrls = document.createElement('div');
    ctrls.className = 'card-editor-controls';
    ctrls.innerHTML = `<button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete this box">×</button>`;
    ctrls.querySelector('.card-ctrl-btn--delete').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Delete this entire box? This cannot be undone.')) return;
      await deleteFile(staticFileId(key)).catch(() => {});
      setCardOverride('3d-projects', key, { deleted: true });
      card.remove();
    });
    card.appendChild(ctrls);
  }

  // Media uploader overlay on the thumb
  const thumb = card.querySelector('.project-card__thumb');
  if (thumb && !thumb.querySelector('.thumb-upload')) {
    const overlay = document.createElement('div');
    overlay.className = 'thumb-upload';
    overlay.innerHTML = `
      <span class="thumb-upload__pick">⬆ Upload image / .fbx</span>
      <button type="button" class="thumb-upload__remove">Remove media</button>
      <input type="file" accept=".fbx,.png,.jpg,.jpeg,.webp" hidden>`;
    const input  = overlay.querySelector('input');
    const remove = overlay.querySelector('.thumb-upload__remove');

    overlay.addEventListener('click', e => {
      if (!document.body.classList.contains('editor-active')) return;
      if (e.target === remove) return;
      e.stopPropagation();
      input.click();
    });
    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const media = { type: file.name.toLowerCase().endsWith('.fbx') ? 'fbx' : 'image', fileName: file.name };
      await saveFile(staticFileId(key), file);
      setCardOverride('3d-projects', key, { media });
      await applyCardMedia(card, key, media);
    });
    remove.addEventListener('click', async e => {
      e.stopPropagation();
      await deleteFile(staticFileId(key)).catch(() => {});
      setCardOverride('3d-projects', key, { media: null });
      clearCardMedia(card);
    });
    thumb.appendChild(overlay);
  }
}

// Tag the static cards, apply overrides, wire controls
async function enhanceStaticCards() {
  if (PAGE !== '3d-projects') return;
  const cards = [...document.querySelectorAll('.project-card:not([data-dynamic])')];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const key  = String(i);
    card.dataset.cardKey = key;
    const label = card.querySelector('.project-card__label');
    if (label) card.dataset.origLabel = label.textContent;

    const ov = getCardOverride('3d-projects', key);
    if (ov.deleted) { card.remove(); continue; }
    if (ov.tags)  renderCardTags(card, ov.tags);
    if (ov.media) await applyCardMedia(card, key, ov.media);

    setupStaticCardControls(card, key);
  }
}

// ─── Editable tags (inline add / edit / remove) ─────────────────
function persistCardTags(card) {
  const tags = [...card.querySelectorAll('.project-card__tags .tag:not(.tag-add)')]
    .map(t => t.textContent.replace(/\s*×\s*$/, '').trim()).filter(Boolean);
  if (card.dataset.entryId) {
    const entries = getPageEntries('3d-projects');
    const entry = entries.find(e => e.id === card.dataset.entryId);
    if (entry) { entry.tags = tags; savePageEntry('3d-projects', entry); }
  } else if (card.dataset.cardKey !== undefined) {
    setCardOverride('3d-projects', card.dataset.cardKey, { tags });
  }
}

function wireEditableTag(tag, card) {
  if (tag.classList.contains('tag-add') || tag._tagWired) return;
  tag.contentEditable = 'true';
  tag.addEventListener('click', e => e.stopPropagation());
  tag.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); tag.blur(); }
  });
  tag.addEventListener('blur', () => {
    if (!tag.textContent.trim()) tag.remove();
    persistCardTags(card);
  });
  tag._tagWired = true;
}

function enableTagEditing() {
  if (PAGE !== '3d-projects') return;
  document.querySelectorAll('.project-card').forEach(card => {
    const wrap = card.querySelector('.project-card__tags');
    if (!wrap) return;
    wrap.querySelectorAll('.tag').forEach(tag => wireEditableTag(tag, card));
    if (!wrap.querySelector('.tag-add')) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'tag tag-add';
      add.textContent = '+';
      add.title = 'Add tag';
      add.addEventListener('click', e => {
        e.stopPropagation();
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = 'tag';
        wrap.insertBefore(t, add);
        wireEditableTag(t, card);
        t.focus();
        const r = document.createRange(); r.selectNodeContents(t);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      wrap.appendChild(add);
    }
  });
}

function disableTagEditing() {
  document.querySelectorAll('.tag-add').forEach(b => b.remove());
  document.querySelectorAll('.project-card__tags .tag').forEach(t => { t.contentEditable = 'false'; });
}

// ─── Auth ────────────────────────────────────────────────────
function isEditorActive() { return sessionStorage.getItem(SESSION_KEY) === '1'; }
function activateEditor() {
  sessionStorage.setItem(SESSION_KEY, '1');
  document.body.classList.add('editor-active');
}
function deactivateEditor() {
  sessionStorage.removeItem(SESSION_KEY);
  document.body.classList.remove('editor-active');
  // Disable contenteditable on CV page
  document.querySelectorAll('.cv-field').forEach(el => {
    el.contentEditable = 'false';
  });
}

// ─── Modal factory ───────────────────────────────────────────
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
    </div>`;
  modal.querySelector('.editor-modal__close').addEventListener('click', () => closeModal(modal));
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal); });
  document.body.appendChild(modal);
  return modal;
}
function openModal(modal)  { modal.classList.add('is-open'); const f = modal.querySelector('input,textarea,select'); if(f) setTimeout(()=>f.focus(),50); }
function closeModal(modal) { modal.classList.remove('is-open'); }

// ─── Login modal ─────────────────────────────────────────────
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
    </form>`;
  document.getElementById('editor-login-form').addEventListener('submit', e => {
    e.preventDefault();
    const user = document.getElementById('ed-user').value.trim();
    const pass = document.getElementById('ed-pass').value;
    if (user === CREDS.user && pass === CREDS.pass) {
      closeModal(modal);
      activateEditor();
      document.getElementById('ed-user').value = '';
      document.getElementById('ed-pass').value = '';
    } else {
      const card = modal.querySelector('.editor-modal__card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      document.getElementById('editor-login-error').classList.add('is-visible');
    }
  });
  return modal;
}

// ─── Keyboard shortcut (Ctrl+Shift+E) ────────────────────────
function registerKeyboardShortcut() {
  const loginModal = buildLoginModal();
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      if (isEditorActive()) deactivateEditor();
      else openModal(loginModal);
    }
  });
}

// ─── Nav badge & logout ──────────────────────────────────────
function injectNavControls() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  // Badge
  if (!nav.querySelector('.editor-badge')) {
    const badge = document.createElement('span');
    badge.className = 'editor-badge';
    badge.textContent = 'Editing';
    nav.appendChild(badge);
  }

  // Logout
  if (!nav.querySelector('.editor-logout')) {
    const logout = document.createElement('button');
    logout.className = 'editor-logout';
    logout.textContent = 'Exit Editor';
    logout.addEventListener('click', deactivateEditor);
    nav.appendChild(logout);
  }
}

// ─── "Add Content" button ────────────────────────────────────
function injectAddContentBtn() {
  if (PAGE === '3d-projects') {
    const filterBar = document.querySelector('.filter-bar');
    if (!filterBar || filterBar.nextElementSibling?.classList.contains('add-content-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'add-content-btn';
    btn.innerHTML = '+ Add Project';
    btn.addEventListener('click', () => openUploadModal());
    filterBar.after(btn);
  }
  if (PAGE === 'blog') {
    const list = document.querySelector('.post-list');
    if (!list || list.previousElementSibling?.classList.contains('add-content-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'add-content-btn';
    btn.innerHTML = '+ Add Post';
    btn.addEventListener('click', () => openAddPostModal());
    list.before(btn);
  }
}

// ─── Project detail modal ────────────────────────────────────
function buildDetailModal() {
  const modal = document.createElement('div');
  modal.id = 'project-detail-modal';
  modal.className = 'editor-modal detail-modal';
  modal.innerHTML = `
    <div class="editor-modal__card editor-modal__card--wide detail-modal__card">
      <div class="detail-modal__preview" id="detail-preview"></div>
      <div class="detail-modal__body">
        <div class="detail-modal__header">
          <div>
            <p class="mono-label detail-modal__meta" id="detail-meta"></p>
            <h2 class="detail-modal__title" id="detail-title"></h2>
          </div>
          <button class="editor-modal__close" aria-label="Close">×</button>
        </div>
        <p class="detail-modal__desc" id="detail-desc"></p>
        <div class="detail-modal__tags" id="detail-tags"></div>
      </div>
    </div>`;
  modal.querySelector('.editor-modal__close').addEventListener('click', () => closeDetailModal());
  modal.addEventListener('click', e => { if (e.target === modal) closeDetailModal(); });
  document.body.appendChild(modal);
  return modal;
}

let detailCleanup = null;
function closeDetailModal() {
  const modal = document.getElementById('project-detail-modal');
  if (!modal) return;
  closeModal(modal);
  if (detailCleanup) { detailCleanup(); detailCleanup = null; }
  // Clear preview canvas/img after transition
  setTimeout(() => {
    const preview = document.getElementById('detail-preview');
    if (preview) preview.innerHTML = '';
  }, 300);
}

async function openDetailModal(card) {
  let modal = document.getElementById('project-detail-modal');
  if (!modal) modal = buildDetailModal();

  // Read data from card DOM
  const title    = card.querySelector('.project-card__title')?.textContent || '';
  const desc     = card.querySelector('.project-card__desc')?.textContent  || '';
  const meta     = card.querySelector('.project-card__meta')?.textContent  || '';
  const tags     = [...card.querySelectorAll('.tag')].map(t => t.textContent);
  const entryId  = card.dataset.entryId;
  const isDynamic= !!entryId;

  document.getElementById('detail-title').textContent = title;
  document.getElementById('detail-meta').textContent  = meta;
  document.getElementById('detail-desc').textContent  = desc;
  document.getElementById('detail-tags').innerHTML =
    tags.map(t => `<span class="tag">${t}</span>`).join('');

  const preview = document.getElementById('detail-preview');
  preview.innerHTML = ''; // clear

  if (isDynamic) {
    const entries = getPageEntries('3d-projects');
    const entry = entries.find(e => e.id === entryId);
    if (entry) {
      const blob = await loadFile(entry.fileId);
      if (blob) {
        if (entry.type === 'fbx') {
          const canvas = document.createElement('canvas');
          canvas.className = 'detail-modal__canvas';
          preview.appendChild(canvas);
          const buf = await blob.arrayBuffer();
          import('./fbx-viewer.js').then(({ initFBXViewer }) => {
            initFBXViewer(canvas, buf).then(cleanup => { detailCleanup = cleanup; });
          });
        } else {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(blob);
          img.className = 'detail-modal__img';
          img.alt = title;
          preview.appendChild(img);
        }
      }
    }
  } else {
    // Static card — show uploaded media if present, else the wireframe placeholder
    const key = card.dataset.cardKey;
    const ov  = key !== undefined ? getCardOverride('3d-projects', key) : {};
    if (ov.media) {
      preview.className = 'detail-modal__preview';
      const blob = await loadFile(staticFileId(key));
      if (blob && ov.media.type === 'fbx') {
        const canvas = document.createElement('canvas');
        canvas.className = 'detail-modal__canvas';
        preview.appendChild(canvas);
        const buf = await blob.arrayBuffer();
        import('./fbx-viewer.js').then(({ initFBXViewer }) => {
          initFBXViewer(canvas, buf).then(cleanup => { detailCleanup = cleanup; });
        });
      } else if (blob) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.className = 'detail-modal__img';
        img.alt = title;
        preview.appendChild(img);
      }
    } else {
      const hue = card.dataset.hue || 'clay';
      preview.className = `detail-modal__preview detail-modal__preview--${hue}`;
      const label = card.querySelector('.project-card__label')?.textContent || '';
      preview.innerHTML = `<span class="detail-modal__file-label">${label}</span>`;
    }
  }

  openModal(modal);
}

function wireProjectDetailClicks() {
  if (PAGE !== '3d-projects') return;
  document.getElementById('project-grid').addEventListener('click', e => {
    // Don't open detail when clicking editor controls
    if (e.target.closest('.card-editor-controls')) return;
    // In editor mode, clicking an editable field should edit it, not open the modal
    if (document.body.classList.contains('editor-active') && e.target.closest('.editable-text')) return;
    const card = e.target.closest('.project-card');
    if (card) openDetailModal(card);
  });
}

// ─── Project card builder (dynamic) ──────────────────────────
async function buildProjectCard(entry) {
  const card = document.createElement('article');
  card.className = 'project-card';
  card.dataset.category = entry.category || 'other';
  card.dataset.dynamic  = '1';
  card.dataset.entryId  = entry.id;

  const tags = (entry.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
  const cat  = entry.category ? entry.category.charAt(0).toUpperCase() + entry.category.slice(1) : 'Work';

  card.innerHTML = `
    <div class="project-card__thumb">
      <span class="project-card__label">// ${entry.fileName || 'upload'}</span>
    </div>
    <div class="project-card__body">
      <p class="mono-label project-card__meta">${cat} — ${entry.year || new Date().getFullYear()}</p>
      <h2 class="project-card__title">${entry.title}</h2>
      <p class="project-card__desc">${entry.description || ''}</p>
      <div class="project-card__tags">${tags}</div>
    </div>
    <div class="card-editor-controls">
      <button class="card-ctrl-btn card-ctrl-btn--edit" title="Edit">✎</button>
      <button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete">×</button>
    </div>`;

  const thumb = card.querySelector('.project-card__thumb');
  const blob  = await loadFile(entry.fileId);
  if (blob) {
    if (entry.type === 'fbx') {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;';
      thumb.appendChild(canvas);
      const buf = await blob.arrayBuffer();
      import('./fbx-viewer.js').then(({ initFBXViewer }) => initFBXViewer(canvas, buf));
    } else {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.alt = entry.title;
      thumb.appendChild(img);
    }
  }

  card.querySelector('.card-ctrl-btn--edit').addEventListener('click', e => {
    e.stopPropagation();
    openEditProjectModal(entry);
  });
  card.querySelector('.card-ctrl-btn--delete').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete "${entry.title}"?`)) return;
    await deleteFile(entry.fileId);
    deletePageEntry('3d-projects', entry.id);
    card.remove();
  });

  return card;
}

async function renderStoredProjects() {
  const grid = document.getElementById('project-grid');
  if (!grid) return;
  for (const entry of getPageEntries('3d-projects')) {
    grid.prepend(await buildProjectCard(entry));
  }
  refreshProjectFilter();
}

function refreshProjectFilter() {
  const activeBtn = document.querySelector('.filter-btn.is-active');
  if (!activeBtn) return;
  const filter = activeBtn.dataset.filter;
  document.querySelectorAll('.project-card').forEach(card => {
    card.classList.toggle('is-hidden', filter !== 'all' && card.dataset.category !== filter);
  });
}

// ─── Upload modal ─────────────────────────────────────────────
function openUploadModal(prefill = null) {
  const old = document.getElementById('editor-upload-modal');
  if (old) old.remove();

  const modal = buildModal('editor-upload-modal', prefill ? 'Edit Project' : 'Add Project', true);
  const body  = modal.querySelector('.editor-modal__body');
  const p     = prefill || {};

  body.innerHTML = `
    <form class="editor-form" id="upload-form" novalidate>
      <div class="upload-dropzone" id="upload-dropzone">
        <span class="upload-dropzone__icon">⬆</span>
        <span class="upload-dropzone__label">${prefill ? 'Drop a new file to replace (optional)' : 'Drop file here or click to browse'}</span>
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
              `<option value="${c}" ${p.category===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="editor-field">
          <label for="up-tags">Tags (comma-separated)</label>
          <input id="up-tags" type="text" value="${(p.tags||[]).join(', ')}">
        </div>
      </div>
      <div class="editor-btn-row">
        <button type="button" class="editor-btn editor-btn--ghost" id="upload-cancel">Cancel</button>
        <button type="submit" class="editor-btn editor-btn--primary">${prefill ? 'Save Changes' : 'Add to Portfolio'}</button>
      </div>
    </form>`;

  let pickedFile = null;
  const dropzone  = document.getElementById('upload-dropzone');
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
    e.preventDefault(); dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  document.getElementById('upload-cancel').addEventListener('click', () => closeModal(modal));

  document.getElementById('upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('up-title').value.trim();
    if (!title) return;
    if (!prefill && !pickedFile) { alert('Please pick a file.'); return; }

    const entry = {
      id: p.id || genId(),
      type: pickedFile ? (pickedFile.name.toLowerCase().endsWith('.fbx') ? 'fbx' : 'image') : p.type,
      title,
      description: document.getElementById('up-desc').value.trim(),
      category:    document.getElementById('up-category').value,
      year:        document.getElementById('up-year').value.trim(),
      tags:        document.getElementById('up-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
      fileId:      p.fileId || genId(),
      fileName:    pickedFile ? pickedFile.name : p.fileName,
    };

    if (pickedFile) await saveFile(entry.fileId, pickedFile);
    savePageEntry('3d-projects', entry);
    closeModal(modal);

    const existing = document.querySelector(`.project-card[data-entry-id="${entry.id}"]`);
    if (existing) existing.remove();
    const grid = document.getElementById('project-grid');
    grid.prepend(await buildProjectCard(entry));
    refreshProjectFilter();
  });

  openModal(modal);
}

function openEditProjectModal(entry) {
  openUploadModal(entry);
}

// ─── Blog ─────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return iso; }
}

function buildPostRow(entry, isFeatured = false) {
  const el = document.createElement('a');
  el.href = '#';
  el.dataset.dynamic = '1';
  el.dataset.entryId = entry.id;

  if (isFeatured) {
    el.className = 'post-featured';
    el.innerHTML = `
      <div class="post-featured__eyebrow">
        <span class="badge">Latest</span>
        <time class="post-featured__date" datetime="${entry.date}">${formatDate(entry.date)}</time>
      </div>
      <h2 class="post-featured__title">${entry.title}</h2>
      <p class="post-featured__excerpt">${entry.excerpt||''}</p>
      <span class="read-time">${entry.readTime||''}</span>
      <div class="post-editor-controls">
        <button class="card-ctrl-btn card-ctrl-btn--edit" title="Edit">✎</button>
        <button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete">×</button>
      </div>`;
  } else {
    el.className = 'post-row';
    el.setAttribute('role','listitem');
    el.innerHTML = `
      <time class="post-row__date" datetime="${entry.date}">${formatDate(entry.date)}</time>
      <div class="post-row__body">
        <span class="post-row__tag">${entry.tag||''}</span>
        <h2 class="post-row__title">${entry.title}</h2>
        <p class="post-row__excerpt">${entry.excerpt||''}</p>
        <div class="post-row__meta"><span class="read-time">${entry.readTime||''}</span></div>
      </div>
      <span class="post-row__arrow" aria-hidden="true">→</span>
      <div class="post-editor-controls">
        <button class="card-ctrl-btn card-ctrl-btn--edit" title="Edit">✎</button>
        <button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete">×</button>
      </div>`;
  }

  el.querySelector('.card-ctrl-btn--edit').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation(); openAddPostModal(entry);
  });
  el.querySelector('.card-ctrl-btn--delete').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(`Delete "${entry.title}"?`)) return;
    deletePageEntry('blog', entry.id);
    el.remove();
  });
  return el;
}

function renderStoredPosts() {
  const list = document.querySelector('.post-list');
  if (!list) return;
  getPageEntries('blog').forEach((entry, i) => {
    const el = buildPostRow(entry, i === 0);
    if (i === 0) {
      const ef = document.querySelector('.post-featured');
      if (ef) ef.before(el); else list.before(el);
    } else {
      list.prepend(el);
    }
  });
}

function openAddPostModal(prefill = null) {
  const old = document.getElementById('editor-post-modal');
  if (old) old.remove();
  const modal = buildModal('editor-post-modal', prefill ? 'Edit Post' : 'Add Post', true);
  const body  = modal.querySelector('.editor-modal__body');
  const p     = prefill || {};
  const today = new Date().toISOString().split('T')[0];

  body.innerHTML = `
    <form class="editor-form" id="post-form" novalidate>
      <div class="editor-field">
        <label for="post-title">Title</label>
        <input id="post-title" type="text" value="${p.title||''}" required>
      </div>
      <div class="editor-field">
        <label for="post-excerpt">Excerpt</label>
        <textarea id="post-excerpt">${p.excerpt||''}</textarea>
      </div>
      <div class="editor-field__row">
        <div class="editor-field">
          <label for="post-tag">Tag</label>
          <input id="post-tag" type="text" value="${p.tag||''}">
        </div>
        <div class="editor-field">
          <label for="post-date">Date</label>
          <input id="post-date" type="date" value="${p.date||today}">
        </div>
      </div>
      <div class="editor-field">
        <label for="post-readtime">Read time</label>
        <input id="post-readtime" type="text" value="${p.readTime||''}">
      </div>
      <div class="editor-btn-row">
        <button type="button" class="editor-btn editor-btn--ghost" id="post-cancel">Cancel</button>
        <button type="submit" class="editor-btn editor-btn--primary">${prefill?'Save Changes':'Publish Post'}</button>
      </div>
    </form>`;

  document.getElementById('post-cancel').addEventListener('click', () => closeModal(modal));
  document.getElementById('post-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('post-title').value.trim();
    if (!title) return;
    const entry = {
      id: p.id || genId(),
      title,
      excerpt:  document.getElementById('post-excerpt').value.trim(),
      tag:      document.getElementById('post-tag').value.trim(),
      date:     document.getElementById('post-date').value,
      readTime: document.getElementById('post-readtime').value.trim(),
    };
    savePageEntry('blog', entry);
    closeModal(modal);
    document.querySelector(`[data-entry-id="${entry.id}"]`)?.remove();
    const entries = getPageEntries('blog');
    const el = buildPostRow(entry, entries[0]?.id === entry.id);
    const list = document.querySelector('.post-list');
    if (entries[0]?.id === entry.id) {
      document.querySelector('.post-featured[data-dynamic]')?.before(el) || list?.before(el);
    } else {
      list?.prepend(el);
    }
  });
  openModal(modal);
}

// ─── CV editing ───────────────────────────────────────────────
function loadCV() {
  if (PAGE !== 'cv') return;
  try {
    const data = JSON.parse(localStorage.getItem(CV_KEY) || '{}');
    document.querySelectorAll('.cv-field').forEach(el => {
      const key = el.dataset.field;
      if (data[key] !== undefined) el.innerHTML = data[key];
    });
  } catch {}

  // Photo
  loadFile('cv-photo').then(blob => {
    if (!blob) return;
    const img = document.getElementById('cv-photo-img');
    const placeholder = document.querySelector('.cv-photo__placeholder');
    if (img) { img.src = URL.createObjectURL(blob); img.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
  });
}

function enableCVEditing() {
  if (PAGE !== 'cv') return;
  document.querySelectorAll('.cv-field').forEach(el => {
    el.contentEditable = 'true';
  });
}

function disableCVEditing() {
  document.querySelectorAll('.cv-field').forEach(el => {
    el.contentEditable = 'false';
  });
}

function saveCV() {
  const data = {};
  document.querySelectorAll('.cv-field').forEach(el => {
    data[el.dataset.field] = el.innerHTML;
  });
  localStorage.setItem(CV_KEY, JSON.stringify(data));
  const btn = document.getElementById('cv-save-btn');
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save CV'; }, 2000); }
}

async function exportCVAsPNG() {
  const btn = document.getElementById('cv-export-btn');
  if (typeof html2canvas !== 'function') {
    alert('Export library is still loading — please try again in a moment.');
    return;
  }
  if (btn) { btn.classList.add('is-busy'); btn.textContent = 'Rendering…'; }

  // Hide floating UI so it doesn't appear in the capture
  const hidden = ['.cv-actions', '.site-nav', '.editor-badge', '.editor-logout'];
  const restore = [];
  hidden.forEach(sel => document.querySelectorAll(sel).forEach(el => {
    restore.push([el, el.style.visibility]);
    el.style.visibility = 'hidden';
  }));

  try {
    const target = document.querySelector('.page-shell') || document.body;
    const bg = getComputedStyle(document.body).backgroundColor || '#16151A';
    const canvas = await html2canvas(target, { backgroundColor: bg, scale: 2, useCORS: true });
    const a = document.createElement('a');
    const name = (document.querySelector('[data-field="fullName"]')?.textContent || 'guanyu')
      .trim().toLowerCase().replace(/\s+/g, '-');
    a.download = `${name}-cv.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (err) {
    console.error(err);
    alert('Could not export the CV. See console for details.');
  } finally {
    restore.forEach(([el, v]) => { el.style.visibility = v; });
    if (btn) { btn.classList.remove('is-busy'); btn.textContent = 'Export PNG'; }
  }
}

function wireCV() {
  if (PAGE !== 'cv') return;

  // Save button
  document.getElementById('cv-save-btn')?.addEventListener('click', saveCV);

  // Export to PNG (available to everyone)
  document.getElementById('cv-export-btn')?.addEventListener('click', exportCVAsPNG);

  // Photo upload
  const photoBlock = document.getElementById('cv-photo-block');
  const photoInput = document.getElementById('cv-photo-input');
  photoBlock?.addEventListener('click', () => {
    if (isEditorActive()) photoInput?.click();
  });
  photoInput?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    await saveFile('cv-photo', file);
    const img = document.getElementById('cv-photo-img');
    const placeholder = document.querySelector('.cv-photo__placeholder');
    if (img) { img.src = URL.createObjectURL(file); img.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
  });

  // Logout on cv page
  document.querySelector('.editor-logout')?.addEventListener('click', () => {
    deactivateEditor();
    disableCVEditing();
  });
}

// ─── Watch editor-active state changes ───────────────────────
const origActivate   = activateEditor;
const origDeactivate = deactivateEditor;

// Patch to handle CV-specific side effects
function activateEditorFull() {
  origActivate();
  enableInlineEditing();
  enableTagEditing();
  if (PAGE === 'cv') enableCVEditing();
}
function deactivateEditorFull() {
  origDeactivate();
  disableInlineEditing();
  disableTagEditing();
  if (PAGE === 'cv') disableCVEditing();
}

// ─── Init ────────────────────────────────────────────────────
async function init() {
  // Restore editor session (inline editing enabled after content renders, below)
  if (isEditorActive()) {
    document.body.classList.add('editor-active');
  }

  // Override activate/deactivate with CV-aware versions
  const loginModal = buildLoginModal();
  // Patch login form submit to use full activate
  const loginForm = document.getElementById('editor-login-form');
  if (loginForm) {
    loginForm.removeEventListener('submit', loginForm._handler);
    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      const user = document.getElementById('ed-user').value.trim();
      const pass = document.getElementById('ed-pass').value;
      if (user === CREDS.user && pass === CREDS.pass) {
        closeModal(loginModal);
        activateEditorFull();
        document.getElementById('ed-user').value = '';
        document.getElementById('ed-pass').value = '';
      } else {
        const card = loginModal.querySelector('.editor-modal__card');
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        document.getElementById('editor-login-error').classList.add('is-visible');
      }
    });
  }

  // Keyboard shortcut
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      if (isEditorActive()) deactivateEditorFull();
      else openModal(loginModal);
    }
  });

  // Nav controls (badge + logout) on pages that have .site-nav
  injectNavControls();

  // Patch logout buttons on all pages
  document.querySelectorAll('.editor-logout').forEach(btn => {
    btn.addEventListener('click', deactivateEditorFull);
  });

  // Page-specific setup
  if (PAGE === '3d-projects') {
    injectAddContentBtn();
    await renderStoredProjects();
    await enhanceStaticCards();
    wireProjectDetailClicks();
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(refreshProjectFilter, 0));
    });
  }

  if (PAGE === 'blog') {
    injectAddContentBtn();
    renderStoredPosts();
  }

  if (PAGE === 'cv') {
    loadCV();
    wireCV();
  }

  // Tag editable text (page titles/descriptions, static cards) and apply
  // saved overrides for everyone; turn on editing if a session is active.
  initInlineText();
  if (isEditorActive()) {
    enableInlineEditing();
    enableTagEditing();
    if (PAGE === 'cv') enableCVEditing();
  }
}

init();
