// js/store.js
// Unified data layer for the portfolio.
//
// When config.js holds real Supabase credentials, content (JSON) lives in a
// `site_content` table, binary files live in a public `media` storage bucket,
// and login uses Supabase Auth — so edits persist for everyone, across devices.
//
// When credentials are missing (placeholders), everything falls back to
// browser-only storage (localStorage + IndexedDB + sessionStorage) so the site
// still works before/without a backend.

import { SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_EMAIL } from './config.js';

const FALLBACK_PASSWORD = '123';                 // used only when no backend configured
const CONTENT_KEYS = ['gyu_cv', 'gyu_meta', 'gyu_text', 'gyu_cards'];
const SESSION_KEY  = 'gyu_editor';
const IDB_NAME     = 'gyu_files';
const IDB_STORE    = 'files';
const BUCKET       = 'media';

let sb         = null;
let configured = false;
let ready      = false;
let loggedIn   = false;
const cache    = {};
const authListeners = [];

export const isConfigured = () => configured;
export const isLoggedIn   = () => loggedIn;
export const onAuthChange = cb => { authListeners.push(cb); };
function notifyAuth() { authListeners.forEach(cb => { try { cb(loggedIn); } catch {} }); }

// ─── Init ────────────────────────────────────────────────────
export async function initStore() {
  if (ready) return;
  configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('YOUR_') && !SUPABASE_ANON_KEY.includes('YOUR_'));

  if (configured) {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      const { data: sess } = await sb.auth.getSession();
      loggedIn = !!sess.session;
      sb.auth.onAuthStateChange((_event, session) => {
        loggedIn = !!session;
        notifyAuth();
      });

      const { data: rows, error } = await sb.from('site_content').select('key,value');
      if (error) throw error;
      (rows || []).forEach(r => { cache[r.key] = r.value; });
      // mirror down for instant/offline reads
      CONTENT_KEYS.forEach(k => {
        if (k in cache) { try { localStorage.setItem(k, JSON.stringify(cache[k])); } catch {} }
      });
      await migrateLocalUp();
    } catch (err) {
      console.error('[store] Supabase unavailable — using local storage instead:', err);
      configured = false;
      sb = null;
    }
  }

  if (!configured) {
    loggedIn = sessionStorage.getItem(SESSION_KEY) === '1';
  }
  ready = true;
}

// One-time: if the cloud has no row for a key but this browser does, push it up.
async function migrateLocalUp() {
  for (const k of CONTENT_KEYS) {
    if (k in cache) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      cache[k] = value;
      await sb.from('site_content').upsert({ key: k, value, updated_at: new Date().toISOString() });
    } catch {}
  }
}

// ─── Content (JSON key/value) ────────────────────────────────
export function getContent(key, fallback = undefined) {
  if (key in cache) return cache[key];
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) { cache[key] = JSON.parse(raw); return cache[key]; }
  } catch {}
  return fallback;
}

export function setContent(key, value) {
  cache[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  if (configured && sb) {
    sb.from('site_content')
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.error('[store] save failed:', key, error); });
  }
}

// ─── Media (binary files) ────────────────────────────────────
export async function uploadMedia(id, blob) {
  if (configured && sb) {
    const { error } = await sb.storage.from(BUCKET).upload(id, blob, {
      upsert: true,
      contentType: blob.type || 'application/octet-stream',
    });
    if (error) { console.error('[store] upload failed:', id, error); throw error; }
    return;
  }
  return idbPut(id, blob);
}

export async function loadMedia(id) {
  if (configured && sb) {
    const { data } = sb.storage.from(BUCKET).getPublicUrl(id);
    try {
      // cache-bust so a freshly replaced file is fetched, not a stale cached copy
      const res = await fetch(data.publicUrl + '?v=' + Date.now());
      if (res.ok) return await res.blob();
    } catch (e) { console.error('[store] load failed:', id, e); }
    return null;
  }
  return idbGet(id);
}

export async function removeMedia(id) {
  if (configured && sb) {
    const { error } = await sb.storage.from(BUCKET).remove([id]);
    if (error) console.error('[store] remove failed:', id, error);
    return;
  }
  return idbDelete(id);
}

// ─── Auth ────────────────────────────────────────────────────
export async function signIn(password) {
  if (configured && sb) {
    const { error } = await sb.auth.signInWithPassword({ email: OWNER_EMAIL, password });
    if (error) return { ok: false, error };
    loggedIn = true;
    return { ok: true };
  }
  if (password === FALLBACK_PASSWORD) {
    loggedIn = true;
    sessionStorage.setItem(SESSION_KEY, '1');
    notifyAuth();
    return { ok: true };
  }
  return { ok: false };
}

export async function signOut() {
  if (configured && sb) { try { await sb.auth.signOut(); } catch {} }
  loggedIn = false;
  sessionStorage.removeItem(SESSION_KEY);
  notifyAuth();
}

// ─── IndexedDB fallback ──────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
async function idbPut(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ id, blob });
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}
async function idbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(id);
    req.onsuccess = e => resolve(e.result ? e.result.blob : null);
    req.onerror   = e => reject(e.target.error);
  });
}
async function idbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}
