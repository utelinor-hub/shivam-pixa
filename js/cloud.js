/* SHIVAM PIXA — Cloud Sync (Google Drive)
   ------------------------------------------------------------------
   v3.7.0 — optional, 100% background Google Drive sync.
   v3.8.0 — adopts photos that other apps upload straight into the
   "SHIVAM PIXA" Drive folder (e.g. an auto-upload app on the phone),
   so camera photos can reach every PC without touching PIXA.
   v3.9.0 — sign-in failures are now impossible to miss: the exact reason
   stays visible inside the Cloud dialog (the old toast vanished after a
   few seconds), cryptic Google error codes are translated into plain
   sentences with the fix, and a diagnostics block shows the site origin,
   the origin check and the client ID in use.
   v3.9.1 — the dialog now updates LIVE the moment the status changes
   (it kept showing a stale line while a failed popup sat behind the
   dialog), and a failed sign-in re-opens the dialog so the plain-language
   reason is on screen even on phones, where no hover tooltip exists.
   v3.10.1 — Google's "Access blocked (Error 403: access_denied)" page is
   now explained inside the app instead of a generic "window closed": the
   message tells the owner exactly where to add the account as a test user
   or to publish the app to Production (OAuth consent screen → Audience).

   How it works (design goals):
   • Sign in with Google → each user gets their own private folder
     "SHIVAM PIXA" inside their own Google Drive (15 GB free).
   • Everything runs in the background: editing never waits for the
     network. The sync queue yields between every step and pauses
     while the editor is open.
   • Editing a photo OVERWRITES the same Drive file (one photo stays
     one photo — no duplicate copies, last save wins).
   • Deleting a photo in PIXA also trashes it in Google Drive and on
     every other PC at the next pull.
   • Photos added on one PC appear on the other PCs at the next poll
     (every 25 s, on tab focus, and right after a push).
   • First sync downloads small thumbnails first — the grid appears
     fast. Full-size photos are fetched only when actually needed
     (edit / export / tray) and cached in IndexedDB after that.
   • Status chip (top right): red = sync off/error, spinning circle =
     syncing now, green = everything synced.

   UI language: English only (project rule). */

(() => {
  'use strict';
  const P = window.Pixsa;
  if (!P) return;
  const { state, toast, idbGet, idbSet, idbDel, idbGetAll, getFile, invalidateThumb,
          applyFilter, buildTree, setStatus, clamp } = P;

  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'SHIVAM PIXA';
  const MANIFEST_NAME = 'pixa-manifest.json';
  const POLL_MS = 25000;
  const GIS_SRC = 'https://accounts.google.com/gsi/client';

  /* Built-in OAuth Client ID (created by Shivam in Google Cloud Console for
     https://utelinor-hub.github.io). A browser-app Client ID is public by
     design — data safety comes from the authorized-origin list in the Google
     Cloud Console plus the user's own Google consent screen. */
  const DEFAULT_CLIENT_ID = '941573311970-4as3d63hd7kph89olmam7k725jinu22h.apps.googleusercontent.com';

  /* Origins authorized for the BUILT-IN Client ID in the Google Cloud Console.
     If the app runs anywhere else (localhost, a fork, a copied file), Google
     would bounce the whole page to an error screen the moment sign-in is
     attempted — so we simply refuse to start Google auth from there. */
  const DEFAULT_ALLOWED_ORIGINS = ['https://utelinor-hub.github.io'];

  function originAllowed() {
    if (!C.cfg || !C.cfg.clientId) return true;
    if (C.cfg.clientId !== DEFAULT_CLIENT_ID) return true; /* custom ID — owner manages their own origins */
    return DEFAULT_ALLOWED_ORIGINS.includes(location.origin);
  }

  /* ---------- tiny helpers ---------- */
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const editorOpen = () => !!(window.PixsaEditor && window.PixsaEditor.isOpen && window.PixsaEditor.isOpen());
  const nowIso = () => new Date().toISOString();

  /* ---------- module state ---------- */
  const C = {
    cfg: null,            // {clientId, email}
    token: null,
    tokenExp: 0,
    tc: null,             // GIS token client
    folderId: null,
    manifestId: null,
    remote: null,         // last known remote manifest
    status: 'off',        // off | setup | out | connecting | syncing | ok | err
    statusNote: '',
    timer: null,
    renewTimer: null,
    pushTimer: null,
    pushing: false,
    pulling: false,
    gisLoaded: false,
    enabled: false,
    everSignedIn: false,  // true only after a successful sign-in on this PC
    pendingAdopt: 0
  };

  const el = {
    chip: null, label: null,
    modal: null, clientId: null, email: null, line: null, diag: null,
    btnSaveId: null, btnSign: null, btnNow: null, btnOut: null, btnFree: null
  };

  /* ================= IndexedDB 'cloudblobs' store (full-size cache) ================= */
  async function blobGet(pid) { return idbGet('cloudblobs', pid); }
  async function blobSet(pid, blob) { try { await idbSet('cloudblobs', pid, blob); } catch (e) {} }
  async function blobDel(pid) { try { await idbDel('cloudblobs', pid); } catch (e) {} }

  /* ================= status chip ================= */
  function setStatus_(st, note) {
    C.status = st;
    C.statusNote = note || '';
    if (!el.chip) return;
    const dot = el.chip.querySelector('.cdot');
    el.chip.classList.remove('st-err', 'st-ok', 'st-run');
    let label = 'Cloud';
    if (st === 'setup') { label = 'Cloud setup'; el.chip.classList.add('st-err'); }
    else if (st === 'out') { label = 'Sign in'; el.chip.classList.add('st-err'); }
    else if (st === 'connecting') { label = 'Connecting'; el.chip.classList.add('st-run'); }
    else if (st === 'syncing') { label = 'Syncing'; el.chip.classList.add('st-run'); }
    else if (st === 'ok') { label = 'Synced'; el.chip.classList.add('st-ok'); }
    else if (st === 'err') { label = 'Sync off'; el.chip.classList.add('st-err'); }
    el.label.textContent = label;
    el.chip.title = 'Cloud sync (Google Drive) — ' + label + (C.statusNote ? ` — ${C.statusNote}` : '');
    /* v3.9.1: if the Cloud dialog is open, refresh its status line and the
       Sign-in diagnostics block at the same moment the status changes —
       previously the exact error only appeared after closing and reopening
       the dialog (and on phones there is no hover tooltip to fall back on) */
    if (el.modal && !el.modal.hidden && el.line) updModal();
  }

  /* ================= kv helpers for queues/links ================= */
  const cfgGet = async () => (await idbGet('kv', 'cloud.cfg')) || null;
  const cfgSet = (v) => idbSet('kv', 'cloud.cfg', v).catch(() => {});
  const linksGet = async () => (await idbGet('kv', 'cloud.links')) || {};
  const linksSet = (v) => idbSet('kv', 'cloud.links', v).catch(() => {});
  const delQGet = async () => (await idbGet('kv', 'cloud.delQ')) || [];
  const delQSet = (v) => idbSet('kv', 'cloud.delQ', v).catch(() => {});
  const dirtyGet = async () => (await idbGet('kv', 'cloud.dirty')) || [];
  const dirtySet = (v) => idbSet('kv', 'cloud.dirty', v).catch(() => {});
  const remoteSet = (m) => idbSet('kv', 'cloud.remote', m).catch(() => {});
  const sessGet = async () => (await idbGet('kv', 'cloud.session')) || null;
  const sessSet = (v) => idbSet('kv', 'cloud.session', v).catch(() => {});

  /* ================= Google Identity Services (lazy) ================= */
  function loadGis() {
    if (C.gisLoaded) return Promise.resolve();
    if (window.google && window.google.accounts) { C.gisLoaded = true; return Promise.resolve(); }
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => { C.gisLoaded = true; res(); };
      s.onerror = () => rej(new Error('Could not load Google sign-in (are you offline?)'));
      document.head.appendChild(s);
    });
  }

  async function ensureTokenClient() {
    if (!C.cfg || !C.cfg.clientId) throw new Error('Google Client ID is missing — open Cloud Sync setup');
    await loadGis();
    if (!C.tc) {
      C.tc = window.google.accounts.oauth2.initTokenClient({
        client_id: C.cfg.clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) {
            C.token = resp.access_token;
            C.tokenExp = Date.now() + Math.max(60, (Number(resp.expires_in) || 3600) - 90) * 1000;
            /* keep the session, so a reload never needs the Google window again */
            sessSet({ token: C.token, exp: C.tokenExp, email: (C.cfg && C.cfg.email) || '' });
          }
        },
        error_callback: () => { /* replaced per-call inside askToken */ }
      });
    }
    return C.tc;
  }

  async function askToken(promptMode) {
    const tc = await ensureTokenClient();
    return new Promise((resolve, reject) => {
      const origC = tc.callback, origE = tc.error_callback;
      const restore = () => { tc.callback = origC; try { tc.error_callback = origE; } catch (e) {} clearTimeout(timer); };
      const timer = setTimeout(() => { restore(); reject(new Error('Google sign-in timed out — press “Sign in with Google” again and complete the window')); }, 120000);
      tc.callback = (resp) => {
        restore();
        if (resp && resp.access_token) resolve(resp.access_token);
        else if (resp && resp.error) reject(new Error(oauthErrText(resp.error)));
        else reject(new Error('Sign-in was cancelled'));
      };
      tc.error_callback = (err) => {
        restore();
        reject(new Error(gisErrText(err)));
      };
      try { tc.requestAccessToken({ prompt: promptMode || '' }); }
      catch (e) { restore(); reject(e); }
    });
  }

  /* v3.9.0: translate cryptic GIS error types into plain sentences with the
     actual fix — previously the user only saw codes like “popup_closed” */
  function gisErrText(err) {
    const type = (err && err.type) || '';
    const map = {
      popup_failed_to_open: 'The Google window could not open — allow pop-ups for this site, then press “Sign in with Google” again',
      popup_closed: 'The Google window closed before sign-in finished — allow pop-ups and try again. If the window showed “Access blocked” (Error 403), the app is in Testing mode: open console.cloud.google.com → APIs & Services → OAuth consent screen → Audience and add this Google account under “Test users” (or publish the app to Production)',
      popup_closed_by_user: 'Sign-in was cancelled — the Google window was closed before it finished',
      popup_closed_by_click_away: 'The Google window closed when you clicked elsewhere — press “Sign in with Google” and complete the window',
      access_denied: 'Google blocked this account (“Access blocked — Error 403: access_denied”). The app is in Testing mode, so only pre-approved accounts may sign in. Fix: open console.cloud.google.com → APIs & Services → OAuth consent screen (Google Auth Platform) → Audience, then either add this Google account under “Test users”, or set Publishing status to “In production” — then sign in again.',
      startup_failed: 'Google sign-in could not start (browser or network issue) — reload the page and try again'
    };
    if (type && map[type]) return map[type];
    return (err && (err.message || err.type)) || 'The Google window was closed or blocked';
  }

  /* v3.10.1: OAuth-level error codes that arrive through the token callback
     (the popup redirected back with ?error=…). “access_denied” here means
     the Google 403 testing-mode block page was shown; map the common codes
     to their actual fixes instead of surfacing the raw code. */
  function oauthErrText(code) {
    const map = {
      access_denied: gisErrText({ type: 'access_denied' }),
      admin_policy_enforced: 'Your Google Workspace administrator does not allow signing in to this app — use a personal @gmail.com account',
      invalid_client: 'The Client ID saved in Cloud Sync is wrong — paste it again and press Save',
      unauthorized_client: 'This Client ID is not allowed for this site — in Google Cloud Console → Credentials, add “https://utelinor-hub.github.io/shivam-pixa” under Authorized JavaScript origins',
      redirect_uri_mismatch: 'This site is not in the Client ID\u2019s Authorized JavaScript origins — fix it in Google Cloud Console → Credentials',
      org_internal: 'This Client ID only allows accounts inside its organization — create a new OAuth Client ID with User type “External”'
    };
    return map[code] || ('Google sign-in failed (' + code + ') — try again, and if it repeats open the Cloud dialog diagnostics');
  }

  const hasToken = () => !!(C.token && Date.now() < C.tokenExp);

  /* Silent token renewal — ONLY for PCs that signed in successfully before.
     A successful sign-in proves this origin is authorized in the Google Cloud
     Console, so the silent (prompt 'none') flow can never bounce the app out
     to a Google error page. First-time sign-in always needs a user click. */
  async function silentRenew() {
    if (!C.cfg || !C.everSignedIn || !originAllowed()) return null;
    try { return await askToken('none'); } catch (e) { return null; }
  }

  async function authFetch(url, opts = {}, retry = true) {
    if (!hasToken()) {
      const t = await silentRenew();
      if (!t) throw new Error('Google session expired — open the cloud chip and press “Sign in with Google”');
    }
    opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + C.token });
    let r;
    try { r = await fetch(url, opts); }
    catch (e) { throw new Error('Network error — check the internet connection'); }
    if (r.status === 401 && retry) {
      C.token = null;
      try { await askToken('none'); return authFetch(url, opts, false); } catch (e) { /* fall through */ }
    }
    return r;
  }

  /* ================= Drive primitives ================= */
  async function findFolder() {
    const q = encodeURIComponent(`name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents`);
    const r = await authFetch(`${DRIVE}/files?q=${q}&fields=files(id,name)&pageSize=5`);
    if (!r.ok) throw new Error('Drive search failed (' + r.status + ')');
    const j = await r.json();
    if (j.files && j.files.length) return j.files[0].id;
    const cr = await authFetch(`${DRIVE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!cr.ok) throw new Error('Could not create the Drive folder (' + cr.status + ')');
    return (await cr.json()).id;
  }

  async function findManifest() {
    const q = encodeURIComponent(`name = '${MANIFEST_NAME}' and trashed = false and '${C.folderId}' in parents`);
    const r = await authFetch(`${DRIVE}/files?q=${q}&fields=files(id)&pageSize=5`);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.files && j.files.length) ? j.files[0].id : null;
  }

  function multipartBody(meta, blob) {
    const boundary = 'pixabnd' + Math.random().toString(36).slice(2);
    const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
    return new Blob([pre, blob, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` });
  }

  async function uploadNew(blob, name, appProps) {
    const body = multipartBody({ name, parents: [C.folderId], appProperties: appProps || {} }, blob);
    const r = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=pixabnd' }, body });
    if (!r.ok) throw new Error('Upload failed (' + r.status + ')');
    return (await r.json()).id;
  }

  async function updateMedia(fileId, blob) {
    const r = await authFetch(`${UPLOAD}/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    if (!r.ok) throw new Error('Update failed (' + r.status + ')');
    return true;
  }

  async function trashFiles(ids) {
    for (const id of ids) {
      if (!id) continue;
      try { await authFetch(`${DRIVE}/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); } catch (e) {}
    }
  }

  /* ================= manifest (pull / push / merge) ================= */
  const emptyManifest = () => ({ rev: 0, updated: nowIso(), settings: {}, photos: [] });

  async function pullManifest() {
    if (!C.manifestId) return null;
    const r = await authFetch(`${DRIVE}/files/${C.manifestId}?alt=media`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Could not read sync data (' + r.status + ')');
    const txt = await r.text();
    try { return JSON.parse(txt); } catch (e) { return null; }
  }

  async function pushManifest(m) {
    m.updated = nowIso();
    const body = multipartBody({ name: MANIFEST_NAME, parents: [C.folderId] }, new Blob([JSON.stringify(m)], { type: 'application/json' }));
    if (C.manifestId) {
      const r = await authFetch(`${UPLOAD}/files/${C.manifestId}?uploadType=multipart&fields=id`, { method: 'PATCH', body });
      if (!r.ok) throw new Error('Could not save sync data (' + r.status + ')');
    } else {
      const r = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body });
      if (!r.ok) throw new Error('Could not save sync data (' + r.status + ')');
      C.manifestId = (await r.json()).id;
    }
    C.remote = m;
    await remoteSet(m);
  }

  /* thumbnails for the grid are made from the small Drive thumb file,
     so the first sync stays fast even with hundreds of photos */
  async function makeThumbBlob(blob) {
    let src;
    try { src = await createImageBitmap(blob); } catch (e) { return null; }
    const MAX = 640;
    const sc = Math.min(1, MAX / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * sc));
    c.height = Math.max(1, Math.round(src.height * sc));
    const cx = c.getContext('2d');
    cx.drawImage(src, 0, 0, c.width, c.height);
    if (src.close) src.close();
    cx.globalCompositeOperation = 'destination-over';
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = 'source-over';
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.75));
  }

  /* ================= photo blobs (used by grid / editor / export) ================= */
  async function getBlob(pid, thumbOk) {
    let b = await blobGet(pid);
    if (b) return b;
    const e = C.remote && C.remote.photos.find((x) => x.pid === pid);
    if (!e) throw new Error('Photo not found in sync data');
    if (thumbOk && e.thumbId) {
      try {
        const r = await authFetch(`${DRIVE}/files/${e.thumbId}?alt=media`);
        if (r.ok) {
          const tb = await r.blob();
          await blobSet(pid, tb);
          return tb;
        }
      } catch (err) { /* fall through to full file */ }
    }
    const r2 = await authFetch(`${DRIVE}/files/${e.fileId}?alt=media`);
    if (!r2.ok) throw new Error('Could not download the photo (' + r2.status + ')');
    const fb = await r2.blob();
    await blobSet(pid, fb);
    return fb;
  }

  /* ================= merge remote → local grid ================= */
  const linkKey = (p) => `${p.folder || ''}//${p.name}`;

  function removeLocalCloudPhoto(p) {
    const i = state.photos.indexOf(p);
    if (i >= 0) state.photos.splice(i, 1);
    invalidateThumb(p);
    blobDel(p.cloud && p.cloud.pid);
  }

  async function applyRemote(m, { silent } = {}) {
    if (!m) return false;
    C.remote = m;
    await remoteSet(m);
    const byPid = new Map();
    const byLink = new Map();
    state.photos.forEach((p) => {
      if (p.cloud) byPid.set(p.cloud.pid, p);
      else byLink.set(linkKey(p), p);
    });
    let changed = false;
    const keep = [];
    const seen = new Set();
    for (const e of m.photos) {
      if (e.deleted) {
        const lp = byPid.get(e.pid);
        if (lp) { removeLocalCloudPhoto(lp); byPid.delete(e.pid); changed = true; }
        continue;
      }
      seen.add(e.pid);
      const lp = byPid.get(e.pid);
      if (lp) {
        if ((e.updated || '') > (lp.cloud.updated || '')) {
          /* a newer edit exists on another PC — refresh this PC's copy */
          lp.size = e.size; lp.lastModified = e.lastModified;
          lp.cloud.fileId = e.fileId; lp.cloud.thumbId = e.thumbId; lp.cloud.updated = e.updated;
          lp.cloud.dirty = false;
          invalidateThumb(lp);
          await blobDel(e.pid);
          changed = true;
        }
        keep.push(lp);
        byPid.delete(e.pid);
        continue;
      }
      const lk = byLink.get(`${e.folder || ''}//${e.name}`);
      if (lk) {
        /* the same local photo already exists here — link it instead of duplicating */
        lk.cloud = { pid: e.pid, fileId: e.fileId, thumbId: e.thumbId, updated: e.updated };
        const links = await linksGet(); links[linkKey(lk)] = e.pid; await linksSet(links);
        keep.push(lk); byLink.delete(`${e.folder || ''}//${e.name}`);
        changed = true;
        continue;
      }
      keep.push({
        name: e.name, size: e.size, lastModified: e.lastModified,
        handle: null, file: null, folder: e.folder || 'Google Drive',
        cloud: { pid: e.pid, fileId: e.fileId, thumbId: e.thumbId, updated: e.updated }
      });
      changed = true;
    }
    /* entries that vanished from the remote manifest were deleted on another PC */
    for (const [, lp] of byPid) { removeLocalCloudPhoto(lp); changed = true; }
    if (changed) {
      /* local photos first, then cloud-only photos (grid sorts them anyway) */
      const locals = state.photos.filter((p) => !p.cloud);
      state.photos = locals.concat(keep.filter((p) => p.cloud));
      buildTree(); applyFilter();
      if (!silent) toast('Cloud photos updated', 'ok', 2500);
    }
    /* settings (sort / zoom) follow the newest save */
    if (m.settings && m.settings.updated) applyRemoteSettings(m.settings);
    return changed;
  }

  function applyRemoteSettings(s) {
    try {
      if (s.sort && s.sort !== state.sort) {
        state.sort = s.sort;
        localStorage.setItem('pixsa.sort', s.sort);
        const sel = document.getElementById('sort');
        if (sel) sel.value = s.sort;
        applyFilter();
      }
      if (s.zoom) {
        const z = document.getElementById('zoom');
        if (z && String(s.zoom) !== z.value) { z.value = s.zoom; z.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    } catch (e) {}
  }

  function settingsChanged() {
    if (!C.enabled || !C.remote) return;
    C.remote.settings = {
      sort: state.sort,
      zoom: Number((document.getElementById('zoom') || {}).value) || undefined,
      updated: nowIso()
    };
    schedulePush(2500);
  }

  /* ================= adopt photos uploaded straight into the Drive folder =================
     v3.8.0 — the phone story: any app that auto-uploads camera photos into
     the "SHIVAM PIXA" Drive folder (Autosync, FolderSync, PhotoSync, …)
     is picked up here. The manifest only knows photos pushed by PIXA
     itself, so at every pull the folder is listed and image files PIXA
     did not file yet are adopted into the library (and into the manifest,
     so every other PC sees them at the next poll). */
  const ADOPT_IMG = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  async function adoptExternal(m) {
    if (!C.folderId || C.pushing || !m || !m.photos) return 0;
    const q = encodeURIComponent(`'${C.folderId}' in parents and trashed = false and mimeType contains 'image/'`);
    const r = await authFetch(`${DRIVE}/files?q=${q}&fields=files(id,name,mimeType,size,createdTime,appProperties)&pageSize=1000`);
    if (!r.ok) return 0;
    const j = await r.json();
    if (!j.files || !j.files.length) return 0;
    const known = new Set();
    m.photos.forEach((e) => { known.add(e.fileId); if (e.thumbId) known.add(e.thumbId); });
    const fresh = j.files.filter((f) =>
      f.id && !known.has(f.id) &&
      ADOPT_IMG.test(f.name || '') &&
      !/\.thumb\.jpe?g$/i.test(f.name || '') &&
      !(f.appProperties && f.appProperties.pixa)
    );
    if (!fresh.length) return 0;
    for (const f of fresh) {
      m.photos.push({
        pid: uuid(),
        name: f.name,
        folder: 'Phone & other uploads',
        type: f.mimeType || 'image/jpeg',
        size: Number(f.size) || 0,
        lastModified: Date.parse(f.createdTime) || Date.now(),
        fileId: f.id,
        thumbId: null,
        updated: f.createdTime || nowIso(),
        deleted: false,
        adopted: true
      });
    }
    m.rev = Date.now();
    await pushManifest(m);
    await applyRemote(m, { silent: true });
    return fresh.length;
  }

  /* ================= upload queue (background, zero-lag) ================= */
  function schedulePush(ms) {
    if (!C.enabled) return;
    clearTimeout(C.pushTimer);
    C.pushTimer = setTimeout(() => { pushCycle().catch((e) => setStatus_('err', e.message)); }, ms || 3000);
  }

  async function waitForIdleEditor() {
    let guard = 0;
    while (editorOpen() && guard < 200) { await sleep(1500); guard++; }
  }

  async function pushCycle() {
    if (!C.enabled || C.pushing || !hasToken()) return;
    C.pushing = true;
    try {
      await waitForIdleEditor();
      if (editorOpen()) { C.pushing = false; schedulePush(8000); return; }
      setStatus_('syncing');
      C.folderId = C.folderId || await findFolder();
      C.manifestId = C.manifestId || await findManifest();
      const m = (await pullManifest()) || emptyManifest();
      if (m.rev && C.remote && m.rev > C.remote.rev) await applyRemote(m, { silent: true });
      C.remote = m;
      const entries = new Map(m.photos.map((e) => [e.pid, e]));
      const links = await linksGet();

      /* 1 — deletions made in PIXA (offline-safe queue) */
      const delQ = await delQGet();
      if (delQ.length) {
        for (const pid of delQ) {
          const e = entries.get(pid);
          if (e && !e.deleted) { e.deleted = true; e.updated = nowIso(); trashFiles([e.fileId, e.thumbId]); }
          entries.delete(pid);
        }
        await delQSet([]);
      }

      /* 2 — re-uploads of photos edited on this PC */
      let dirty = await dirtyGet();
      if (dirty.length) {
        for (const pid of dirty) {
          const e = entries.get(pid);
          const b = await blobGet(pid);
          if (e && b) {
            await updateMedia(e.fileId, b);
            const tb = await makeThumbBlob(b);
            if (tb) {
              if (e.thumbId) { try { await updateMedia(e.thumbId, tb); } catch (er) { e.thumbId = await uploadNew(tb, `${e.name}.thumb.jpg`, { pixa: 'thumb' }); } }
              else e.thumbId = await uploadNew(tb, `${e.name}.thumb.jpg`, { pixa: 'thumb' });
            }
            const lp = state.photos.find((x) => x.cloud && x.cloud.pid === pid);
            if (lp) { e.size = lp.size; e.lastModified = lp.lastModified; } else { e.size = b.size; }
            e.updated = nowIso();
            if (lp && lp.cloud) { lp.cloud.updated = e.updated; lp.cloud.dirty = false; }
          }
          await sleep(30);
        }
        dirty = []; await dirtySet([]);
      }

      /* 3 — new local photos → upload (one by one, editor pauses the queue) */
      let upCount = 0;
      for (const p of state.photos.slice()) {
        if (p.cloud) continue;
        if (editorOpen()) break;
        if (!hasToken()) break;
        const key = linkKey(p);
        if (links[key]) continue;
        const twin = [...entries.values()].find((e) => !e.deleted && (e.folder || '') === (p.folder || '') && e.name === p.name);
        let pid;
        if (twin) { pid = twin.pid; }
        else {
          pid = uuid();
          const f = await getFile(p);
          const fileId = await uploadNew(f, p.name, { pixa: 'photo' });
          const tb = await makeThumbBlob(f);
          const thumbId = tb ? await uploadNew(tb, `${p.name}.thumb.jpg`, { pixa: 'thumb' }) : null;
          entries.set(pid, {
            pid, name: p.name, folder: p.folder || '', type: f.type || 'image/jpeg',
            size: f.size, lastModified: p.lastModified || Date.now(),
            fileId, thumbId, updated: nowIso(), deleted: false
          });
          upCount++;
          if (upCount % 20 === 0) toast(`Uploading — ${upCount} done`, 'ok', 2500);
          await sleep(30);
        }
        p.cloud = { pid, fileId: (entries.get(pid) || {}).fileId, thumbId: (entries.get(pid) || {}).thumbId, updated: (entries.get(pid) || {}).updated };
        links[key] = pid;
        await linksSet(links);
      }

      /* 4 — write the manifest back */
      m.rev = Date.now();
      m.photos = [...entries.values()];
      if (!m.settings) m.settings = {};
      if (state.sort) m.settings.sort = state.sort;
      await pushManifest(m);
      setStatus_('ok');
      if (upCount) toast(`${upCount} photo${upCount > 1 ? 's' : ''} backed up to Google Drive`, 'ok', 4000);
    } catch (e) {
      setStatus_('err', e.message);
      schedulePush(60000); /* try again quietly */
    } finally {
      C.pushing = false;
    }
  }

  /* ================= pull cycle (see new photos from other PCs) ================= */
  async function pullCycle({ manual } = {}) {
    if (!C.enabled || C.pulling || !hasToken()) return;
    C.pulling = true;
    try {
      setStatus_('syncing');
      C.folderId = C.folderId || await findFolder();
      C.manifestId = C.manifestId || await findManifest();
      let m = await pullManifest();
      if (!m) {
        /* no manifest yet — still pick up photos other apps dropped in the folder */
        let adopted0 = 0;
        try { adopted0 = await adoptExternal(emptyManifest()); } catch (e) { /* non-fatal */ }
        if (adopted0) toast(`${adopted0} photo${adopted0 > 1 ? 's' : ''} arrived from the phone`, 'ok', 4500);
        if (manual) { await pushCycle(); } else setStatus_('ok');
        return;
      }
      const changed = await applyRemote(m, { silent: !manual });
      /* v3.8.0: adopt photos that other apps uploaded straight into the
         Drive folder (e.g. an auto-upload app on the phone) */
      let adopted = 0;
      try { adopted = await adoptExternal(m); } catch (e) { /* non-fatal */ }
      if (adopted) toast(`${adopted} photo${adopted > 1 ? 's' : ''} arrived from the phone`, 'ok', 4500);
      const mine = await linksGet();
      const haveLocalNew = state.photos.some((p) => !p.cloud && !mine[linkKey(p)]);
      if (haveLocalNew) schedulePush(1500);
      else setStatus_('ok');
      if (manual && !changed) toast('Everything is already in sync', 'ok', 2500);
    } catch (e) {
      setStatus_('err', e.message);
      if (manual) toast('Sync failed: ' + e.message, 'err', 6000);
    } finally {
      C.pulling = false;
    }
  }

  function startPolling() {
    clearInterval(C.timer);
    C.timer = setInterval(() => {
      if (document.hidden || !C.enabled || !hasToken()) return;
      pullCycle().catch(() => {});
    }, POLL_MS);
  }

  /* refresh the Google token before it expires so background sync never stops */
  function startRenewTimer() {
    clearInterval(C.renewTimer);
    C.renewTimer = setInterval(async () => {
      if (!C.enabled || document.hidden || !C.token) return;
      if (Date.now() < C.tokenExp - 15 * 60000) return;
      const t = await silentRenew();
      if (t) setStatus_('ok');
    }, 10 * 60000);
  }

  /* ================= public API (used by index.html / editor.js) ================= */
  const API = {
    get enabled() { return C.enabled; },
    get status() { return C.status; },
    has: (p) => !!(p && p.cloud && p.cloud.pid),

    async getBlob(pid, thumbOk) { return getBlob(pid, thumbOk); },

    /* local photos were imported → back them up in the background */
    onLibraryChanged() {
      if (!C.enabled || !hasToken()) return;
      schedulePush(2500);
    },

    /* an edited photo was saved locally → overwrite the SAME Drive file */
    async onPhotoSaved(p, blob) {
      if (!p || !p.cloud || !C.enabled) return false;
      p.cloud.dirty = true;
      await blobSet(p.cloud.pid, blob);
      const d = await dirtyGet();
      if (!d.includes(p.cloud.pid)) d.push(p.cloud.pid);
      await dirtySet(d);
      schedulePush(2500);
      return true;
    },

    /* photo deleted in PIXA → also delete in Drive + on other PCs */
    async removePhotos(photos) {
      const pids = [];
      for (const p of photos) {
        if (p && p.cloud && p.cloud.pid) {
          pids.push(p.cloud.pid);
          await blobDel(p.cloud.pid);
        }
      }
      if (!pids.length) return false;
      const q = await delQGet();
      q.push(...pids);
      await delQSet(q);
      schedulePush(2500);
      return true;
    },

    settingsChanged,

    /* open the setup / status dialog (used by the File menu) */
    openSetup: openModal
  };
  window.PixsaCloud = API;

  /* ================= sign in / out ================= */
  /* fresh sign-in = fresh cloud state: drop the links/queues left by the
     previous Google account, so a family member signing in on the same PC
     always starts clean and never touches the other account's Drive files */
  async function resetCloudLinkState() {
    C.folderId = null; C.manifestId = null; C.remote = null;
    await linksSet({}); await dirtySet([]); await delQSet([]);
    let changed = false;
    for (const p of state.photos.slice()) {
      if (p.cloud && (p.handle || p.file)) { delete p.cloud; changed = true; }
    }
    if (changed) { buildTree(); applyFilter(); }
  }

  async function signIn(mode) {
    try {
      if (!C.cfg || !C.cfg.clientId) { openModal(); toast('Client ID missing — paste it in Cloud Sync', 'err', 6000); return; }
      if (!originAllowed()) {
        /* guard: starting Google auth from a non-authorized origin can navigate
           this page away to a Google error screen (popup-blocked fallback) */
        setStatus_('out', 'Sign-in works on the official app site');
        toast('Sign-in works only on the official app site: https://utelinor-hub.github.io/shivam-pixa/', 'err', 8000);
        updModal();
        return;
      }
      setStatus_('connecting');
      await askToken(mode);
      const info = await authFetch(`${DRIVE}/about?fields=user`).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (info && info.user && info.user.emailAddress) { C.cfg.email = info.user.emailAddress; await cfgSet(C.cfg); }
      C.everSignedIn = true;
      C.enabled = true;
      sessSet({ token: C.token, exp: C.tokenExp, email: (C.cfg && C.cfg.email) || '' });
      await resetCloudLinkState();
      setStatus_('syncing');
      startPolling(); startRenewTimer();
      await pullCycle({ manual: false });
      schedulePush(2000);
      toast(`Signed in as ${C.cfg.email || 'Google account'}`, 'ok', 3500);
      updModal();
    } catch (e) {
      setStatus_('out', e.message);
      /* v3.9.1: surface the failure right where the user pressed the button —
         open the Cloud dialog so the plain-language reason (pop-up blocked,
         wrong account, offline…) is on screen, not just a 7-second toast */
      openModal();
      toast('Sign-in failed: ' + e.message, 'err', 7000);
    }
  }

  function signOut() {
    try { if (C.token && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(C.token, () => {}); } catch (e) {}
    C.token = null; C.enabled = false; C.everSignedIn = false;
    clearInterval(C.timer); clearInterval(C.renewTimer); clearTimeout(C.pushTimer);
    sessSet(null);
    C.folderId = null; C.manifestId = null; C.remote = null;
    /* remove cloud-only photos from the grid (local disk photos stay) */
    const gone = state.photos.filter((p) => p.cloud && !p.handle && !p.file);
    state.photos = state.photos.filter((p) => !(p.cloud && !p.handle && !p.file));
    gone.forEach(invalidateThumb);
    buildTree(); applyFilter();
    if (C.cfg && C.cfg.email) { C.cfg.email = ''; }
    cfgSet(C.cfg);
    setStatus_('out', 'Signed out');
    toast('Signed out', 'ok', 2500);
    updModal();
  }

  /* ================= modal UI ================= */
  function openModal() {
    if (!el.modal) return;
    updModal();
    el.modal.hidden = false;
  }
  function closeModal() { if (el.modal) el.modal.hidden = true; }

  function updModal() {
    if (!el.modal) return;
    el.clientId.value = (C.cfg && C.cfg.clientId) || '';
    el.email.textContent = (C.cfg && C.cfg.email) ? `Signed in as ${C.cfg.email}` : 'Not signed in';
    el.btnSign.disabled = !(C.cfg && C.cfg.clientId);
    el.btnNow.disabled = !C.enabled;
    el.btnOut.disabled = !C.enabled;
    const stTxt = { off: 'Cloud sync is off', setup: 'Paste your Client ID', out: 'Signed out',
      connecting: 'Connecting…', syncing: 'Syncing…', ok: 'Everything is synced', err: 'Will retry automatically' };
    /* v3.9.0: keep the exact error visible inside the dialog — the old code
       dropped C.statusNote here, so failures showed only a 7-second toast */
    el.line.textContent = (stTxt[C.status] || '') + (C.statusNote ? ` — ${C.statusNote}` : '');
    if (el.diag) {
      const allowed = originAllowed();
      const cid = (C.cfg && C.cfg.clientId) || '';
      el.diag.textContent =
        `Site: ${location.origin}\n` +
        `Origin check: ${allowed ? 'allowed ✓' : 'NOT allowed ✗ — sign-in only works on the official site'}\n` +
        `Client ID: ${cid ? cid.slice(0, 14) + '…' + cid.slice(-8) : 'missing'}\n` +
        (C.statusNote ? `Note: ${C.statusNote}` : 'No errors recorded');
    }
  }

  function wireUI() {
    el.chip = document.getElementById('cloudChip');
    el.label = document.getElementById('cloudLabel');
    el.modal = document.getElementById('cloud');
    if (!el.chip || !el.modal) return;
    el.clientId = document.getElementById('cloudClientId');
    el.email = document.getElementById('cloudEmail');
    el.line = document.getElementById('cloudLine');
    el.diag = document.getElementById('cloudDiag');
    el.btnSaveId = document.getElementById('cloudSaveId');
    el.btnSign = document.getElementById('cloudSignIn');
    el.btnNow = document.getElementById('cloudSyncNow');
    el.btnOut = document.getElementById('cloudSignOut');

    el.chip.addEventListener('click', openModal);
    document.getElementById('cloudClose').addEventListener('click', closeModal);
    el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.modal.hidden) closeModal(); });

    el.btnSaveId.addEventListener('click', async () => {
      const v = el.clientId.value.trim();
      if (!v || !v.endsWith('.apps.googleusercontent.com')) { toast('Not a valid Client ID (it ends with .apps.googleusercontent.com)', 'err', 6000); return; }
      C.cfg = C.cfg || {};
      C.cfg.clientId = v;
      await cfgSet(C.cfg);
      C.tc = null;
      toast('Client ID saved', 'ok', 2500);
      updModal();
    });
    el.btnSign.addEventListener('click', () => signIn('consent select_account'));
    el.btnNow.addEventListener('click', () => { if (hasToken()) { pullCycle({ manual: true }); } else signIn(''); });
    el.btnOut.addEventListener('click', signOut);
  }

  /* ================= boot ================= */
  async function init() {
    wireUI();
    C.cfg = await cfgGet();
    if (!C.cfg) C.cfg = {};
    /* the Client ID ships with the app — no manual paste needed anymore */
    if (!C.cfg.clientId) { C.cfg.clientId = DEFAULT_CLIENT_ID; await cfgSet(C.cfg); }
    C.enabled = true;
    /* fast path: a still-valid session saved by the last sign-in on this PC.
       NO Google window, NO network auth at boot — safe on every origin. */
    const s = await sessGet();
    if (s && s.token && s.exp && Date.now() < s.exp - 60000) {
      C.token = s.token; C.tokenExp = s.exp;
      if (s.email) C.cfg.email = s.email;
      C.everSignedIn = true;
      setStatus_('syncing', 'Restoring your library…');
      startPolling(); startRenewTimer();
      pullCycle({ manual: false }).catch(() => {});
      schedulePush(4000);
      return;
    }
    if (!navigator.onLine) { setStatus_('err', 'No internet — will retry'); return; }
    /* never fire Google auth without a user gesture: on an unauthorized
       origin that would bounce the whole app to a Google error page.
       The chip shows “Sign in” instead — one click and it connects. */
    setStatus_('out', 'Sign in to start syncing');
  }

  /* faster visibility: when the user comes back to the tab, pull at once */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && C.enabled && hasToken()) pullCycle().catch(() => {});
  });
  window.addEventListener('online', () => {
    if (!C.enabled) return;
    /* v3.7.0 fix: never leave the chip stuck on “Syncing” when nobody is
       signed in — go back to the red “Sign in” state instead */
    if (!hasToken()) { setStatus_('out', 'Sign in to start syncing'); return; }
    setStatus_('syncing');
    pullCycle().catch(() => {});
    schedulePush(2000);
  });
  window.addEventListener('offline', () => setStatus_('err', 'No internet'));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
