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
function escapeHtml(s)        { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function selectAllText(el)    { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }

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

  // Intro / landing page
  if (PAGE === 'intro') {
    apply(document.querySelector('.landing__eyebrow'), 'landing-eyebrow');
    apply(document.querySelector('.landing__title'),   'landing-title');
    apply(document.querySelector('.landing__sub'),     'landing-sub');
    apply(document.querySelector('.enter-btn'),        'landing-enter');
  }

  // Awards section heading
  if (PAGE === '3d-projects') {
    apply(document.querySelector('.awards-section .section-title'), 'awards-title');
    apply(document.querySelector('.awards-section .section-eyebrow'), 'awards-eyebrow');
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
const isVideoName  = n => /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(n || '');
const mediaKind    = n => (isVideoName(n) ? 'video' : 'image');

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
  for (const im of staticMediaImages(key, media)) await deleteFile(im.fileId).catch(() => {});
}

// Build an auto-playing carousel of images and/or videos from
// [{fileId, fileName, kind?}]. Returns null if nothing loads. The element gets
// a ._cleanup() to stop the timer, pause videos, and revoke object URLs.
// Options: contain (object-fit), videoControls (play controls on video slides).
async function buildImageCarousel(mediaList, { contain = false, videoControls = false } = {}) {
  const items = [];
  for (const m of mediaList) {
    const blob = await loadFile(m.fileId);
    if (blob) items.push({ url: URL.createObjectURL(blob), kind: m.kind || mediaKind(m.fileName) });
  }
  if (!items.length) return null;

  const hasVideo = items.some(it => it.kind === 'video');
  const car = document.createElement('div');
  car.className = 'carousel' + (contain ? ' carousel--contain' : '');

  const track = document.createElement('div');
  track.className = 'carousel__track';
  const slides = [];
  items.forEach((it, i) => {
    let el;
    if (it.kind === 'video') {
      el = document.createElement('video');
      el.src = it.url;
      el.playsInline = true;
      if (videoControls) {
        el.controls = true;
        el.preload = 'metadata';
      } else {
        // Thumbnail: mute + nudge to the first frame so it isn't a black box
        el.muted = true;
        el.preload = 'auto';
        el.addEventListener('loadeddata', () => { try { if (!el.currentTime) el.currentTime = 0.05; } catch {} }, { once: true });
      }
    } else {
      el = document.createElement('img');
      el.src = it.url;
      el.alt = '';
    }
    el.className = 'carousel__slide' + (i === 0 ? ' is-active' : '');
    track.appendChild(el);
    slides.push(el);
  });
  car.appendChild(track);

  // Hint that a slide is a playable video when controls are hidden (thumbnails)
  if (hasVideo && !videoControls) {
    const play = document.createElement('span');
    play.className = 'carousel__play';
    play.textContent = '▶';
    car.appendChild(play);
  }

  const dots = [];
  let idx = 0, timer = null;
  const show = n => {
    idx = (n + slides.length) % slides.length;
    slides.forEach((s, i) => {
      s.classList.toggle('is-active', i === idx);
      if (s.tagName === 'VIDEO' && i !== idx) s.pause();
    });
    dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
  };
  const stop  = () => { if (timer) { clearInterval(timer); timer = null; } };
  // Auto-advance only for all-image carousels (videos play on their own time)
  const start = () => { if (slides.length > 1 && !hasVideo && !timer) timer = setInterval(() => show(idx + 1), 4000); };

  if (slides.length > 1) {
    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'carousel__nav carousel__prev';
    prev.setAttribute('aria-label', 'Previous'); prev.textContent = '‹';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'carousel__nav carousel__next';
    next.setAttribute('aria-label', 'Next'); next.textContent = '›';
    prev.addEventListener('click', e => { e.stopPropagation(); stop(); show(idx - 1); });
    next.addEventListener('click', e => { e.stopPropagation(); stop(); show(idx + 1); });

    const dotWrap = document.createElement('div');
    dotWrap.className = 'carousel__dots';
    items.forEach((_, i) => {
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

  car._cleanup = () => {
    stop();
    slides.forEach(s => { if (s.tagName === 'VIDEO') s.pause(); });
    items.forEach(it => URL.revokeObjectURL(it.url));
  };
  return car;
}

function clearThumbMedia(thumb) {
  thumb.querySelectorAll('canvas, img.thumb-media, .carousel').forEach(n => {
    if (n.classList?.contains('carousel') && n._cleanup) n._cleanup();
    n.remove();
  });
}

// Render a static-card media override (image/video carousel) into a card thumb.
async function applyCardMedia(card, key, media) {
  const thumb = card.querySelector('.project-card__thumb');
  if (!thumb || !media) return;
  clearThumbMedia(thumb);

  const car = await buildImageCarousel(staticMediaImages(key, media));
  if (!car) return;
  card.classList.add('has-media');
  thumb.appendChild(car);

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
      <span class="thumb-upload__pick">⬆ Upload images / video</span>
      <button type="button" class="thumb-upload__remove">Remove media</button>
      <input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.mp4,.webm,.ogg,.ogv,.mov,.m4v" multiple hidden>`;
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
      const imgs = files.filter(f => isImageName(f.name) || isVideoName(f.name));
      if (!imgs.length) return;
      // append to an existing carousel, or start a new one
      const existing = (prev && prev.type === 'image') ? staticMediaImages(key, prev) : [];
      const added = [];
      for (const f of imgs) {
        const fileId = genId();
        await saveFile(fileId, f);
        added.push({ fileId, fileName: f.name, kind: mediaKind(f.name) });
      }
      const images = [...existing, ...added];
      const media = { type: 'image', images, fileName: images[0]?.fileName };

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
    const collection = card.dataset.collection || '3d-projects';
    const entries = getPageEntries(collection);
    const entry = entries.find(e => e.id === card.dataset.entryId);
    if (entry) { entry.tags = tags; savePageEntry(collection, entry); }
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
  // Prefer the page nav; pages without one (e.g. intro) get a floating bar.
  let host = document.querySelector('.site-nav');
  if (!host) {
    host = document.querySelector('.editor-floatbar');
    if (!host) {
      host = document.createElement('div');
      host.className = 'editor-floatbar';
      document.body.appendChild(host);
    }
  }

  // Badge
  if (!host.querySelector('.editor-badge')) {
    const badge = document.createElement('span');
    badge.className = 'editor-badge';
    badge.textContent = 'Editing';
    host.appendChild(badge);
  }

  // Logout (click handler wired centrally in init)
  if (!host.querySelector('.editor-logout')) {
    const logout = document.createElement('button');
    logout.className = 'editor-logout';
    logout.textContent = 'Exit Editor';
    host.appendChild(logout);
  }
}

// ─── "Add Content" button ────────────────────────────────────
function injectAddContentBtn() {
  if (PAGE === '3d-projects') {
    const filterBar = document.querySelector('.filter-bar');
    if (filterBar && !filterBar.nextElementSibling?.classList.contains('add-content-btn')) {
      const btn = document.createElement('button');
      btn.className = 'add-content-btn';
      btn.innerHTML = '+ Add Project';
      btn.addEventListener('click', () => openUploadModal('3d-projects'));
      filterBar.after(btn);
    }
    const awardGrid = document.getElementById('award-grid');
    if (awardGrid && !awardGrid.previousElementSibling?.classList.contains('add-content-btn')) {
      const abtn = document.createElement('button');
      abtn.className = 'add-content-btn';
      abtn.innerHTML = '+ Add Award';
      abtn.addEventListener('click', () => openUploadModal('awards'));
      awardGrid.before(abtn);
    }
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
    const collection = card.dataset.collection || '3d-projects';
    const entries = getPageEntries(collection);
    const entry = entries.find(e => e.id === entryId);
    if (entry) {
      preview.className = 'detail-modal__preview';
      const car = await buildImageCarousel(entryImages(entry), { contain: true, videoControls: true });
      if (car) { preview.appendChild(car); detailCleanup = car._cleanup; }
    }
  } else {
    // Static card — show uploaded media if present, else the wireframe placeholder
    const key = card.dataset.cardKey;
    const ov  = key !== undefined ? getCardOverride('3d-projects', key) : {};
    if (ov.media) {
      preview.className = 'detail-modal__preview';
      const car = await buildImageCarousel(staticMediaImages(key, ov.media), { contain: true, videoControls: true });
      if (car) { preview.appendChild(car); detailCleanup = car._cleanup; }
    } else {
      const hue = card.dataset.hue || 'clay';
      preview.className = `detail-modal__preview detail-modal__preview--${hue}`;
      const label = card.querySelector('.project-card__label')?.textContent || '';
      preview.innerHTML = `<span class="detail-modal__file-label">${label}</span>`;
    }
  }

  openModal(modal);
}

function wireGridClicks(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.addEventListener('click', e => {
    // Don't open detail when clicking editor controls
    if (e.target.closest('.card-editor-controls')) return;
    // In editor mode, clicking an editable field should edit it, not open the modal
    if (document.body.classList.contains('editor-active') && e.target.closest('.editable-text')) return;
    const card = e.target.closest('.project-card');
    if (card) openDetailModal(card);
  });
}

// ─── Project card builder (dynamic) ──────────────────────────
async function buildProjectCard(entry, collection = '3d-projects') {
  const card = document.createElement('article');
  card.className = 'project-card';
  card.dataset.category   = entry.category || '';
  card.dataset.dynamic    = '1';
  card.dataset.entryId    = entry.id;
  card.dataset.collection = collection;

  const tags = (entry.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
  const catLabel = filterLabel(entry.category);
  const metaPrefix = catLabel ? `${escapeHtml(catLabel)} — ` : '';

  card.innerHTML = `
    <div class="project-card__thumb">
      <span class="project-card__label">// ${entry.fileName || 'upload'}</span>
    </div>
    <div class="project-card__body">
      <p class="mono-label project-card__meta">${metaPrefix}${entry.year || new Date().getFullYear()}</p>
      <h2 class="project-card__title">${entry.title}</h2>
      <p class="project-card__desc">${entry.description || ''}</p>
      <div class="project-card__tags">${tags}</div>
    </div>
    <div class="card-editor-controls">
      <button class="card-ctrl-btn card-ctrl-btn--edit" title="Edit">✎</button>
      <button class="card-ctrl-btn card-ctrl-btn--delete" title="Delete">×</button>
    </div>`;

  const thumb = card.querySelector('.project-card__thumb');
  const car = await buildImageCarousel(entryImages(entry));
  if (car) { card.classList.add('has-media'); thumb.appendChild(car); }

  card.querySelector('.card-ctrl-btn--edit').addEventListener('click', e => {
    e.stopPropagation();
    openUploadModal(collection, entry);
  });
  card.querySelector('.card-ctrl-btn--delete').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete "${entry.title}"?`)) return;
    for (const im of entryImages(entry)) await deleteFile(im.fileId).catch(() => {});
    deletePageEntry(collection, entry.id);
    card.remove();
  });

  return card;
}

async function renderCollection(collection, gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  for (const entry of getPageEntries(collection)) {
    grid.prepend(await buildProjectCard(entry, collection));
  }
}

async function renderStoredProjects() {
  await renderCollection('3d-projects', 'project-grid');
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

// ─── User-defined filter tags ────────────────────────────────
const FILTERS_KEY = 'gyu_filters';
function loadFilters()      { return db.getContent(FILTERS_KEY, []); }
function saveFilters(list)  { db.setContent(FILTERS_KEY, list); }
function filterLabel(id)    { const f = loadFilters().find(x => x.id === id); return f ? f.label : ''; }

function categoryOptionsHTML(selectedId) {
  return `<option value="">— Uncategorized —</option>` +
    loadFilters().map(f =>
      `<option value="${f.id}" ${f.id === selectedId ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
    ).join('');
}

function renderFilterBar() {
  const bar = document.querySelector('.filter-bar');
  if (!bar) return;
  const prevActive = bar.querySelector('.filter-btn.is-active')?.dataset.filter || 'all';
  const filters = loadFilters();

  bar.innerHTML =
    `<button class="filter-btn" data-filter="all"><span class="filter-btn__label">All</span></button>` +
    filters.map(f => `
      <span class="filter-item">
        <button class="filter-btn" data-filter="${f.id}"><span class="filter-btn__label">${escapeHtml(f.label)}</span></button>
        <button class="filter-del" data-id="${f.id}" type="button" title="Delete filter" aria-label="Delete filter">×</button>
      </span>`).join('') +
    `<button class="filter-add" type="button" title="Add filter" aria-label="Add filter">+</button>`;

  const active = bar.querySelector(`.filter-btn[data-filter="${prevActive}"]`)
              || bar.querySelector('.filter-btn[data-filter="all"]');
  active?.classList.add('is-active');
  refreshProjectFilter();
}

let filterBarWired = false;
function wireFilterBar() {
  const bar = document.querySelector('.filter-bar');
  if (!bar || filterBarWired) return;
  filterBarWired = true;

  bar.addEventListener('click', e => {
    if (e.target.closest('.filter-add')) { addFilter(); return; }
    const del = e.target.closest('.filter-del');
    if (del) { e.stopPropagation(); deleteFilter(del.dataset.id); return; }
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    const label = btn.querySelector('.filter-btn__label');
    if (label?.isContentEditable) return;   // mid-rename
    bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    refreshProjectFilter();
  });

  bar.addEventListener('dblclick', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn || btn.dataset.filter === 'all') return;
    if (!document.body.classList.contains('editor-active')) return;
    startRenameFilter(btn);
  });
}

function addFilter() {
  if (!document.body.classList.contains('editor-active')) return;
  const filters = loadFilters();
  const f = { id: genId(), label: 'New' };
  filters.push(f);
  saveFilters(filters);
  renderFilterBar();
  const btn = document.querySelector(`.filter-btn[data-filter="${f.id}"]`);
  if (btn) startRenameFilter(btn);
}

function deleteFilter(id) {
  if (!confirm('Delete this filter tag?')) return;
  saveFilters(loadFilters().filter(f => f.id !== id));
  renderFilterBar();
}

function renameFilter(id, label) {
  const filters = loadFilters();
  const f = filters.find(x => x.id === id);
  if (!f) return;
  f.label = label;
  saveFilters(filters);
}

function startRenameFilter(btn) {
  const label = btn.querySelector('.filter-btn__label');
  if (!label) return;
  label.contentEditable = 'true';
  label.focus();
  selectAllText(label);
  const finish = () => {
    label.contentEditable = 'false';
    const text = label.textContent.trim() || 'Untitled';
    label.textContent = text;
    renameFilter(btn.dataset.filter, text);
  };
  label.addEventListener('blur', finish, { once: true });
  label.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } });
}

// ─── Upload modal (multi-image / video carousel) ──────────────
async function openUploadModal(collection = '3d-projects', prefill = null) {
  const old = document.getElementById('editor-upload-modal');
  if (old) old.remove();

  const isAwards  = collection === 'awards';
  const singular  = isAwards ? 'Award' : 'Project';
  const modal = buildModal('editor-upload-modal', `${prefill ? 'Edit' : 'Add'} ${singular}`, true);
  const body  = modal.querySelector('.editor-modal__body');
  const p     = prefill || {};

  body.innerHTML = `
    <form class="editor-form" id="upload-form" novalidate>
      <div class="upload-dropzone" id="upload-dropzone">
        <span class="upload-dropzone__icon">⬆</span>
        <span class="upload-dropzone__label">Drop images or videos here, or click to browse</span>
        <span class="upload-dropzone__sub">Images &amp; videos become a carousel · .mp4 · .png · .jpg · .webp</span>
        <input type="file" id="upload-file-input" accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.mp4,.webm,.ogg,.ogv,.mov,.m4v" multiple style="display:none">
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
        ${isAwards ? '' : `
        <div class="editor-field">
          <label for="up-category">Category (your filter tags)</label>
          <select id="up-category">${categoryOptionsHTML(p.category)}</select>
        </div>`}
        <div class="editor-field">
          <label for="up-tags">Tags (comma-separated)</label>
          <input id="up-tags" type="text" value="${(p.tags||[]).join(', ')}">
        </div>
      </div>
      <div class="editor-btn-row">
        <button type="button" class="editor-btn editor-btn--ghost" id="upload-cancel">Cancel</button>
        <button type="submit" class="editor-btn editor-btn--primary">${prefill ? 'Save Changes' : 'Add ' + singular}</button>
      </div>
    </form>`;

  // Media working set: a list of image/video slides.
  //   slide: { fileName, kind, file? (new), fileId? (existing), url }
  let imageSlides = [];
  const removedExisting = [];   // fileIds of removed existing files, deleted on save

  for (const im of entryImages(p)) {
    const blob = await loadFile(im.fileId);
    imageSlides.push({
      fileId: im.fileId, fileName: im.fileName,
      kind: im.kind || mediaKind(im.fileName),
      url: blob ? URL.createObjectURL(blob) : '',
    });
  }

  const strip = document.getElementById('upload-media-strip');
  function renderStrip() {
    strip.innerHTML = '';
    imageSlides.forEach((s, i) => {
      const chip = document.createElement('div');
      chip.className = 'media-chip media-chip--img';
      const inner = s.kind === 'video'
        ? `<video src="${s.url}" muted preload="metadata"></video><span class="media-chip__badge">▶</span>`
        : `<img src="${s.url}" alt="">`;
      chip.innerHTML = `${inner}<button type="button" class="media-chip__x" aria-label="Remove">×</button>`;
      chip.querySelector('.media-chip__x').addEventListener('click', () => {
        if (s.fileId && !s.file) removedExisting.push(s.fileId);
        if (s.url && s.file) URL.revokeObjectURL(s.url);
        imageSlides.splice(i, 1); renderStrip();
      });
      strip.appendChild(chip);
    });
  }

  function addFiles(fileList) {
    const media = [...fileList].filter(f => isImageName(f.name) || isVideoName(f.name));
    if (!media.length) return;
    media.forEach(f => imageSlides.push({ file: f, fileName: f.name, kind: mediaKind(f.name), url: URL.createObjectURL(f) }));
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
    if (imageSlides.length === 0) { alert('Add at least one image or video.'); return; }

    const submit = e.target.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Saving…';

    try {
      const entry = {
        id:          p.id || genId(),
        title,
        description: document.getElementById('up-desc').value.trim(),
        category:    document.getElementById('up-category')?.value || '',
        year:        document.getElementById('up-year').value.trim(),
        tags:        document.getElementById('up-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      };

      const images = [];
      for (const s of imageSlides) {
        const kind = s.kind || mediaKind(s.fileName);
        if (s.file) { const fid = genId(); await saveFile(fid, s.file); images.push({ fileId: fid, fileName: s.fileName, kind }); }
        else images.push({ fileId: s.fileId, fileName: s.fileName, kind });
      }
      entry.type = 'image';
      entry.images = images;
      entry.fileName = images[0]?.fileName;

      for (const fid of removedExisting) await deleteFile(fid).catch(() => {});

      savePageEntry(collection, entry);
      closeModal(modal);

      document.querySelector(`.project-card[data-entry-id="${entry.id}"]`)?.remove();
      const gridId = isAwards ? 'award-grid' : 'project-grid';
      document.getElementById(gridId).prepend(await buildProjectCard(entry, collection));
      if (isAwards) document.querySelector('.awards-section')?.classList.add('has-cards');
      else refreshProjectFilter();
    } catch (err) {
      console.error('[upload] failed:', err);
      alert('Upload failed. A video may exceed your Supabase storage limit (free tier allows 50 MB per file). See the browser console for details.');
      submit.disabled = false;
      submit.textContent = prefill ? 'Save Changes' : 'Add ' + singular;
    }
  });

  renderStrip();
  openModal(modal);
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

function cvFileName(ext) {
  const name = (document.querySelector('[data-field="fullName"]')?.textContent || 'guanyu')
    .trim().toLowerCase().replace(/\s+/g, '-') || 'guanyu';
  return `${name}-cv.${ext}`;
}

// Render the whole CV to a canvas, hiding floating UI during the capture.
async function captureCVCanvas() {
  const hidden = ['.cv-actions', '.site-nav', '.editor-badge', '.editor-logout', '.editor-floatbar'];
  const restore = [];
  hidden.forEach(sel => document.querySelectorAll(sel).forEach(el => {
    restore.push([el, el.style.visibility]);
    el.style.visibility = 'hidden';
  }));
  try {
    const target = document.querySelector('.page-shell') || document.body;
    const bg = getComputedStyle(document.body).backgroundColor || '#16151A';
    return await html2canvas(target, { backgroundColor: bg, scale: 2, useCORS: true });
  } finally {
    restore.forEach(([el, v]) => { el.style.visibility = v; });
  }
}

async function exportCVAsPNG() {
  const btn = document.getElementById('cv-export-btn');
  if (typeof html2canvas !== 'function') {
    alert('Export library is still loading — please try again in a moment.');
    return;
  }
  if (btn) { btn.classList.add('is-busy'); btn.textContent = 'Rendering…'; }
  try {
    const canvas = await captureCVCanvas();
    const a = document.createElement('a');
    a.download = cvFileName('png');
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (err) {
    console.error(err);
    alert('Could not export the CV. See console for details.');
  } finally {
    if (btn) { btn.classList.remove('is-busy'); btn.textContent = 'Export PNG'; }
  }
}

async function exportCVAsPDF() {
  const btn = document.getElementById('cv-pdf-btn');
  const jsPDFCtor = window.jspdf?.jsPDF;
  if (typeof html2canvas !== 'function' || !jsPDFCtor) {
    alert('Export libraries are still loading — please try again in a moment.');
    return;
  }
  if (btn) { btn.classList.add('is-busy'); btn.textContent = 'Building…'; }
  try {
    const canvas = await captureCVCanvas();
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    // Scale the capture to A4 width and paginate down across A4 pages.
    const pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = canvas.height * (pageW / canvas.width);

    let position = 0;
    let heightLeft = imgH;
    pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(cvFileName('pdf'));
  } catch (err) {
    console.error(err);
    alert('Could not export the CV as PDF. See console for details.');
  } finally {
    if (btn) { btn.classList.remove('is-busy'); btn.textContent = 'Export PDF'; }
  }
}

function wireCV() {
  if (PAGE !== 'cv') return;

  // Save button
  document.getElementById('cv-save-btn')?.addEventListener('click', saveCV);

  // Export to PDF / PNG (available to everyone)
  document.getElementById('cv-pdf-btn')?.addEventListener('click', exportCVAsPDF);
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
    await renderCollection('awards', 'award-grid');
    if (document.querySelector('#award-grid .project-card'))
      document.querySelector('.awards-section')?.classList.add('has-cards');
    wireGridClicks('project-grid');
    wireGridClicks('award-grid');
    wireFilterBar();
    renderFilterBar();
  }

  if (PAGE === 'blog') {
    injectAddContentBtn();
    renderStoredPosts();
  }

  if (PAGE === 'cv') {
    loadCV();
    wireCV();
  }

  if (PAGE === 'intro') {
    // In editor mode, clicking the Enter button should edit its label, not navigate
    document.querySelector('.enter-btn')?.addEventListener('click', e => {
      if (document.body.classList.contains('editor-active')) e.preventDefault();
    });
  }

  // Tag editable text (page titles/descriptions, static cards) and apply
  // saved overrides for everyone; turn on editing if already logged in.
  initInlineText();
  if (isEditorActive()) activateEditorFull();
}

init();
