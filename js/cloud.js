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
   v3.14.1 — the "login completes but the chip goes red" case is diagnosed
   in-app now: a broken Cloud project (Drive API switched off, blocked
   origin) is caught the moment you sign in, the Cloud dialog shows the
   exact reason in plain English, and a one-click "Enable Drive API" button
   opens the right Google Cloud Console page. Every failed Drive response
   is translated (rate limit, permission, session expired, Google outage).
   v3.27.0 — TRUE TWO-PC LIVE SYNC. Fixes for "doosre PC me sync nahi aata":
   • One unreadable / unuploadable photo used to KILL the whole upload
     cycle (the manifest was only written at the very end) — so nothing
     (new photos, edits, deletions) ever reached the other PC. Every photo
     is tried independently now; failures retry at the next cycle while
     everything else still syncs.
   • The manifest is re-pulled and MERGED right before it is written, so a
     slow upload on this PC can no longer roll back what the other PC just
     pushed (new photos + deletions survive).
   • Poll 25 s → 12 s + pull on window focus, and arrivals now SHOW:
     "Cloud sync — 2 new, 1 updated from your other PC".
   • Renames / folder changes made inside PIXA follow the manifest
     (photos that live on the other PC's disk keep their local name).
   v3.29.0 — WHY THE OTHER PC STILL SHOWED THE OLD PHOTO, fixed:
   • THE display bug: a photo imported from a folder on BOTH PCs kept
     showing its own DISK bytes on the second PC even after the first PC
     edited and uploaded it — the grid re-read the stale disk file every
     time, so sync "worked" but nothing ever LOOKED synced. Such photos
     now carry a remoteEdit flag and read from the cloud copy until this
     PC saves its own edit (getFile honours it via PixsaCloud.prefersCloud).
   • Sessions died overnight: the Google token lasts ~1 h and the renew
     timer only ran while the window was visible. Now the poll itself
     silently renews an expired session, the renew timer runs even
     backgrounded, and a PC reopened the next morning reconnects without
     any click (boot-time silent renew for PCs that signed in before).
   • An open editor used to PAUSE all uploads indefinitely — with the
     editor (the normal way to work) open on both PCs nothing was ever
     backed up. Uploads now yield a moment and continue in background.
   • Timestamps now come from GOOGLE's server clock (createdTime /
     modifiedTime) instead of each PC's own clock — two PCs with slightly
     different clock settings can no longer miss each other's edits.
   • The Cloud dialog now shows a Two-PC sync block: this PC's version,
     last sync time, photos in cloud, waiting-to-upload count and a
     Check-for-Updates button — because the #1 real-world cause remains
     one PC still running an older version.
   v3.30.1 — PIXA SHARE (the phone app): photos sent from the
     phone arrive here automatically at ORIGINAL quality. The phone
     uploads into the same "SHIVAM PIXA" Drive folder tagging files with
     appProperties pixa:'share' (+ a small `${name}.thumb.jpg` preview);
     adoption now accepts those tags, files them under the "PIXA SHARE"
     group, matches the preview to its full photo (fast grid) and the
     arrival toast says "received from PIXA SHARE". A phone heartbeat
     file (pixa-share-mobile.json) lets the Cloud dialog warn the minute
     the phone is signed in with a DIFFERENT Google account than this PC.
   v3.30.2 — PIXA SHARE moved OUT of this repo into its own project
     (utelinor-hub/Pixa-share → https://utelinor-hub.github.io/Pixa-share/).
     Zero code is shared with this app — the two only agree on the Drive
     protocol above. The Open button and the guide now point to the new
     address; ./share/ here is just a redirect stub for old phones.

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
     (every 12 s, on tab focus, and right after a push).
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
  /* v3.27.0: 25 s → 12 s — the other PC's new photos / edits / collages
     land within seconds of the next focus, not half a minute later.
     v3.30.4: plus a LIGHT arrival probe every 3 s — a tiny id-only Drive
     query that notices phone uploads (PIXA SHARE) the moment they land
     and triggers a full pull right away, so photos appear on screen as
     soon as they arrive instead of at the next 12 s tick. */
  const POLL_MS = 12000;
  const PROBE_MS = 3000;
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
    probeTimer: null,     // v3.30.4: fast arrival probe
    knownIds: new Set(),  // v3.30.4: file ids already seen in the Drive folder
    gisLoaded: false,
    enabled: false,
    everSignedIn: false,  // true only after a successful sign-in on this PC
    pendingAdopt: 0,
    lastPullAt: 0,        // v3.27.0: throttle for focus pulls
    lastSyncAt: 0,        // v3.29.0: shown in the Cloud dialog
    fixUrl: null          // console page that fixes the current error (button in the dialog)
  };

  const el = {
    chip: null, label: null,
    modal: null, clientId: null, email: null, line: null, diag: null, steps: null,
    btnSaveId: null, btnSign: null, btnNow: null, btnOut: null, btnFree: null,
    btnEnable: null,
    csStat: null, csVer: null, csLast: null, csCount: null, csWait: null, btnUpd: null,
    csShare: null, csShareCount: null, csSharePhone: null, btnShare: null
  };

  /* ================= IndexedDB 'cloudblobs' store (full-size cache) ================= */
  async function blobGet(pid) { return idbGet('cloudblobs', pid); }
  async function blobSet(pid, blob) { try { await idbSet('cloudblobs', pid, blob); } catch (e) {} }
  async function blobDel(pid) { try { await idbDel('cloudblobs', pid); } catch (e) {} }

  /* ================= status chip ================= */
  function setStatus_(st, note) {
    C.status = st;
    C.statusNote = note || '';
    if (st === 'ok') C.fixUrl = null;   // error solved — hide the console-fix button
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

  /* v3.25.9: token storage extracted — BOTH the token-client callback AND
     askToken's per-call wrapper must store the token. Before this fix the
     wrapper only RESOLVED the promise: GIS delivers the response to the
     CURRENT callback (the wrapper), so the original callback that saved
     C.token never ran — sign-in 'succeeded' with C.token = null and every
     sync cycle then bailed silently at !hasToken(), leaving the chip on
     'Syncing…' forever with nothing actually syncing (the user's bug:
     'login page bhi aata hai bas sync hi hota rehta hai'). */
  function storeToken(resp) {
    if (resp && resp.access_token) {
      C.token = resp.access_token;
      C.tokenExp = Date.now() + Math.max(60, (Number(resp.expires_in) || 3600) - 90) * 1000;
      /* keep the session, so a reload never needs the Google window again.
         v3.29.0: ever=true survives the token expiring — the next boot and
         every poll tick may silently reconnect instead of demanding a
         fresh sign-in. */
      sessSet({ token: C.token, exp: C.tokenExp, email: (C.cfg && C.cfg.email) || '', ever: true });
    }
  }

  async function ensureTokenClient() {
    if (!C.cfg || !C.cfg.clientId) throw new Error('Google Client ID is missing — open Cloud Sync setup');
    await loadGis();
    if (!C.tc) {
      C.tc = window.google.accounts.oauth2.initTokenClient({
        client_id: C.cfg.clientId,
        scope: SCOPE,
        callback: storeToken,
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
        if (resp && resp.access_token) { storeToken(resp); resolve(resp.access_token); }   /* v3.25.9: ALSO store it */
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
    if (type === 'access_denied') C.fixUrl = CONSOLE_AUDIENCE();
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

  /* v3.14.1: failed Drive responses become plain sentences with the exact
     fix. Console-fixable problems (Drive API switched off, Testing-mode 403)
     also set C.fixUrl — the Cloud dialog then shows a one-click button that
     opens the right Google Cloud Console page. */
  const PROJECT_ID = DEFAULT_CLIENT_ID.split('-')[0] || '';
  const CONSOLE_ENABLE = (p) => `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${p || PROJECT_ID}`;
  const CONSOLE_AUDIENCE = (p) => `https://console.cloud.google.com/auth/audience?project=${p || PROJECT_ID}`;

  async function driveErrText(r) {
    C.fixUrl = null;
    let body = '', reason = '', msg = '';
    try {
      body = await r.text();
      const j = JSON.parse(body);
      const e = j.error || {};
      const er = (e.errors && e.errors[0]) || {};
      reason = er.reason || (e.details && e.details[0] && e.details[0].reason) || '';
      msg = e.message || er.message || '';
    } catch (err) { /* non-JSON body */ }
    const all = (reason + ' ' + msg + ' ' + body).toLowerCase();
    if (r.status === 403 &&
        (all.includes('accessnotconfigured') || all.includes('has not been used') ||
         all.includes('api_target_not_enabled') || all.includes('servicedisabled') ||
         all.includes('has not been enabled') || all.includes('is disabled'))) {
      const m = body.match(/project=(\d+)/);
      C.fixUrl = CONSOLE_ENABLE(m && m[1]);
      return 'Google Drive API is switched OFF in your Cloud project — press "Enable Drive API" below, then wait about 1 minute (sync restarts on its own)';
    }
    if (all.includes('ratelimit') || all.includes('userratelimit') || all.includes('quotaexceeded') ||
        all.includes('resource_exhausted') || all.includes('dailylimit') || r.status === 429) {
      return 'Google is rate-limiting for a moment — sync will retry automatically';
    }
    if (r.status === 401) return 'Google session expired — press "Sign in with Google" to reconnect';
    if (r.status === 403) {
      C.fixUrl = CONSOLE_AUDIENCE();
      return 'Google refused this request (permission) — sign out, sign in again and tick all the checkboxes; if it repeats, open the Cloud Console with the button below';
    }
    if (r.status >= 500) return 'Google Drive had a temporary problem — sync will retry automatically';
    const short = (msg || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    return `Google Drive error (${r.status})${short ? ': ' + short : ''}`;
  }

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
    if (!r.ok) throw new Error(await driveErrText(r));
    const j = await r.json();
    if (j.files && j.files.length) return j.files[0].id;
    const cr = await authFetch(`${DRIVE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!cr.ok) throw new Error(await driveErrText(cr));
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
    /* v3.25.9: FIXED boundary. The old random boundary mismatched the
       'Content-Type: multipart/related; boundary=pixabnd' header that
       uploadNew sends explicitly — fetch lets the header win over the
       Blob's type, so Google parsed the body with the wrong boundary and
       answered 400 'Malformed multipart body' to EVERY photo upload
       (the manifest push worked because it passes no explicit header). */
    const boundary = 'pixabnd';
    const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
    return new Blob([pre, blob, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` });
  }

  /* v3.29.0: returns {id, ct} — ct is GOOGLE'S server timestamp for the
     new file. Manifest entries are stamped with it instead of the local
     clock, so two PCs whose clocks disagree by a few minutes still agree
     on which edit is newer. */
  async function uploadNew(blob, name, appProps) {
    const body = multipartBody({ name, parents: [C.folderId], appProperties: appProps || {} }, blob);
    const r = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,createdTime`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=pixabnd' }, body });
    if (!r.ok) throw new Error(await driveErrText(r));
    const j = await r.json();
    return { id: j.id, ct: j.createdTime || nowIso() };
  }

  /* v3.29.0: returns Google's server modifiedTime for the updated file. */
  async function updateMedia(fileId, blob) {
    const r = await authFetch(`${UPLOAD}/files/${fileId}?uploadType=media&fields=modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    if (!r.ok) throw new Error(await driveErrText(r));
    try { return (await r.json()).modifiedTime || nowIso(); } catch (e) { return nowIso(); }
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
    if (!r.ok) throw new Error(await driveErrText(r));
    const txt = await r.text();
    try { return JSON.parse(txt); } catch (e) { return null; }
  }

  async function pushManifest(m) {
    m.updated = nowIso();
    const body = multipartBody({ name: MANIFEST_NAME, parents: [C.folderId] }, new Blob([JSON.stringify(m)], { type: 'application/json' }));
    if (C.manifestId) {
      const r = await authFetch(`${UPLOAD}/files/${C.manifestId}?uploadType=multipart&fields=id`, { method: 'PATCH', body });
      if (!r.ok) throw new Error(await driveErrText(r));
    } else {
      const r = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body });
      if (!r.ok) throw new Error(await driveErrText(r));
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

  /* v3.27.0: returns a counts object {added, edited, removed} instead of a
     boolean so the pull cycle can TELL the user what arrived (silent auto
     pulls used to change the grid without a word). */
  async function applyRemote(m, { silent } = {}) {
    if (!m) return null;
    C.remote = m;
    await remoteSet(m);
    const byPid = new Map();
    const byLink = new Map();
    state.photos.forEach((p) => {
      if (p.cloud) byPid.set(p.cloud.pid, p);
      else byLink.set(linkKey(p), p);
    });
    const n = { added: 0, edited: 0, removed: 0, renamed: 0 };
    const keep = [];
    const seen = new Set();
    for (const e of m.photos) {
      if (e.deleted) {
        const lp = byPid.get(e.pid);
        if (lp) { removeLocalCloudPhoto(lp); byPid.delete(e.pid); n.removed++; }
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
          /* v3.29.0 THE DISPLAY FIX: a photo that also lives on THIS PC's
             disk would keep showing the old disk bytes forever (the disk
             file cannot be rewritten — the folder was imported read-only).
             The remoteEdit flag makes getFile serve the cloud copy instead,
             so the other PC's edit is finally VISIBLE here, until this PC
             saves its own edit (which becomes the newest truth). */
          lp.remoteEdit = true;
          invalidateThumb(lp);
          await blobDel(e.pid);
          n.edited++;
        }
        /* v3.27.0: a photo renamed / moved between folders inside PIXA on
           another PC follows the manifest — but a photo that lives on THIS
           PC's disk keeps its local name (the disk file is its truth) */
        if (!lp.handle) {
          if (e.name && e.name !== lp.name) { invalidateThumb(lp); lp.name = e.name; n.renamed++; }
          if ((e.folder || '') && (e.folder || '') !== (lp.folder || '')) { lp.folder = e.folder; n.renamed++; }
        }
        keep.push(lp);
        byPid.delete(e.pid);
        continue;
      }
      const lk = byLink.get(`${e.folder || ''}//${e.name}`);
      if (lk) {
        /* the same local photo already exists here — link it instead of
           duplicating (v3.27.0: linking is NOT an "arrival" — a fresh
           sign-in must not claim "12 new from your other PC" for photos
           that were already on this PC) */
        lk.cloud = { pid: e.pid, fileId: e.fileId, thumbId: e.thumbId, updated: e.updated };
        const links = await linksGet(); links[linkKey(lk)] = e.pid; await linksSet(links);
        keep.push(lk); byLink.delete(`${e.folder || ''}//${e.name}`);
        continue;
      }
      keep.push({
        name: e.name, size: e.size, lastModified: e.lastModified,
        handle: null, file: null, folder: e.folder || 'Google Drive',
        cloud: { pid: e.pid, fileId: e.fileId, thumbId: e.thumbId, updated: e.updated }
      });
      n.added++;
    }
    /* entries that vanished from the remote manifest were deleted on another PC */
    for (const [, lp] of byPid) { removeLocalCloudPhoto(lp); n.removed++; }
    if (n.added || n.edited || n.removed || n.renamed) {
      /* local photos first, then cloud-only photos (grid sorts them anyway) */
      const locals = state.photos.filter((p) => !p.cloud);
      state.photos = locals.concat(keep.filter((p) => p.cloud));
      buildTree(); applyFilter();
    }
    /* settings (sort / zoom) follow the newest save */
    if (m.settings && m.settings.updated) applyRemoteSettings(m.settings);
    return n;
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
     so every other PC sees them at the next poll).
     v3.30.1 — files tagged pixa:'share' come from the PIXA SHARE phone
     app (original bytes + a matched .thumb.jpg preview): they land in
     the "PIXA SHARE" group with their preview linked, and the toast
     names the sender. Untagged files keep landing in
     "Phone & other uploads" like before. */
  const ADOPT_IMG = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
  async function adoptExternal(m) {
    if (!C.folderId || C.pushing || !m || !m.photos) return { count: 0, share: 0 };
    const q = encodeURIComponent(`'${C.folderId}' in parents and trashed = false and mimeType contains 'image/'`);
    const r = await authFetch(`${DRIVE}/files?q=${q}&fields=files(id,name,mimeType,size,createdTime,appProperties)&pageSize=1000`);
    if (!r.ok) return { count: 0, share: 0 };
    const j = await r.json();
    /* v3.30.4: feed the arrival probe — these ids are now known */
    (j.files || []).forEach((f) => { if (f.id) C.knownIds.add(f.id); });
    if (!j.files || !j.files.length) return { count: 0, share: 0 };
    const known = new Set();
    m.photos.forEach((e) => { known.add(e.fileId); if (e.thumbId) known.add(e.thumbId); });
    /* v3.30.1: previews uploaded by PIXA SHARE are matched to their
       full-size photo instead of being adopted as photos themselves */
    const thumbs = new Map();
    j.files.forEach((f) => {
      if (/\.thumb\.jpe?g$/i.test(f.name || '')) thumbs.set((f.name || '').replace(/\.thumb\.jpe?g$/i, ''), f.id);
    });
    const fresh = j.files.filter((f) =>
      f.id && !known.has(f.id) &&
      ADOPT_IMG.test(f.name || '') &&
      !/\.thumb\.jpe?g$/i.test(f.name || '') &&
      !(f.appProperties && (f.appProperties.pixa === 'photo' || f.appProperties.pixa === 'thumb'))
    );
    if (!fresh.length) return { count: 0, share: 0 };
    let shareCount = 0;
    for (const f of fresh) {
      const isShare = !!(f.appProperties && f.appProperties.pixa === 'share');
      if (isShare) shareCount++;
      m.photos.push({
        pid: uuid(),
        name: f.name,
        folder: isShare ? 'PIXA SHARE' : 'Phone & other uploads',
        type: f.mimeType || 'image/jpeg',
        size: Number(f.size) || 0,
        lastModified: Date.parse(f.createdTime) || Date.now(),
        fileId: f.id,
        thumbId: thumbs.get(f.name) || null,
        updated: f.createdTime || nowIso(),
        deleted: false,
        adopted: true
      });
    }
    m.rev = Date.now();
    await pushManifest(m);
    await applyRemote(m, { silent: true });
    return { count: fresh.length, share: shareCount };
  }

  /* ================= upload queue (background, zero-lag) ================= */
  function schedulePush(ms) {
    if (!C.enabled) return;
    clearTimeout(C.pushTimer);
    C.pushTimer = setTimeout(() => { pushCycle().catch((e) => setStatus_('err', e.message)); }, ms || 3000);
  }

  /* v3.29.0: the editor no longer freezes the whole upload queue. Before
     this, keeping the editor open (the normal way to work in PIXA!) meant
     NOTHING was ever backed up — the queue waited up to 5 minutes and then
     rescheduled every 8 s for as long as the editor stayed open. Now it
     yields a few seconds and then uploads in the background anyway. */
  async function waitForIdleEditor() {
    let guard = 0;
    while (editorOpen() && guard < 3) { await sleep(1500); guard++; }
  }

  async function pushCycle() {
    if (!C.enabled || C.pushing || !hasToken()) return;
    C.pushing = true;
    try {
      await waitForIdleEditor();
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
      const deletedHere = new Map();                 /* v3.27.0: pid → deletion time */
      if (delQ.length) {
        for (const pid of delQ) {
          const e = entries.get(pid);
          if (e && !e.deleted) { e.deleted = true; e.updated = nowIso(); trashFiles([e.fileId, e.thumbId]); }
          deletedHere.set(pid, nowIso());
          entries.delete(pid);
        }
        await delQSet([]);
      }

      /* 2 — re-uploads of photos edited on this PC.
         v3.27.0: one failed edit upload no longer kills the cycle — the
         pid stays queued and retries at the next cycle, while every OTHER
         edit still reaches the other PCs. */
      let dirty = await dirtyGet();
      if (dirty.length) {
        const stillDirty = [];
        for (const pid of dirty) {
          const e = entries.get(pid);
          const b = await blobGet(pid);
          if (e && b) {
            try {
              const mt = await updateMedia(e.fileId, b);   /* v3.29.0: Google's server clock */
              const tb = await makeThumbBlob(b);
              if (tb) {
                if (e.thumbId) { try { await updateMedia(e.thumbId, tb); } catch (er) { e.thumbId = (await uploadNew(tb, `${e.name}.thumb.jpg`, { pixa: 'thumb' })).id; } }
                else e.thumbId = (await uploadNew(tb, `${e.name}.thumb.jpg`, { pixa: 'thumb' })).id;
              }
              const lp = state.photos.find((x) => x.cloud && x.cloud.pid === pid);
              if (lp) { e.size = lp.size; e.lastModified = lp.lastModified; } else { e.size = b.size; }
              e.updated = mt || nowIso();
              /* v3.29.0: this PC just saved its own newer edit — the cloud
                 copy is no longer the newest truth for display */
              if (lp) { if (lp.cloud) { lp.cloud.updated = e.updated; lp.cloud.dirty = false; } lp.remoteEdit = false; }
            } catch (er) { stillDirty.push(pid); }
          }
          await sleep(30);
        }
        await dirtySet(stillDirty);
      }

      /* 3 — new local photos → upload (one by one, editor pauses the queue).
         v3.27.0 THE BIG FIX: a photo that cannot be read (folder permission
         dropped) or fails to upload is SKIPPED, not fatal. Before this fix
         ONE bad photo aborted the whole cycle — the manifest was only
         written at the very end, so NOTHING (new photos, edits, collages,
         deletions) ever reached the other PC. Failed photos are retried at
         the next cycle; everything else syncs right now. */
      let upCount = 0, skipCount = 0;
      for (const p of state.photos.slice()) {
        if (p.cloud) continue;
        /* v3.29.0: the editor-open break is GONE — uploads run while the
           user edits; only a lost Google session stops the loop */
        if (!hasToken()) break;
        const key = linkKey(p);
        if (links[key]) continue;
        const twin = [...entries.values()].find((e) => !e.deleted && (e.folder || '') === (p.folder || '') && e.name === p.name);
        let pid;
        if (twin) { pid = twin.pid; }
        else {
          try {
            pid = uuid();
            setStatus_('syncing', `Backing up “${p.name}”…`);   /* v3.29.0: live progress */
            const f = await getFile(p);
            const up = await uploadNew(f, p.name, { pixa: 'photo' });
            const tb = await makeThumbBlob(f);
            const thumbId = tb ? (await uploadNew(tb, `${p.name}.thumb.jpg`, { pixa: 'thumb' })).id : null;
            entries.set(pid, {
              pid, name: p.name, folder: p.folder || '', type: f.type || 'image/jpeg',
              size: f.size, lastModified: p.lastModified || Date.now(),
              fileId: up.id, thumbId, updated: up.ct || nowIso(), deleted: false
            });
          } catch (er) { skipCount++; continue; }   /* retried at the next cycle */
          upCount++;
          if (upCount % 20 === 0) toast(`Uploading — ${upCount} done`, 'ok', 2500);
          await sleep(30);
        }
        p.cloud = { pid, fileId: (entries.get(pid) || {}).fileId, thumbId: (entries.get(pid) || {}).thumbId, updated: (entries.get(pid) || {}).updated };
        links[key] = pid;
        await linksSet(links);
      }

      /* 3b — v3.27.0: names / folder changes made inside PIXA follow the
         manifest too, so a photo renamed on this PC shows its new name on
         every other PC (photos on the other PC's DISK keep their local
         name — only app-owned photos follow). */
      for (const p of state.photos) {
        if (!p.cloud || p.handle) continue;
        const e = entries.get(p.cloud.pid);
        if (e && !e.deleted && (e.name !== p.name || (e.folder || '') !== (p.folder || ''))) {
          e.name = p.name;
          e.folder = p.folder || '';
        }
      }

      /* 4 — v3.27.0: re-pull and MERGE, then write. A slow upload cycle on
         this PC must never roll back what the other PC pushed while we
         were uploading (their new photos arrive, their deletions become
         tombstones instead of being resurrected). */
      let result = [...entries.values()];
      try {
        const baseList = m.photos.slice();          /* manifest as seen at cycle start */
        const m2 = await pullManifest();
        if (m2 && m2.rev && m2.rev > (C.remote ? C.remote.rev : 0)) {
          const out = new Map(result.map((e) => [e.pid, e]));
          const theirs = new Map(m2.photos.map((e) => [e.pid, e]));
          for (const [pid2, e2] of theirs) {
            /* photos deleted on THIS PC during the cycle stay deleted —
               the other PC's stale copy must not resurrect them (unless
               that PC edited the photo AFTER our deletion) */
            if (deletedHere.has(pid2)) {
              if ((e2.updated || '') > (deletedHere.get(pid2) || '')) out.set(pid2, e2);
              continue;
            }
            const cur = out.get(pid2);
            if (!cur || (e2.updated || '') > (cur.updated || '')) out.set(pid2, e2);
          }
          for (const e1 of baseList) {
            if (!theirs.has(e1.pid)) {
              const cur = out.get(e1.pid);
              if (cur && !cur.deleted) { cur.deleted = true; cur.updated = nowIso(); }
            }
          }
          result = [...out.values()];
        }
      } catch (er) { /* merge is best-effort — push what we have */ }
      m.rev = Date.now();
      m.photos = result;
      if (!m.settings) m.settings = {};
      if (state.sort) m.settings.sort = state.sort;
      await pushManifest(m);
      C.lastSyncAt = Date.now();
      /* merged-in entries (pushed by the other PC during this cycle) show
         in the grid immediately instead of waiting for the next poll */
      await applyRemote(m, { silent: true });
      setStatus_('ok', skipCount ? `${skipCount} photo${skipCount > 1 ? 's' : ''} waiting to upload — will retry` : '');
      if (upCount) toast(`${upCount} photo${upCount > 1 ? 's' : ''} backed up to Google Drive`, 'ok', 4000);
    } catch (e) {
      setStatus_('err', e.message);
      schedulePush(60000); /* try again quietly */
    } finally {
      C.pushing = false;
    }
  }

  /* ================= pull cycle (see new photos from other PCs) ================= */
  /* v3.30.1: the arrival toast names the sender — PIXA SHARE photos (the
     phone app) get their own wording so the user knows where they came from */
  function announceAdopted(a) {
    const n = a.count || 0;
    if (!n) return;
    if (a.share) toast(`${a.share} photo${a.share > 1 ? 's' : ''} received from PIXA SHARE (mobile) — original quality`, 'ok', 5000);
    else toast(`${n} photo${n > 1 ? 's' : ''} arrived from the phone`, 'ok', 4500);
  }

  /* v3.30.1: PIXA SHARE on the phone drops a tiny heartbeat file
     (pixa-share-mobile.json) into the Drive folder with its account email.
     If that account is NOT this PC's account, the photos will never arrive
     here — warn the user the minute it happens instead of silence. */
  let heartbeatWarned = false;
  async function checkPhoneHeartbeat() {
    try {
      const q = encodeURIComponent(`name = 'pixa-share-mobile.json' and trashed = false and '${C.folderId}' in parents`);
      const r = await authFetch(`${DRIVE}/files?q=${q}&fields=files(id)&pageSize=1`);
      if (!r.ok) return;
      const j = await r.json();
      if (!j.files || !j.files.length) return;
      const fr = await authFetch(`${DRIVE}/files/${j.files[0].id}?alt=media`);
      if (!fr.ok) return;
      const hb = JSON.parse(await fr.text());
      C.phone = { email: hb.email || '', at: hb.at || '' };
      const pcEmail = (C.cfg && C.cfg.email) || '';
      if (hb.email && pcEmail && hb.email !== pcEmail && !heartbeatWarned) {
        heartbeatWarned = true;
        toast(`PIXASHARE: your phone is signed in as ${hb.email} but this PC uses ${pcEmail} — photos will NOT arrive. Sign the phone out and in with the right account.`, 'err', 10000);
      }
      updModal();
    } catch (e) { /* heartbeat is best-effort */ }
  }

  async function pullCycle({ manual } = {}) {
    if (!C.enabled || C.pulling || !hasToken()) return;
    C.pulling = true;
    C.lastPullAt = Date.now();
    try {
      setStatus_('syncing');
      C.folderId = C.folderId || await findFolder();
      C.manifestId = C.manifestId || await findManifest();
      let m = await pullManifest();
      if (!m) {
        /* no manifest yet — still pick up photos other apps dropped in the folder */
        let adopted0 = { count: 0, share: 0 };
        try { adopted0 = await adoptExternal(emptyManifest()); } catch (e) { /* non-fatal */ }
        if (adopted0 && adopted0.count) announceAdopted(adopted0);
        await checkPhoneHeartbeat();
        if (manual) { await pushCycle(); } else setStatus_('ok');
        return;
      }
      const n = await applyRemote(m, { silent: true });
      C.lastSyncAt = Date.now();
      /* v3.8.0: adopt photos that other apps uploaded straight into the
         Drive folder (e.g. an auto-upload app on the phone, or PIXA SHARE) */
      let adopted = { count: 0, share: 0 };
      try { adopted = await adoptExternal(m); } catch (e) { /* non-fatal */ }
      if (adopted && adopted.count) announceAdopted(adopted);
      await checkPhoneHeartbeat();
      const mine = await linksGet();
      const haveLocalNew = state.photos.some((p) => !p.cloud && !mine[linkKey(p)]);
      if (haveLocalNew) schedulePush(1500);
      else setStatus_('ok');
      /* v3.27.0: arrivals are no longer silent — the user SEES that the
         other PC's photos / edits / collages just landed */
      if (n && (n.added || n.edited || n.removed || n.renamed)) {
        const bits = [];
        if (n.added) bits.push(`${n.added} new`);
        if (n.edited) bits.push(`${n.edited} updated`);
        if (n.renamed) bits.push(`${n.renamed} renamed`);
        if (n.removed) bits.push(`${n.removed} removed`);
        toast(`Cloud sync — ${bits.join(', ')} from your other PC`, 'ok', 3500);
      } else if (manual) toast('Everything is already in sync', 'ok', 2500);
    } catch (e) {
      setStatus_('err', e.message);
      if (manual) toast('Sync failed: ' + e.message, 'err', 6000);
    } finally {
      C.pulling = false;
    }
  }

  /* v3.29.0: the poll tick is a named function so it can be unit-tested.
     An expired session no longer kills sync until someone notices: the
     tick silently renews the Google token first (safe — this PC signed in
     successfully before, so its origin is authorized) and only falls back
     to the honest "Sign in" chip when even that fails. */
  async function pollTick() {
    if (document.hidden || !C.enabled) return;
    if (!hasToken()) {
      const t = await silentRenew();
      if (t) { setStatus_('syncing', 'Reconnected to Google Drive'); pullCycle().catch(() => {}); schedulePush(3000); }
      else setStatus_('out', 'Sign in to start syncing');
      return;
    }
    pullCycle().catch(() => {});
  }

  /* v3.30.4: the arrival probe — every 3 s a tiny id-only listing of the
     Drive folder. A new id means the phone (PIXA SHARE) or another device
     just uploaded something: trigger a full pull immediately so the new
     photos appear on screen right away, not at the next 12 s poll. The
     full pullCycle re-lists the folder with all fields and does the real
     adoption; the probe only says "go now". */
  async function arrivalProbe() {
    if (document.hidden || !C.enabled || !hasToken() || C.pulling) return;
    if (!C.folderId) return;                    /* the first full pull finds the folder */
    const q = encodeURIComponent(`'${C.folderId}' in parents and trashed = false and mimeType contains 'image/'`);
    const r = await authFetch(`${DRIVE}/files?q=${q}&fields=files(id)&pageSize=1000`);
    if (!r.ok) return;
    const j = await r.json();
    const ids = (j.files || []).map((f) => f.id).filter(Boolean);
    if (!ids.length) return;
    const fresh = ids.filter((id) => !C.knownIds.has(id));
    ids.forEach((id) => C.knownIds.add(id));
    if (fresh.length) {
      setStatus_('syncing', `${fresh.length} new photo${fresh.length > 1 ? 's' : ''} arriving…`);
      pullCycle().catch(() => {});
    }
  }

  function startPolling() {
    clearInterval(C.timer);
    C.timer = setInterval(() => { pollTick().catch(() => {}); }, POLL_MS);
    /* v3.30.4: the fast probe rides along with the normal poll */
    clearInterval(C.probeTimer);
    C.probeTimer = setInterval(() => { arrivalProbe().catch(() => {}); }, PROBE_MS);
  }

  /* refresh the Google token before it expires so background sync never stops */
  function startRenewTimer() {
    clearInterval(C.renewTimer);
    /* v3.29.0: no document.hidden gate any more — the old gate meant a PC
       left in the background missed its renewal window and the whole
       session died overnight with it */
    C.renewTimer = setInterval(async () => {
      if (!C.enabled || !C.token) return;
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

    /* v3.29.0: true when the OTHER PC saved a newer edit of this photo —
       getFile uses it to serve the cloud copy instead of the stale disk
       bytes (the disk file cannot be rewritten: folders are read-only). */
    prefersCloud: (p) => !!(p && p.cloud && p.remoteEdit && C.enabled),

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
      C.fixUrl = null;
      await askToken(mode);
      /* v3.14.1: verify the Drive project the moment we hold a token — a
         broken Cloud project (Drive API off, blocked origin) fails HERE with
         the exact fix on screen, instead of “login done” followed by a
         silent red chip seconds later */
      const aboutResp = await authFetch(`${DRIVE}/about?fields=user`).catch(() => null);
      if (aboutResp && !aboutResp.ok && aboutResp.status < 500 && aboutResp.status !== 429) {
        throw new Error(await driveErrText(aboutResp));
      }
      const info = (aboutResp && aboutResp.ok) ? await aboutResp.json().catch(() => null) : null;
      if (info && info.user && info.user.emailAddress) { C.cfg.email = info.user.emailAddress; await cfgSet(C.cfg); }
      C.everSignedIn = true;
      C.enabled = true;
      sessSet({ token: C.token, exp: C.tokenExp, email: (C.cfg && C.cfg.email) || '', ever: true });
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
    /* v3.14.1: console-fixable error → show the one-click fix button.
       v3.15.1: label the button after the page it actually opens, and show
       numbered steps so the console fix is impossible to miss. */
    if (el.btnEnable) {
      el.btnEnable.hidden = !C.fixUrl;
      if (C.fixUrl) {
        const driveApi = C.fixUrl.includes('drive.googleapis.com');
        el.btnEnable.textContent = driveApi ? 'Enable Drive API' : 'Open Publishing settings';
      }
    }
    if (el.steps) {
      const u = C.fixUrl || '';
      if (u.includes('drive.googleapis.com')) {
        el.steps.innerHTML = '<li>Press <b>Enable Drive API</b> below — Google Cloud Console opens</li><li>Press the <b>Enable</b> button there and wait about 1 minute</li><li>Come back here and press <b>Sign in with Google</b> again</li>';
        el.steps.hidden = false;
      } else if (u.includes('/auth/audience')) {
        el.steps.innerHTML = '<li>Press <b>Open Publishing settings</b> below — Google Cloud Console opens</li><li>Under <b>Publishing status</b> choose <b>In production</b> and press <b>Save</b> &nbsp;<i>(or add your Google account under “Test users”)</i></li><li>Come back here and press <b>Sign in with Google</b> again</li>';
        el.steps.hidden = false;
      } else {
        el.steps.hidden = true;
      }
    }
    if (el.diag) {
      const allowed = originAllowed();
      const cid = (C.cfg && C.cfg.clientId) || '';
      el.diag.textContent =
        `Site: ${location.origin}\n` +
        `Origin check: ${allowed ? 'allowed ✓' : 'NOT allowed ✗ — sign-in only works on the official site'}\n` +
        `Client ID: ${cid ? cid.slice(0, 14) + '…' + cid.slice(-8) : 'missing'}\n` +
        (C.statusNote ? `Note: ${C.statusNote}` : 'No errors recorded');
    }
    /* v3.29.0: the Two-PC sync block — the version THIS PC runs, when it
       last synced and how much is still waiting. Sync silently breaks when
       one PC runs an older version, so the block tells the user exactly
       what to check on BOTH PCs. */
    if (el.csStat) {
      el.csStat.hidden = !C.enabled;
      el.csVer.textContent = ((document.querySelector('.ver') || {}).textContent || '').trim() || '?';
      el.csLast.textContent = C.lastSyncAt ? new Date(C.lastSyncAt).toLocaleTimeString() : 'never';
      el.csCount.textContent = String(C.remote ? C.remote.photos.filter((e) => !e.deleted).length : 0);
      (async () => {
        try {
          const dirty = await dirtyGet();
          const links = await linksGet();
          const wait = dirty.length + state.photos.filter((p) => !p.cloud && !links[linkKey(p)]).length;
          el.csWait.textContent = String(wait);
        } catch (e) { /* dialog numbers are best-effort */ }
      })();
    }
    /* v3.30.1: PIXA SHARE block — how many photos the phone sent, and
       whether the phone app is signed in with the SAME account as this PC */
    if (el.csShare) {
      el.csShare.hidden = !C.enabled;
      const shareN = C.remote ? C.remote.photos.filter((e) => !e.deleted && e.folder === 'PIXA SHARE').length : 0;
      el.csShareCount.textContent = String(shareN);
      const pcEmail = (C.cfg && C.cfg.email) || '';
      if (C.phone && C.phone.email) {
        el.csSharePhone.textContent = C.phone.email === pcEmail
          ? `Phone online: ${C.phone.email} ✓ (same account)`
          : `Phone online as ${C.phone.email} — DIFFERENT from this PC (${pcEmail}) — photos will NOT arrive`;
      } else {
        el.csSharePhone.textContent = 'No phone seen yet — open PIXA SHARE on the phone';
      }
    }
  }

  function wireUI() {
    el.chip = document.getElementById('cloudChip');
    el.label = document.getElementById('cloudLabel');
    el.steps = document.getElementById('cloudSteps'); /* v3.15.1: numbered fix steps */
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
    /* v3.14.1: one-click jump to the exact Google Cloud Console page */
    el.btnEnable = document.getElementById('cloudEnable');
    if (el.btnEnable) el.btnEnable.addEventListener('click', () => { if (C.fixUrl) window.open(C.fixUrl, '_blank', 'noopener'); });
    /* v3.29.0: Two-PC sync block + update check straight from the dialog */
    el.csStat = document.getElementById('cloudStat');
    el.csVer = document.getElementById('csVer');
    el.csLast = document.getElementById('csLast');
    el.csCount = document.getElementById('csCount');
    el.csWait = document.getElementById('csWait');
    el.btnUpd = document.getElementById('cloudCheckUpd');
    if (el.btnUpd) el.btnUpd.addEventListener('click', () => {
      if (window.PixsaUpd && window.PixsaUpd.checkNow) window.PixsaUpd.checkNow();
      else toast('Updates are checked automatically — close and reopen the app to fetch the latest version', 'ok', 6000);
    });
    /* v3.30.1: PIXA SHARE block wiring */
    el.csShare = document.getElementById('cloudShare');
    el.csShareCount = document.getElementById('csShareCount');
    el.csSharePhone = document.getElementById('csSharePhone');
    el.btnShare = document.getElementById('cloudOpenShare');
    if (el.btnShare) el.btnShare.addEventListener('click', () => {
      window.open('https://utelinor-hub.github.io/Pixa-share/', '_blank', 'noopener');
    });
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
    /* v3.29.0: the session normally dies overnight (the token lasts ~1 h).
       A PC that signed in successfully before silently reconnects at boot —
       the user opens PIXA in the morning and sync just works, no clicking.
       If the silent renew is refused, fall back to the Sign in chip. */
    if (s && (s.ever || s.email)) {
      C.everSignedIn = true;
      if (s.email && !C.cfg.email) C.cfg.email = s.email;
      setStatus_('connecting', 'Reconnecting to Google Drive…');
      const t = await silentRenew();
      if (t) {
        setStatus_('syncing', 'Restoring your library…');
        startPolling(); startRenewTimer();
        pullCycle({ manual: false }).catch(() => {});
        schedulePush(4000);
        return;
      }
    }
    /* never fire Google auth without a user gesture: on an unauthorized
       origin that would bounce the whole app to a Google error page.
       The chip shows “Sign in” instead — one click and it connects. */
    setStatus_('out', 'Sign in to start syncing');
  }

  /* faster visibility: when the user comes back to the tab, pull at once */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && C.enabled && hasToken()) pullCycle().catch(() => {});
  });
  /* v3.27.0: some windows never fire visibilitychange (popout windows,
     some desktop setups) — pull on focus too, so the other PC's photos,
     edits and collages appear the moment the user looks at PIXA.
     Throttled to one pull per 5 s. */
  window.addEventListener('focus', () => {
    if (C.enabled && hasToken() && !C.pulling && Date.now() - C.lastPullAt > 5000) {
      pullCycle().catch(() => {});
    }
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
