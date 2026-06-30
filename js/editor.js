// js/editor.js
// Browser-based CMS editor for the portfolio.
// Access: Ctrl+Shift+E to open login (no visible button)
// Backend: see store.js — Supabase when configured, browser-only otherwise.

import * as db from './store.js';

const META_KEY  = 'gyu_meta';
const CV_KEY    = 'gyu_cv';
const TEXT_KEY  = 'gyu_text';   // per-page inline text overrides
const CARDS_KEY = 'gyu_cards';  // per static-card overrides (media/tags/deleted)

const PAGE = (() => {
  const p = location.pathname;
  if (p.includes('3d-projects')) return '3d-projects';
  if (p.includes('blog'))        return 'blog';
  if (p.includes('hub'))         return 'hub';
  if (p.includes('cv'))          return 'cv';
  return 'intro';
})();

// ─── Files (delegated to the data layer) ─────────────────────
const saveFile   = (id, blob) => db.uploadMedia(id, blob);
const loadFile   = (id)       => db.loadMedia(id);
const deleteFile = (id)       => db.removeMedia(id);

// ─── Metadata ────────────────────────────────────────────────
function loadMeta()           { return db.getContent(META_KEY, {}); }
function saveMeta(m)          { db.setContent(META_KEY, m); }
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
function loadTextStore()  { return db.getContent(TEXT_KEY, {}); }
function saveTextStore(s) { db.setContent(TEXT_KEY, s); }

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
function loadCards()                 { return db.getContent(CARDS_KEY, {}); }
function saveCards(c)                { db.setContent(CARDS_KEY, c); }
function getCardOverride(page, key)  { const c = loadCards(); return (c[page] && c[page][key]) || {}; }
function setCardOverride(page, key, patch) {
  const c = loadCards();
  if (!c[page]) c[page] = {};
  c[page][key] = { ...(c[page][key] || {}), ...patch };
  saveCards(c);
}
const staticFileId = key => `static-3d-projects-${key}`;
const isImageName  = n => /\.(png|jpe?g|webp|gif|avif)$/i.test(n || '');

// Normalize an entry's images to [{fileId, fileName}] (back-compat with a single fileId).
function entryImages(entry) {
  if (Array.isArray(entry.images) && entry.images.length) return entry.images;
  if (entry.type !== 'fbx' && entry.fileId) return [{ fileId: entry.fileId, fileName: entry.fileName }];
  return [];
}

// Normalize a static-card media override to its image list (back-compat with legacy single file).
function staticMediaImages(key, media) {
  if (Array.isArray(media.images) && media.images.length) return media.images;
  return [{ fileId: staticFileId(key), fileName: media.fileName }];
}

// Delete every backing file referenced by a static-card media override.
async function removeStaticMediaFiles(key, media) {
  if (!media) return;
  if (media.type === 'fbx') {
    await deleteFile(media.fileId || staticFileId(key)).catch(() => {});
  } else {
    for (const im of staticMediaImages(key, media)) await deleteFile(im.fileId).catch(() => {});
  }
}

// Build an auto-playing image carousel element from [{fileId, fileName}].
// Returns null if no images load. The element gets a ._cleanup() to stop the
// timer and revoke object URLs.
async function buildImageCarousel(imageList, { contain = false } = {}) {
  const urls = [];
  for (const im of imageList) {
    const blob = await loadFile(im.fileId);
    if (blob) urls.push(URL.createObjectURL(blob));
  }
  if (!urls.length) return null;

  const car = document.createElement('div');
  car.className = 'carousel' + (contain ? ' carousel--contain' : '');

  const track = document.createElement('div');
  track.className = 'carousel__track';
  urls.forEach((u, i) => {
    const img = document.createElement('img');
    img.className = 'carousel__slide' + (i === 0 ? ' is-active' : '');
    img.src = u; img.alt = '';
    track.appendChild(img);
  });
  car.appendChild(track);

  const slides = [...track.children];
  const dots = [];
  let idx = 0, timer = null;
  const show  = n => {
    idx = (n + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
    dots.forEach((d, i)  => d.classList.toggle('is-active', i === idx));
  };
  const stop  = () => { if (timer) { clearInterval(timer); timer = null; } };
  const start = () => { if (urls.length > 1 && !timer) timer = setInterval(() => show(idx + 1), 4000); };

  if (urls.length > 1) {
    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'carousel__nav carousel__prev';
    prev.setAttribute('aria-label', 'Previous image'); prev.textContent = '‹';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'carousel__nav carousel__next';
    next.setAttribute('aria-label', 'Next image'); next.textContent = '›';
    prev.addEventListener('click', e => { e.stopPropagation(); stop(); show(idx - 1); });
    next.addEventListener('click', e => { e.stopPropagation(); stop(); show(idx + 1); });

    const dotWrap = document.createElement('div');
    dotWrap.className = 'carousel__dots';
    urls.forEach((_, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'carousel__dot' + (i === 0 ? ' is-active' : '');
      d.addEventListener('click', e => { e.stopPropagation(); stop(); show(i); });
      dotWrap.appendChild(d); dots.push(d);
    });

    car.append(prev, next, dotWrap);
    car.addEventListener('mouseenter', stop);
    car.addEventListener('mouseleave', start);
    start();
  }

  car._cleanup = () => { stop(); urls.forEach(u => URL.revokeObjectURL(u)); };
  return car;
}

function clearThumbMedia(thumb) {
  thumb.querySelectorAll('canvas, img.thumb-media, .carousel').forEach(n => {
    if (n.classList?.contains('carousel') && n._cleanup) n._cleanup();
    n.remove();
  });
}

// Render a static-card media override (fbx viewer or image carousel) into a card thumb.
async function applyCardMedia(card, key, media) {
  const thumb = card.querySelector('.project-card__thumb');
  if (!thumb || !media) return;
  clearThumbMedia(thumb);

  if (media.type === 'fbx') {
    const blob = await loadFile(media.fileId || staticFileId(key));
    if (!blob) return;
    card.classList.add('has-media');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    thumb.appendChild(canvas);
    const buf = await blob.arrayBuffer();
    import('./fbx-viewer.js').then(({ initFBXViewer }) => initFBXViewer(canvas, buf));
  } else {
    const car = await buildImageCarousel(staticMediaImages(key, media));
    if (!car) return;
    card.classList.add('has-media');
    thumb.appendChild(car);
  }

  const label = thumb.querySelector('.project-card__label');
  if (label && media.fileName) label.textContent = `// ${media.fileName}`;
}

function clearCardMedia(card) {
  const thumb = card.querySelector('.project-card__thumb');
  if (!thumb) return;
  clearThumbMedia(thumb);
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
      await removeStaticMediaFiles(key, getCardOverride('3d-projects', key).media);
      setCardOverride('3d-projects', key, { deleted: true });
      card.remove();
    });
    card.appendChild(ctrls);
  }

  // Media uploader overlay on the thumb (multiple images form a carousel)
  const thumb = card.querySelector('.project-card__thumb');
  if (thumb && !thumb.querySelector('.thumb-upload')) {
    const overlay = document.createElement('div');
    overlay.className = 'thumb-upload';
    overlay.innerHTML = `
      <span class="thumb-upload__pick">⬆ Upload images / .fbx</span>
      <button type="button" class="thumb-upload__remove">Remove media</button>
      <input type="file" accept=".fbx,.png,.jpg,.jpeg,.webp,.gif,.avif" multiple hidden>`;
    const input  = overlay.querySelector('input');
    const remove = overlay.querySelector('.thumb-upload__remove');

    overlay.addEventListener('click', e => {
      if (!document.body.classList.contains('editor-active')) return;
      if (e.target === remove) return;
      e.stopPropagation();
      input.click();
    });
    input.addEventListener('change', async e => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      const prev = getCardOverride('3d-projects', key).media;
      const fbx  = files.find(f => f.name.toLowerCase().endsWith('.fbx'));
      let media;

      if (fbx) {
        await removeStaticMediaFiles(key, prev);
        const fileId = genId();
        await saveFile(fileId, fbx);
        media = { type: 'fbx', fileId, fileName: fbx.name };
      } else {
        const imgs = files.filter(f => isImageName(f.name));
        if (!imgs.length) return;
        // append to an existing image carousel, or start a new one
        const existing = (prev && prev.type === 'image') ? staticMediaImages(key, prev) : [];
        if (prev && prev.type === 'fbx') await removeStaticMediaFiles(key, prev);
        const added = [];
        for (const f of imgs) {
          const fileId = genId();
          await saveFile(fileId, f);
          added.push({ fileId, fileName: f.name });
        }
        const images = [...existing, ...added];
        media = { type: 'image', images, fileName: images[0]?.fileName };
      }

      setCardOverride('3d-projects', key, { media });
      await applyCardMedia(card, key, media);
    });
    remove.addEventListener('click', async e => {
      e.stopPropagation();
      await removeStaticMediaFiles(key, getCardOverride('3d-projects', key).media);
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
function isEditorActive() { return db.isLoggedIn(); }
function activateEditor() {
  document.body.classList.add('editor-active');
}
function deactivateEditor() {
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

// ─── Login modal (single shared password) ────────────────────
function buildLoginModal() {
  const modal = buildModal('editor-login-modal', 'Studio Access');
  const body = modal.querySelector('.editor-modal__body');
  body.innerHTML = `
    <form class="editor-form" id="editor-login-form" novalidate>
      <div class="editor-field">
        <label for="ed-pass">Password</label>
        <input id="ed-pass" type="password" autocomplete="current-password">
      </div>
      <p class="editor-error" id="editor-login-error">Incorrect password.</p>
      <div class="editor-btn-row">
        <button type="submit" class="editor-btn editor-btn--primary">Enter Studio</button>
      </div>
    </form>`;
  body.querySelector('#editor-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const passEl = document.getElementById('ed-pass');
    const submit = modal.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Checking…';
    const { ok } = await db.signIn(passEl.value);
    submit.disabled = false; submit.textContent = 'Enter Studio';
    if (ok) {
      closeModal(modal);
      passEl.value = '';
      document.getElementById('editor-login-error').classList.remove('is-visible');
      activateEditorFull();
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

  // Logout (click handler wired centrally in init)
  if (!nav.querySelector('.editor-logout')) {
    const logout = document.createElement('button');
    logout.className = 'editor-logout';
    logout.textContent = 'Exit Editor';
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
      preview.className = 'detail-modal__preview';
      if (entry.type === 'fbx' && entry.fileId) {
        const blob = await loadFile(entry.fileId);
        if (blob) {
          const canvas = document.createElement('canvas');
          canvas.className = 'detail-modal__canvas';
          preview.appendChild(canvas);
          const buf = await blob.arrayBuffer();
          import('./fbx-viewer.js').then(({ initFBXViewer }) => {
            initFBXViewer(canvas, buf).then(cleanup => { detailCleanup = cleanup; });
          });
        }
      } else {
        const car = await buildImageCarousel(entryImages(entry), { contain: true });
        if (car) { preview.appendChild(car); detailCleanup = car._cleanup; }
      }
    }
  } else {
    // Static card — show uploaded media if present, else the wireframe placeholder
    const key = card.dataset.cardKey;
    const ov  = key !== undefined ? getCardOverride('3d-projects', key) : {};
    if (ov.media) {
      preview.className = 'detail-modal__preview';
      if (ov.media.type === 'fbx') {
        const blob = await loadFile(ov.media.fileId || staticFileId(key));
        if (blob) {
          const canvas = document.createElement('canvas');
          canvas.className = 'detail-modal__canvas';
          preview.appendChild(canvas);
          const buf = await blob.arrayBuffer();
          import('./fbx-viewer.js').then(({ initFBXViewer }) => {
            initFBXViewer(canvas, buf).then(cleanup => { detailCleanup = cleanup; });
          });
        }
      } else {
        const car = await buildImageCarousel(staticMediaImages(key, ov.media), { contain: true });
        if (car) { preview.appendChild(car); detailCleanup = car._cleanup; }
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
  if (entry.type === 'fbx' && entry.fileId) {
    const blob = await loadFile(entry.fileId);
    if (blob) {
      card.classList.add('has-media');
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;';
      thumb.appendChild(canvas);
      const buf = await blob.arrayBuffer();
      import('./fbx-viewer.js').then(({ initFBXViewer }) => initFBXViewer(canvas, buf));
    }
  } else {
    const car = await buildImageCarousel(entryImages(entry));
    if (car) { card.classList.add('has-media'); thumb.appendChild(car); }
  }

  card.querySelector('.card-ctrl-btn--edit').addEventListener('click', e => {
    e.stopPropagation();
    openEditProjectModal(entry);
  });
  card.querySelector('.card-ctrl-btn--delete').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete "${entry.title}"?`)) return;
    if (entry.type === 'fbx' && entry.fileId) await deleteFile(entry.fileId).catch(() => {});
    for (const im of entryImages(entry)) await deleteFile(im.fileId).catch(() => {});
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

// ─── Upload modal (multi-image carousel + optional .fbx) ──────
async function openUploadModal(prefill = null) {
  const old = document.getElementById('editor-upload-modal');
  if (old) old.remove();

  const modal = buildModal('editor-upload-modal', prefill ? 'Edit Project' : 'Add Project', true);
  const body  = modal.querySelector('.editor-modal__body');
  const p     = prefill || {};

  body.innerHTML = `
    <form class="editor-form" id="upload-form" novalidate>
      <div class="upload-dropzone" id="upload-dropzone">
        <span class="upload-dropzone__icon">⬆</span>
        <span class="upload-dropzone__label">Drop images (or a .fbx) here, or click to browse</span>
        <span class="upload-dropzone__sub">Multiple images become a carousel · .fbx · .png · .jpg · .webp</span>
        <input type="file" id="upload-file-input" accept=".fbx,.png,.jpg,.jpeg,.webp,.gif,.avif" multiple style="display:none">
      </div>
      <div class="upload-media-strip" id="upload-media-strip"></div>
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

  // Media working set. Either a list of image slides OR a single fbx slide.
  //   image slide: { fileName, file? (new), fileId? (existing), url }
  //   fbx slide:   { fileName, file? (new), fileId? (existing) }
  let imageSlides = [];
  let fbxSlide    = null;
  const removedExisting = [];   // fileIds of removed existing files, deleted on save

  if (p.type === 'fbx' && p.fileId) {
    fbxSlide = { fileId: p.fileId, fileName: p.fileName };
  } else {
    for (const im of entryImages(p)) {
      const blob = await loadFile(im.fileId);
      imageSlides.push({ fileId: im.fileId, fileName: im.fileName, url: blob ? URL.createObjectURL(blob) : '' });
    }
  }

  const strip = document.getElementById('upload-media-strip');
  function renderStrip() {
    strip.innerHTML = '';
    if (fbxSlide) {
      const chip = document.createElement('div');
      chip.className = 'media-chip media-chip--file';
      chip.innerHTML = `<span>🧊 ${fbxSlide.fileName || '3D model'}</span><button type="button" class="media-chip__x" aria-label="Remove">×</button>`;
      chip.querySelector('.media-chip__x').addEventListener('click', () => {
        if (fbxSlide.fileId && !fbxSlide.file) removedExisting.push(fbxSlide.fileId);
        if (fbxSlide.url) URL.revokeObjectURL(fbxSlide.url);
        fbxSlide = null; renderStrip();
      });
      strip.appendChild(chip);
      return;
    }
    imageSlides.forEach((s, i) => {
      const chip = document.createElement('div');
      chip.className = 'media-chip media-chip--img';
      chip.innerHTML = `<img src="${s.url}" alt=""><button type="button" class="media-chip__x" aria-label="Remove">×</button>`;
      chip.querySelector('.media-chip__x').addEventListener('click', () => {
        if (s.fileId && !s.file) removedExisting.push(s.fileId);
        if (s.url && s.file) URL.revokeObjectURL(s.url);
        imageSlides.splice(i, 1); renderStrip();
      });
      strip.appendChild(chip);
    });
  }

  function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const fbx = files.find(f => f.name.toLowerCase().endsWith('.fbx'));
    if (fbx) {
      // switch to a single 3D model — drop any pending images
      imageSlides.forEach(s => { if (s.fileId && !s.file) removedExisting.push(s.fileId); });
      imageSlides = [];
      fbxSlide = { file: fbx, fileName: fbx.name };
    } else {
      const imgs = files.filter(f => isImageName(f.name));
      if (!imgs.length) return;
      if (fbxSlide) { if (fbxSlide.fileId && !fbxSlide.file) removedExisting.push(fbxSlide.fileId); fbxSlide = null; }
      imgs.forEach(f => imageSlides.push({ file: f, fileName: f.name, url: URL.createObjectURL(f) }));
    }
    renderStrip();
  }

  const dropzone  = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('upload-file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });

  document.getElementById('upload-cancel').addEventListener('click', () => closeModal(modal));

  document.getElementById('upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('up-title').value.trim();
    if (!title) return;
    if (!fbxSlide && imageSlides.length === 0) { alert('Add at least one image or a .fbx file.'); return; }

    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Saving…';

    const entry = {
      id:          p.id || genId(),
      title,
      description: document.getElementById('up-desc').value.trim(),
      category:    document.getElementById('up-category').value,
      year:        document.getElementById('up-year').value.trim(),
      tags:        document.getElementById('up-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    };

    if (fbxSlide) {
      let fileId = fbxSlide.fileId;
      if (fbxSlide.file) { fileId = fbxSlide.fileId || genId(); await saveFile(fileId, fbxSlide.file); }
      entry.type = 'fbx';
      entry.fileId = fileId;
      entry.fileName = fbxSlide.fileName;
      entry.images = [];
    } else {
      const images = [];
      for (const s of imageSlides) {
        if (s.file) { const fid = genId(); await saveFile(fid, s.file); images.push({ fileId: fid, fileName: s.fileName }); }
        else images.push({ fileId: s.fileId, fileName: s.fileName });
      }
      entry.type = 'image';
      entry.images = images;
      entry.fileName = images[0]?.fileName;
      delete entry.fileId;
    }

    for (const fid of removedExisting) await deleteFile(fid).catch(() => {});

    savePageEntry('3d-projects', entry);
    closeModal(modal);

    document.querySelector(`.project-card[data-entry-id="${entry.id}"]`)?.remove();
    document.getElementById('project-grid').prepend(await buildProjectCard(entry));
    refreshProjectFilter();
  });

  renderStrip();
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
  const data = db.getContent(CV_KEY, {}) || {};
  document.querySelectorAll('.cv-field').forEach(el => {
    const key = el.dataset.field;
    if (data[key] !== undefined) el.innerHTML = data[key];
  });

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
  db.setContent(CV_KEY, data);
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

  // (Logout is wired centrally in init for every .editor-logout button.)
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
  // Bring up the data layer first (loads cloud content into cache, restores session)
  await db.initStore();

  const loginModal = buildLoginModal();

  // Keyboard shortcut to open login / toggle editor
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
      e.preventDefault();
      if (isEditorActive()) { db.signOut(); deactivateEditorFull(); }
      else openModal(loginModal);
    }
  });

  // Nav controls (badge + logout) on pages that have .site-nav
  injectNavControls();

  // Wire any pre-existing logout buttons (e.g. hardcoded on the CV page)
  document.querySelectorAll('.editor-logout').forEach(btn => {
    btn.addEventListener('click', () => { db.signOut(); deactivateEditorFull(); });
  });

  // React to the session ending elsewhere (token expiry, sign-out on another tab)
  db.onAuthChange(active => { if (!active) deactivateEditorFull(); });

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
  // saved overrides for everyone; turn on editing if already logged in.
  initInlineText();
  if (isEditorActive()) activateEditorFull();
}

init();
