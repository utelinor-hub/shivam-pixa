/* SHIVAM PIXA — editor.js
   Picasa-style edit view: Basic Fixes | Tuning | Effects
   Non-destructive: original + ops list; full-res render on Save.
   v3.3.0: power-cut safe auto-save (IndexedDB 'edits' store), text panel
   (fonts/bold/italic/outline/shadow/align), transparent PNG stickers.
   v3.4.0: cached ops base (adj-only redraws), effect intensity, before/after
   compare, live RGB histogram, I'm Feeling Lucky.
   v3.5.0: viewer removed — the photo grid opens the editor on double-click.
   v3.6.0: spinning tyre header logo (outer colour wheel rotates, the dark
   shutter emblem stays fixed like a Rolls-Royce badge).
   v3.6.1: the tyre spin is now always on — it no longer switches off when
   Windows "Animation effects" (prefers-reduced-motion) are turned off.
   v3.7.0: Google Drive cloud sync — editing a synced photo saves locally
   v3.7.1: QA hardening — cloud chip no longer sticks on “Syncing” after a
           network drop, and sign-in is guarded to the official origin so a
           blocked popup can never bounce the app to a Google error page.
   v3.9.0: Picasa layout — tool panel moved to the LEFT like Picasa 3; on
           phones the photo now fills the whole screen and the tools slide
           out from a “Tools” button (no more tiny photo box); new EXIF
           camera info in the bottom bar (shutter • f-stop • ISO • focal •
           flash) read straight from the JPEG, exactly like Picasa.
   v3.14.0: Picasa-style tool SECTIONS — Crop/Straighten/ABC Text in one
           section, One-click Fixes, Retouch, Add, Rotate — plus two new
           tabs: PAINT (Windows-11-Paint style: pencil, brush, eraser, fill,
           picker, line, rect, ellipse, triangle, star, arrow, Color 1 /
           Color 2, classic palette, size slider) and SELECT (Windows style:
           rect / lasso / magic-wand selection by colour, copy, cut, delete
           = remove text & objects, paste as a draggable patch, drag-to-
           move). Selection edits commit as full-res 'patch' ops.
   v3.14.1: (cloud) broken Cloud projects are caught at sign-in with the
           exact fix shown in-app — see js/cloud.js header.
   v3.15.0: (collage) Picasa-style free pile only — Layout modes removed;
           Page Format gained a Custom ratio; dragging is smooth (overlay
           compositing instead of full re-renders); handles stay on-page.
   v3.15.2: (collage) drag-to-move could die completely after one missed
           pointerup (ghost pointer → every press looked like a pinch) —
           pointer move/up now live on the window and a mouse press flushes
           stale pointers, so dragging always works again.
   v3.16.0: (library) finished collages land in a pinned "Collages" folder
           group and stay re-editable — double-click a collage to reopen it
           with its photos and positions (Picasa-style Edit); folder group
           headers fold/unfold like Picasa's folder tree.
   v3.16.1: (app) real Windows app — an in-app "Install App" button (own
           window, Start menu + taskbar + desktop icon, uninstallable),
           photos can be opened with PIXA straight from Explorer ("Open
           with"), and updates work Android-style: a persistent
           "new version ready" banner with Restart, plus update checks at
           every launch / focus / 15 minutes so installed PCs never miss
           a release.
   v3.16.2: (app) nothing disappears silently any more — the update banner
           stays up for 9 seconds before it applies itself, an "updated to
           vX — all changes are live" toast confirms every applied update,
           and the install button switches to a remembered "App installed"
           state instead of vanishing after the install.
   v3.16.3: (updates) the Help menu owns updates — "Check for Updates" and
           "Install Update" live there permanently (a red dot marks Help
           while an update waits, and the check names the waiting version),
           so an update can never be missed, dismissed into nowhere or left
           stuck again.
   v3.20.0: (desktop) the Desktop Edition — a "Desktop App" button + Help →
           "Get Desktop App (Windows)" download the SHIVAM-PIXA-Setup.zip:
           one "Install SHIVAM PIXA" click creates a real Windows app — its
           own window (no browser tab, no Chrome), Desktop + Start Menu
           shortcuts with the app icon, an isolated profile, and Android-
           style updates: the app keeps checking under Help, shows the new
           version there, and one click on "Install Update" with internet
           on updates and restarts it automatically.
   v3.19.0: (collage) the PicasaCollage DOM engine — the collage editor now
           runs on the reference prototype 1:1: every photo is a real DOM
           element you grab and drag anywhere at 60fps, Picasa's round wheel
           + knob is a real overlay (hover = faint, selected = strong, knob
           always resting at 3 o'clock), the knob rotates AND resizes at
           once, wheel resizes, Shift+wheel rotates, and the five Collage
           Types arrange the free photos into their slots (cover-cropped
           cells that stay draggable afterwards). Re-edit, auto-save,
           4K/300-DPI export and the Clips tray all keep working.
   v3.18.0: (library) Picasa 3 Complete Edition pass — a real view tab strip
           under the menu bar (Library | Collage: the Collage tab appears with
           the first collage of the session and reopens the latest one with
           its positions), the menu bar becomes Picasa's exact eight menus
           (File Edit View Folder Picture Create Tools Help — Folder and
           Create are new, with Collage from Tray and Set Desktop
           Background), and the Photo Tray matches the reference: solid
           green hold pushpin, solid red clear button and a big blue
           "Create Photo Collage" button on an inset tray box.
   v3.17.1: (collage) reference-alignment pass — the wheel knob rests at the
           ring's right edge (3 o'clock) and the ring is a touch thicker,
           matching the Picasa 3 reference engine; a brand-new collage always
           starts on Solid Color (the previous collage's "Use Image"
           background no longer leaks into it).
   v3.17.0: (collage + library) full Picasa 3 replica pass — the collage
           editor gets Picasa's round wheel control (drag the ring's knob
           to rotate AND resize in one gesture, hover shows a faint wheel),
           a right-click menu (Set as Background, Bring to Top / Forward /
           Backward / Bottom, Rotate Right/Left, View and Edit, Remove —
           back to Clips), a Clips (N) tab that adds tray or PC photos onto
           the pile any time at their natural ratio, all five Collage Types
           (Picture Pile / Mosaic / Frame Mosaic / Grid / Contact Sheet),
           the Picasa Page Format list with Landscape/Portrait icons, Draw
           Shadows + Show Captions, and the 2x2 footer (Desktop Background |
           Create Collage | Reset | Close). The library becomes Picasa's
           home screen: Albums (Recently Updated, Starred) / Projects /
           Collages (count) / Folders, folder headers gain a date and a
           one-click Create Photo Collage button, and the tray gains the
           green hold pushpin and the red clear button. */
(() => {
  'use strict';
  const P = window.Pixsa;
  if (!P || !window.PixsaFX) return;
  const { state, toast, getFile, fmtBytes, clamp } = P;
  const FX = window.PixsaFX;

  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const ed = {
    root: q('#editor'), stage: q('#eStage'), canvas: q('#eCanvas'), crop: q('#eCrop'),
    busy: q('#eBusy'), name: q('#eName'), count: q('#eCount'),
    dims: q('#eDims'), exif: q('#eExif'), undoBtn: q('#eUndo'), redoBtn: q('#eRedo'),
    toolBox: q('#eToolBox'), zoom: q('#eZoom'), fxGrid: q('#fxGrid')
  };

  const ADJ_IDS = [['adFill', 'vFill', 'fill'], ['adHigh', 'vHigh', 'high'], ['adShad', 'vShad', 'shad'],
                   ['adTemp', 'vTemp', 'temp'], ['adTint', 'vTint', 'tint'], ['adSat', 'vSat', 'sat']];

  const ADJ0 = { fill: 0, high: 0, shad: 0, temp: 0, tint: 0, sat: 0 };
  const TEXT0 = {
    size: 7, color: '#ffffff', font: '"Segoe UI", sans-serif', rot: 0, alpha: 100,
    bold: false, italic: false, underline: false, stroke: '#000000', strokeW: 0, shadow: true, align: 'center'
  };

  /* v3.14.0 tool families (Paint + Select) */
  const PAINT_STROKES = ['pencil', 'brush', 'eraser'];
  const PAINT_SHAPES = new Set(['line', 'rect', 'ellipse', 'triangle', 'star', 'arrow']);
  const SEL_TOOLS = { selrect: 'rect', sellasso: 'lasso', selwand: 'wand' };

  const E = {
    open: false, photo: null, idx: -1, src: null,
    ops: [], adj: { ...ADJ0 },
    prevAdj: null, undo: [], redo: [], tool: null, saved: false,
    cropR: null, aspect: 0, pendPts: [], brush: 16, draft: null,
    fit: true, zoom: 100, fxPage: 1,
    /* v3.4.0: stickers + text draft + autosave state */
    stickers: [], stkSeq: 0, stkSel: null,
    /* v3.13.0 Picasa text tool: txtSel = selected committed text op,
       txtEditing = { op, isNew } while the on-canvas editor is open */
    txtSel: null, txtEditing: null,
    /* v3.14.0 Paint & Select state */
    paint: { size: 6, c1: '#1a1a1a', c2: '#ffffff', noFill: false },
    sel: null, floatSel: null, lift: null, clipboard: null,
    liveShape: null, wandTol: 32, busySel: false,
    dirty: false, restored: false
  };

  /* ---------- busy ---------- */
  const setBusy = (b) => { ed.busy.hidden = !b; };

  /* ---------- tiny EXIF reader (JPEG) — Picasa-style camera info ----------
     Reads the EXIF block from the first 128 KB of the file and formats
     shutter speed, f-number, ISO, focal length and flash exactly like the
     Picasa 3 bottom bar (e.g. “1/250 s • f/2.8 • ISO 320 • 78 mm • Flash off”). */
  async function readExif(file) {
    try {
      const isJpg = (file && file.type === 'image/jpeg') || /\.jpe?g$/i.test((file && file.name) || '');
      if (!isJpg || !file.slice) return '';
      const head = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
      if (head.length < 12 || head[0] !== 0xFF || head[1] !== 0xD8) return '';
      const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
      let o = 2, tiff = -1;
      while (o + 4 <= head.length) {
        if (head[o] !== 0xFF) { o++; continue; }
        const marker = head[o + 1];
        if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9) || marker === 0x01) { o += 2; continue; }
        if (marker === 0xDA) break; /* start of scan — no EXIF found */
        const len = (head[o + 2] << 8) | head[o + 3];
        if (len < 2) break;
        if (marker === 0xE1 && o + 10 <= head.length &&
            head[o + 4] === 0x45 && head[o + 5] === 0x78 && head[o + 6] === 0x69 &&
            head[o + 7] === 0x66 && head[o + 8] === 0x00 && head[o + 9] === 0x00) { tiff = o + 10; break; }
        o += 2 + len;
      }
      if (tiff < 0 || tiff + 8 > head.length) return '';
      const big = head[tiff] === 0x4D; /* 'MM' = big-endian, 'II' = little-endian */
      const u16 = (p) => dv.getUint16(p, !big);
      const u32 = (p) => dv.getUint32(p, !big);
      if (u16(tiff + 2) !== 0x2A) return '';
      const ifd0 = tiff + u32(tiff + 4);
      if (ifd0 + 2 > head.length) return '';
      let exifIfd = -1;
      const n0 = u16(ifd0);
      for (let i = 0; i < n0; i++) {
        const e = ifd0 + 2 + i * 12;
        if (e + 12 > head.length) break;
        if (u16(e) === 0x8769) exifIfd = tiff + u32(e + 8);
      }
      if (exifIfd < 0 || exifIfd + 2 > head.length) return '';
      const rat = (p) => { const num = u32(p), den = u32(p + 4); return den ? num / den : 0; };
      const out = {};
      const en = u16(exifIfd);
      for (let i = 0; i < en; i++) {
        const e = exifIfd + 2 + i * 12;
        if (e + 12 > head.length) break;
        const tag = u16(e), typ = u16(e + 2), cnt = u32(e + 4);
        const sz = ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8])[typ] || 1;
        const val = (sz * cnt <= 4) ? e + 8 : tiff + u32(e + 8);
        if (val < 0 || val + sz * cnt > head.length) continue;
        if (tag === 0x829A && typ === 5) out.exp = rat(val);
        else if (tag === 0x829D && typ === 5) out.fn = rat(val);
        else if (tag === 0x8827 && typ === 3) out.iso = u16(val);
        else if (tag === 0x920A && typ === 5) out.focal = rat(val);
        else if (tag === 0x9209 && typ === 3) out.flash = u16(val);
      }
      const parts = [];
      if (out.exp > 0) parts.push(out.exp >= 1 ? `${Math.round(out.exp)} s` : `1/${Math.round(1 / out.exp)} s`);
      if (out.fn > 0) parts.push(`f/${(Math.round(out.fn * 10) / 10).toFixed(1)}`);
      if (out.iso) parts.push(`ISO ${out.iso}`);
      if (out.focal > 0) parts.push(`${Math.round(out.focal)} mm`);
      if (out.flash != null) parts.push((out.flash & 1) ? 'Flash on' : 'Flash off');
      return parts.join(' \u2022 ');
    } catch (e) { return ''; }
  }

  /* ---------- sticker map (ops -> bitmaps) ---------- */
  function stickerMap() {
    const m = new Map();
    for (const s of E.stickers) m.set(s.sid, s.bmp);
    return m;
  }

  /* ---------- preview ----------
     v3.4.0: the ops stack is rendered once into a cached "base" canvas;
     slider drags only re-run the tuning pass on top — buttery smooth.
     v3.13.0: TEXT ops are excluded from the cached base and painted on top
     after tuning — moving/sizing text no longer rebuilds the whole stack and
     text always sits above the photo adjustments, exactly like Picasa. */
  let rafPend = false;
  let baseCv = null, baseKey = '';
  const nonTextOps = () => E.ops.filter((o) => o.type !== 'text');
  function opsKey() {
    return JSON.stringify(nonTextOps()) + (E.draft ? '|S' + E.draft.deg : '') + '|' + (E.src ? E.src.width + 'x' + E.src.height : '');
  }
  function ensureBase() {
    const k = opsKey();
    if (!baseCv || baseKey !== k) {
      const ops = E.draft ? [...nonTextOps(), E.draft] : nonTextOps();
      baseCv = FX.renderOps(E.src, ops, E.pmax || 1400, stickerMap());
      baseKey = k;
    }
    return baseCv;
  }
  function renderPreview() {
    if (rafPend || comparing) return Promise.resolve();
    rafPend = true;
    return new Promise((res) => requestAnimationFrame(() => {
      rafPend = false;
      if (!E.src || !E.open) return res();
      const base = ensureBase();
      const cv = ed.canvas;
      if (cv.width !== base.width || cv.height !== base.height) { cv.width = base.width; cv.height = base.height; }
      const cx = cv.getContext('2d');
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.drawImage(base, 0, 0);
      FX.applyAdjTo(cv, E.adj);
      /* v3.13.0: paint committed text + the live draft on top of tuning */
      for (const op of E.ops) if (op.type === 'text') FX.drawTextOp(cx, cv.width, cv.height, op);
      if (E.txtEditing && E.txtEditing.isNew && E.txtEditing.op.text) FX.drawTextOp(cx, cv.width, cv.height, E.txtEditing.op);
      /* v3.14.0: while dragging a selection the "hole" must stay visible on
         the preview — the base cache does not know about it yet */
      if (E.lift) cx.drawImage(E.lift.hole, E.lift.bbox.x, E.lift.bbox.y, E.lift.bbox.w, E.lift.bbox.h);
      applyDisp();
      schedHist();
      res();
    }));
  }

  function applyDisp() {
    const cv = ed.canvas, st = ed.stage;
    const pad = 36;
    let w, h;
    if (E.fit) {
      const sc = Math.min((st.clientWidth - pad) / cv.width, (st.clientHeight - pad) / cv.height, 1.5);
      w = (cv.width * sc) + 'px'; h = (cv.height * sc) + 'px';
    } else {
      const zz = E.zoom / 100;
      w = (cv.width * zz) + 'px'; h = (cv.height * zz) + 'px';
    }
    cv.style.width = w; cv.style.height = h;
    const oc = q('#eOrig');
    if (oc && !oc.hidden) { oc.style.width = w; oc.style.height = h; }
    syncCropOverlay();
    syncTextOverlay();
    syncOverlay();
  }

  /* ---------- before / after compare (hold) ---------- */
  let comparing = false;
  function setCompare(on) {
    if (!E.open || on === comparing) return;
    comparing = on;
    const oc = q('#eOrig'), tag = q('#eOrigTag'), btn = q('#eCompare');
    if (on) {
      /* v3.13.0: hide the text wheel + typing layer while comparing */
      gizCv.hidden = true; hideTxtEdit(); ovlCv.hidden = true;
      const cv = ed.canvas;
      if (oc.width !== cv.width || oc.height !== cv.height) { oc.width = cv.width; oc.height = cv.height; }
      const ox = oc.getContext('2d');
      ox.clearRect(0, 0, oc.width, oc.height);
      ox.imageSmoothingQuality = 'high';
      ox.drawImage(E.src, 0, 0, oc.width, oc.height);
      oc.style.width = cv.style.width; oc.style.height = cv.style.height;
      oc.hidden = false; tag.hidden = false;
    } else {
      oc.hidden = true; tag.hidden = true;
      renderPreview();
    }
    if (btn) btn.classList.toggle('holding', on);
  }

  /* ---------- live RGB histogram ---------- */
  let histT = null;
  function schedHist() { if (histT) return; histT = setTimeout(() => { histT = null; drawHist(); }, 140); }
  function drawHist() {
    const hc = q('#eHist');
    if (!hc || !E.open || !E.src) return;
    const cv = ed.canvas;
    if (!cv.width || !cv.height) return;
    const sc = Math.min(1, 480 / Math.max(cv.width, cv.height));
    const t = FX.mkCanvas(Math.max(1, (cv.width * sc) | 0), Math.max(1, (cv.height * sc) | 0));
    const tx = t.getContext('2d');
    tx.drawImage(cv, 0, 0, t.width, t.height);
    let d;
    try { d = tx.getImageData(0, 0, t.width, t.height).data; } catch (e) { return; }
    const R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 16) { R[d[i]]++; G[d[i + 1]]++; B[d[i + 2]]++; }
    let mx = 1;
    for (let v = 1; v < 255; v++) { if (R[v] > mx) mx = R[v]; if (G[v] > mx) mx = G[v]; if (B[v] > mx) mx = B[v]; }
    const g = hc.getContext('2d');
    const W = hc.width, H = hc.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#191b1f';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'screen';
    const chan = (hist, col) => {
      g.beginPath();
      g.moveTo(0, H);
      for (let v = 0; v < 256; v++) g.lineTo((v / 255) * W, H - Math.min(1, hist[v] / mx) * (H - 6));
      g.lineTo(W, H);
      g.closePath();
      g.fillStyle = col;
      g.fill();
    };
    chan(R, 'rgba(235,72,72,.72)');
    chan(G, 'rgba(88,200,110,.72)');
    chan(B, 'rgba(86,140,240,.72)');
    g.globalCompositeOperation = 'source-over';
  }

  /* ---------- history ---------- */
  const snap = () => JSON.stringify({ ops: E.ops, adj: E.adj });
  function pushUndo(prevSnap) {
    E.undo.push(prevSnap || snap());
    if (E.undo.length > 40) E.undo.shift();
    E.redo.length = 0;
    updUndoBtns();
  }
  function doUndo() {
    if (!E.undo.length) return;
    E.redo.push(snap());
    const s = JSON.parse(E.undo.pop());
    E.ops = s.ops; E.adj = s.adj; E.prevAdj = { ...E.adj };
    if (E.txtEditing) discardEditing();
    E.floatSel = null; E.lift = null; E.liveShape = null;
    if (E.txtSel && !E.ops.includes(E.txtSel)) E.txtSel = null;
    resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
    renderPreview();
    scheduleEditSave();
  }
  function doRedo() {
    if (!E.redo.length) return;
    E.undo.push(snap());
    const s = JSON.parse(E.redo.pop());
    E.ops = s.ops; E.adj = s.adj; E.prevAdj = { ...E.adj };
    if (E.txtEditing) discardEditing();
    E.floatSel = null; E.lift = null; E.liveShape = null;
    if (E.txtSel && !E.ops.includes(E.txtSel)) E.txtSel = null;
    resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
    renderPreview();
    scheduleEditSave();
  }
  function updUndoBtns() {
    ed.undoBtn.disabled = !E.undo.length;
    ed.redoBtn.disabled = !E.redo.length;
  }

  function commit(op, prevSnap) {
    pushUndo(prevSnap);
    /* v3.13.0: keep text blocks LAST in the stack so a later crop/rotate/
       straighten can never clip them in the export while the preview (which
       paints text on top) stays identical */
    if (op.type === 'crop' || op.type === 'rot' || op.type === 'straighten') {
      E.ops = [...E.ops.filter((o) => o.type !== 'text'), op, ...E.ops.filter((o) => o.type === 'text')];
    } else {
      E.ops.push(op);
    }
    updFxTiles(); updUndoBtns();
    renderPreview();
    scheduleEditSave();
  }

  /* ---------- power-cut safe autosave (IndexedDB) ---------- */
  let saveT = null;
  let flashT = null;
  function scheduleEditSave() {
    if (!E.open) return;
    E.dirty = true;
    clearTimeout(saveT);
    saveT = setTimeout(saveEditSession, 900);
  }
  async function saveEditSession() {
    if (!E.open || !E.photo) return;
    const k = P.photoKey(E.photo);
    const meaningful = E.ops.length > 0 || Object.values(E.adj).some((v) => v !== 0);
    if (!meaningful) {
      await P.idbDel('edits', k).catch(() => {});
      return;
    }
    try {
      const blob = await new Promise((r) => ed.canvas.toBlob(r, 'image/jpeg', 0.86));
      if (!blob) return;
      const stickers = E.stickers.map((s) => ({ sid: s.sid, blob: s.blob }));
      await P.idbSet('edits', k, { ops: E.ops, adj: E.adj, stickers, previewBlob: blob, ts: Date.now() });
      P.invalidateThumb(E.photo);
      flashSaved();
    } catch (e) { /* storage full etc. — stay silent, the Save button still works */ }
  }
  function flashSaved() {
    if (!E.open) return;
    const c = ed.count;
    const base = `${E.idx + 1} / ${state.filtered.length}`;
    c.textContent = base + '  \u2022 auto-saved \u2713';
    clearTimeout(flashT);
    flashT = setTimeout(() => { if (E.open) c.textContent = base; }, 1700);
  }
  window.addEventListener('beforeunload', () => { if (E.open) saveEditSession(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && E.open) saveEditSession(); });

  /* ---------- tuning sliders ---------- */
  function resetAdjUI() {
    for (const [inp, lab, key] of ADJ_IDS) {
      const el = q('#' + inp);
      if (el) { el.value = E.adj[key] | 0; q('#' + lab).textContent = E.adj[key] | 0; }
    }
  }
  function wireSliders() {
    for (const [inp, lab, key] of ADJ_IDS) {
      const el = q('#' + inp);
      el.addEventListener('input', () => {
        E.adj[key] = +el.value;
        q('#' + lab).textContent = el.value;
        renderPreview();
      });
      el.addEventListener('change', () => {
        pushUndo(JSON.stringify({ ops: E.ops, adj: E.prevAdj }));
        E.prevAdj = { ...E.adj };
        scheduleEditSave();
      });
      el.addEventListener('dblclick', () => {
        if (+el.value === 0) return;
        pushUndo(JSON.stringify({ ops: E.ops, adj: E.prevAdj }));
        E.adj[key] = 0; el.value = 0; q('#' + lab).textContent = '0';
        E.prevAdj = { ...E.adj };
        renderPreview();
        scheduleEditSave();
      });
    }
  }

  /* ---------- effects grid (3 pages, Picasa style) ---------- */
  function buildFx() {
    ed.fxGrid.innerHTML = '';
    const list = FX.EFFECTS.filter((f) => (f.page || 1) === E.fxPage);
    for (const f of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fxtile'; b.textContent = f.name; b.dataset.fx = f.id;
      b.addEventListener('click', () => {
        const has = E.ops.some((o) => o.type === 'effect' && o.id === f.id);
        if (has) {
          pushUndo();
          E.ops = E.ops.filter((o) => !(o.type === 'effect' && o.id === f.id));
          updFxTiles(); updUndoBtns(); renderPreview(); scheduleEditSave();
          toast(f.name + ' removed', 'ok', 1100);
        } else {
          const sEl = q('#fxStr');
          const st = sEl && !sEl.disabled ? Math.max(0.03, Math.min(1, +sEl.value / 100)) : 1;
          commit({ type: 'effect', id: f.id, strength: st });
          toast(f.name + ' applied', 'ok', 1300);
        }
      });
      ed.fxGrid.appendChild(b);
    }
    const lab = q('#fxPageLab');
    if (lab) lab.textContent = `${E.fxPage} / 3`;
    const pv = q('#fxPrev'), nx = q('#fxNext');
    if (pv) pv.disabled = E.fxPage <= 1;
    if (nx) nx.disabled = E.fxPage >= 3;
    updFxTiles();
  }
  function updFxTiles() {
    const has = new Set(E.ops.filter((o) => o.type === 'effect').map((o) => o.id));
    qa('.fxtile').forEach((t) => t.classList.toggle('applied', has.has(t.dataset.fx)));
    syncFxStr();
  }

  /* ---------- effect intensity (v3.4.0) ---------- */
  function lastEffectIdx() {
    for (let i = E.ops.length - 1; i >= 0; i--) if (E.ops[i].type === 'effect') return i;
    return -1;
  }
  function syncFxStr() {
    const s = q('#fxStr'), v = q('#fxStrV');
    if (!s || !v) return;
    const i = lastEffectIdx();
    if (i < 0) { s.disabled = true; s.value = 100; v.textContent = '\u2014'; return; }
    s.disabled = false;
    const st = Math.round((E.ops[i].strength == null ? 1 : E.ops[i].strength) * 100);
    s.value = st; v.textContent = st + '%';
  }
  function wireFxStr() {
    const s = q('#fxStr');
    if (!s) return;
    let prevSnap = null;
    s.addEventListener('input', () => {
      const i = lastEffectIdx();
      if (i < 0) return;
      if (prevSnap === null) prevSnap = snap();
      E.pmax = 900; /* fast low-res while dragging intensity, full-res on release */
      E.ops[i].strength = Math.max(0.03, Math.min(1, +s.value / 100));
      q('#fxStrV').textContent = s.value + '%';
      renderPreview();
    });
    s.addEventListener('change', () => {
      if (prevSnap !== null) { pushUndo(prevSnap); prevSnap = null; E.pmax = 1400; renderPreview(); scheduleEditSave(); }
    });
  }

  /* ---------- fonts (system + added from PC) ---------- */
  function fontOptionsHTML(selected) {
    const sys = [
      ['"Segoe UI", sans-serif', 'Segoe UI'],
      ['Arial, sans-serif', 'Arial'],
      ['Georgia, serif', 'Georgia'],
      ['"Times New Roman", serif', 'Times New Roman'],
      ['Verdana, sans-serif', 'Verdana'],
      ['Tahoma, sans-serif', 'Tahoma'],
      ['"Trebuchet MS", sans-serif', 'Trebuchet MS'],
      ['"Courier New", monospace', 'Courier New'],
      ['Consolas, monospace', 'Consolas'],
      ['Impact, sans-serif', 'Impact'],
      ['"Comic Sans MS", cursive', 'Comic Sans MS'],
      ['"Brush Script MT", cursive', 'Brush Script MT'],
      ['"Lucida Handwriting", cursive', 'Lucida Handwriting'],
      ['"Palatino Linotype", serif', 'Palatino'],
      ['Garamond, serif', 'Garamond'],
      ['"Segoe Script", cursive', 'Segoe Script'],
      ['Aboreto, sans-serif', 'Aboreto (logo font)']
    ];
    const custom = (window.PixaFonts && window.PixaFonts.list) || [];
    let html = '';
    const opt = (v, l) => `<option value="${v.replace(/"/g, '&quot;')}"${v === selected ? ' selected' : ''}>${l}</option>`;
    for (const [v, l] of sys) html += opt(v, l);
    if (custom.length) {
      html += '<optgroup label="Fonts added from PC">';
      for (const nm of custom) html += opt(`"${nm}", sans-serif`, nm + ' \u2605');
      html += '</optgroup>';
    }
    return html;
  }

  /* ---------- tools ---------- */
  function setTool(t) {
    if ((E.tool === 'redeye' || E.tool === 'retouch') && t !== E.tool) E.pendPts = [];
    if (E.tool === 'crop' && t !== 'crop') { E.cropR = null; }
    if (E.tool === 'straighten' && t !== 'straighten' && E.draft) { E.draft = null; }
    /* v3.13.0: leaving the text tool finishes (commits) or discards the draft,
       drops the selection and hides the wheel + typing layer */
    if (E.tool === 'text' && t !== 'text') {
      commitEditing();
      E.txtSel = null;
    }
    /* v3.14.0: leaving Select stamps the pasted patch and drops the marquee;
       a pending Paint shape preview is cancelled */
    if (SEL_TOOLS[E.tool] && !(t && SEL_TOOLS[t])) {
      if (E.floatSel) stampFloat();
      clearSel();
    }
    if (E.liveShape && !PAINT_SHAPES.has(t)) E.liveShape = null;
    if (t === 'text' && !E.txtDraft) E.txtDraft = { ...TEXT0 };
    E.tool = t;
    ed.crop.hidden = !(t === 'crop' && E.cropR);
    qa('.fixbtn[data-fix]').forEach((b) => b.classList.toggle('on', b.dataset.fix === t));
    renderToolbox();
    if (E.tool === 'straighten' && E.draft) renderPreview();
    syncTextOverlay();
    syncOverlay();
  }

  function renderToolbox() {
    const tb = ed.toolBox;
    if (!E.tool) { tb.hidden = true; tb.innerHTML = ''; return; }
    tb.hidden = false;
    if (E.tool === 'crop') {
      tb.innerHTML = `
        <div class="asprow">
          <button type="button" data-ar="0">Free</button>
          <button type="button" data-ar="1">1:1</button>
          <button type="button" data-ar="${4 / 3}">4:3</button>
          <button type="button" data-ar="${3 / 4}">3:4</button>
          <button type="button" data-ar="${16 / 9}">16:9</button>
          <button type="button" data-ar="${9 / 16}">9:16</button>
          <button type="button" data-ar="${3 / 2}">4x6</button>
          <button type="button" data-ar="${5 / 7}">5x7</button>
          <button type="button" data-ar="${8 / 10}">8x10</button>
        </div>
        <div class="mrow">
          <button id="tbApply" class="btn btn-accent" type="button">Apply Crop</button>
          <button id="tbCancel" class="btn" type="button">Cancel</button>
        </div>`;
      qa('.asprow button').forEach((b) => {
        b.classList.toggle('on', Math.abs(+b.dataset.ar - E.aspect) < 0.001);
        b.addEventListener('click', () => {
          E.aspect = +b.dataset.ar;
          qa('.asprow button').forEach((x) => x.classList.toggle('on', x === b));
          if (E.aspect && E.cropR) {
            const cv = ed.canvas;
            let nh = E.cropR.w / E.aspect;
            if (E.cropR.y + nh > cv.height) nh = cv.height - E.cropR.y;
            E.cropR.h = Math.max(32, nh);
            syncCropOverlay();
          }
        });
      });
      q('#tbApply').addEventListener('click', applyCrop);
      q('#tbCancel').addEventListener('click', () => setTool(null));
    } else if (E.tool === 'redeye' || E.tool === 'retouch') {
      const label = E.tool === 'redeye' ? 'Click-drag over the red eye' : 'Click-drag over the blemish (spot) to blur it';
      tb.innerHTML = `
        <h4>${label}</h4>
        <div class="trow"><label>Brush</label><input id="tbBrush" type="range" min="6" max="40" value="${E.brush}" /><span class="val" id="tbBrushV">${E.brush}</span></div>
        <div class="mrow">
          <button id="tbDone" class="btn btn-accent" type="button">Done</button>
          <button id="tbCancel" class="btn" type="button">Cancel</button>
        </div>`;
      const br = q('#tbBrush');
      br.addEventListener('input', () => { E.brush = +br.value; q('#tbBrushV').textContent = br.value; });
      q('#tbDone').addEventListener('click', () => {
        if (E.pendPts.length) {
          commit({ type: E.tool, pts: E.pendPts });
          E.pendPts = [];
        }
        setTool(null);
      });
      q('#tbCancel').addEventListener('click', () => { E.pendPts = []; setTool(null); renderPreview(); });
    } else if (E.tool === 'text') {
      /* v3.13.0: Picasa text panel — click the photo & type directly on it.
         Controls act on the selected text block (or set defaults for the next one). */
      const td = E.txtDraft;
      const op = textTarget();
      tb.innerHTML = `
        <h4>Click on the photo &amp; type</h4>
        <div class="trow"><label>Font</label><select id="txFont" style="flex:1;height:27px;min-width:0">${fontOptionsHTML(op.font)}</select></div>
        <button id="txAddFont" class="fixbtn" type="button" style="margin:5px 0 4px">+ Add Font from PC</button>
        <div class="trow">
          <label>Style</label>
          <button id="txBold" type="button" class="fixbtn" style="width:32px;margin:0;font-weight:900">B</button>
          <button id="txItalic" type="button" class="fixbtn" style="width:32px;margin:0;font-style:italic">I</button>
          <button id="txUnder" type="button" class="fixbtn" style="width:32px;margin:0;text-decoration:underline">U</button>
          <select id="txAlign" style="flex:1;height:27px;min-width:0">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div class="trow"><label>Fill</label><input id="txColor" type="color" value="${op.color}" style="height:27px;flex:1" /></div>
        <div class="trow"><label>Outline</label><input id="txStrokeC" type="color" value="${op.stroke}" style="height:27px;width:34px;padding:0" /><input id="txStrokeW" type="range" min="0" max="12" value="${op.strokeW}" style="flex:1" /><span class="val" id="txStrokeWV">${op.strokeW}</span></div>
        <div class="trow"><label>Opacity</label><input id="txAlpha" type="range" min="10" max="100" value="${Math.round(op.alpha * 100)}" /><span class="val" id="txAlphaV">${Math.round(op.alpha * 100)}%</span></div>
        <label class="chkrow"><input type="checkbox" id="txShadow"${op.shadow ? ' checked' : ''} /> Drop shadow</label>
        <div class="mrow">
          <button id="txApply" class="btn btn-accent" type="button">Apply</button>
          <button id="txCancel" class="btn" type="button">Cancel</button>
        </div>
        <button id="txClear" class="fixbtn" type="button" style="margin-top:6px">Clear All Text</button>
        <p style="font-size:11px;color:#71747a;margin:8px 0 0;line-height:1.5">Click photo = new text • drag the pin to move • drag the ring handle to rotate &amp; resize • Enter = new line • Esc = done • Delete key removes the selected text</p>`;
      setTxUI(op);
      const grab = (id) => q(id);
      grab('#txFont').addEventListener('change', (e) => { const o = textTarget(); o.font = e.target.value; afterTextChange(); });
      grab('#txAddFont').addEventListener('click', () => q('#fontFile').click());
      const tg = (id, key) => grab(id).addEventListener('click', (e) => { const o = textTarget(); o[key] = !o[key]; e.currentTarget.style.borderColor = o[key] ? 'var(--accent)' : ''; e.currentTarget.style.background = o[key] ? '#dcebfb' : ''; afterTextChange(); });
      tg('#txBold', 'bold'); tg('#txItalic', 'italic'); tg('#txUnder', 'underline');
      grab('#txAlign').addEventListener('change', (e) => { const o = textTarget(); o.align = e.target.value; afterTextChange(); });
      grab('#txColor').addEventListener('input', (e) => { const o = textTarget(); o.color = e.target.value; afterTextChange(false); });
      grab('#txStrokeC').addEventListener('input', (e) => { const o = textTarget(); o.stroke = e.target.value; afterTextChange(false); });
      grab('#txStrokeW').addEventListener('input', (e) => { const o = textTarget(); o.strokeW = +e.target.value; grab('#txStrokeWV').textContent = e.target.value; afterTextChange(false); });
      grab('#txStrokeW').addEventListener('change', () => afterTextChange());
      grab('#txAlpha').addEventListener('input', (e) => { const o = textTarget(); o.alpha = +e.target.value / 100; grab('#txAlphaV').textContent = e.target.value + '%'; afterTextChange(false); });
      grab('#txAlpha').addEventListener('change', () => afterTextChange());
      grab('#txShadow').addEventListener('change', (e) => { const o = textTarget(); o.shadow = e.target.checked; afterTextChange(); });
      grab('#txApply').addEventListener('click', () => { commitEditing(); E.txtSel = null; setTool(null); });
      grab('#txCancel').addEventListener('click', () => { if (E.txtEditing && E.txtEditing.isNew) discardEditing(); E.txtSel = null; setTool(null); });
      grab('#txClear').addEventListener('click', clearAllText);
      document.addEventListener('pixa-fonts-updated', () => { if (E.tool === 'text') renderToolbox(); }, { once: true });
    } else if (E.tool === 'sticker') {
      const op = E.ops.filter((o) => o.type === 'sticker' && o.sid === E.stkSel).pop();
      const sc = op ? Math.round(op.scale * 100) : 32;
      const rt = op ? op.rot : 0;
      const al = op ? Math.round((op.alpha == null ? 1 : op.alpha) * 100) : 100;
      tb.innerHTML = `
        <div class="trow"><label>Size</label><input id="skScale" type="range" min="4" max="100" value="${sc}" /><span class="val" id="skScaleV">${sc}%</span></div>
        <div class="trow"><label>Rotate</label><input id="skRot" type="range" min="-180" max="180" value="${rt}" /><span class="val" id="skRotV">${rt}\u00B0</span></div>
        <div class="trow"><label>Opacity</label><input id="skAlpha" type="range" min="10" max="100" value="${al}" /><span class="val" id="skAlphaV">${al}%</span></div>
        <div class="mrow">
          <button id="skNew" class="btn" type="button">+ New Sticker</button>
          <button id="skDone" class="btn btn-accent" type="button">Done</button>
        </div>`;
      const selOp = () => E.ops.filter((o) => o.type === 'sticker' && o.sid === E.stkSel).pop();
      q('#skScale').addEventListener('input', (e) => { const o = selOp(); if (o) { o.scale = +e.target.value / 100; q('#skScaleV').textContent = e.target.value + '%'; renderPreview(); } });
      q('#skRot').addEventListener('input', (e) => { const o = selOp(); if (o) { o.rot = +e.target.value; q('#skRotV').textContent = e.target.value + '\u00B0'; renderPreview(); } });
      q('#skAlpha').addEventListener('input', (e) => { const o = selOp(); if (o) { o.alpha = +e.target.value / 100; q('#skAlphaV').textContent = e.target.value + '%'; renderPreview(); } });
      q('#skScale').addEventListener('change', scheduleEditSave);
      q('#skRot').addEventListener('change', scheduleEditSave);
      q('#skAlpha').addEventListener('change', scheduleEditSave);
      q('#skNew').addEventListener('click', () => q('#stickerFile').click());
      q('#skDone').addEventListener('click', () => setTool(null));
    } else if (E.tool === 'straighten') {
      tb.innerHTML = `
        <h4>Straighten</h4>
        <div class="trow"><label>Angle</label><input id="tbStr" type="range" min="-15" max="15" value="${E.draft ? E.draft.deg : 0}" /><span class="val" id="tbStrV">${E.draft ? E.draft.deg : 0}&deg;</span></div>
        <div class="mrow">
          <button id="tbApply" class="btn btn-accent" type="button">Apply</button>
          <button id="tbCancel" class="btn" type="button">Cancel</button>
        </div>`;
      const s = q('#tbStr');
      s.addEventListener('input', () => {
        const v = +s.value;
        q('#tbStrV').textContent = v + '\u00B0';
        E.pmax = 900; /* fast low-res while straightening */
        E.draft = { type: 'straighten', deg: v };
        renderPreview();
      });
      q('#tbApply').addEventListener('click', () => {
        if (E.draft) { const d = E.draft; E.draft = null; E.pmax = 1400; commit(d); }
        setTool(null);
      });
      q('#tbCancel').addEventListener('click', () => { E.draft = null; E.pmax = 1400; setTool(null); renderPreview(); });
    } else {
      /* v3.14.0: Paint & Select tools keep their options in their side tabs —
         no floating toolbox for them */
      tb.hidden = true; tb.innerHTML = '';
    }
  }

  /* ======================================================================
     v3.13.0 — Picasa "Text" tool
     • click the photo -> a text block opens right there and you type on it
     • every block gets the Picasa manipulator wheel:
         - centre pin  = drag to move the text
         - ring handle = drag around the ring to rotate (0-360°),
                         drag closer/farther to shrink/grow the font
     • many independent blocks, each with its own style
     • non-destructive: blocks live in E.ops like every other edit
     ====================================================================== */
  const gizCv = q('#eGiz'), txtTa = q('#eTxtEdit');
  const measCv = FX.mkCanvas(8, 8);
  const measCx = measCv.getContext('2d');
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  function textFontStr(op, fs) {
    return `${op.italic ? 'italic ' : ''}${op.bold ? '700' : '400'} ${fs}px ${op.font || '"Segoe UI", sans-serif'}`;
  }
  /* metrics in CANVAS pixel space (op.size is % of canvas height) */
  function measureTextOp(op, H) {
    const fs = Math.max(4, (op.size / 100) * H);
    measCx.font = textFontStr(op, fs);
    const lines = String(op.text || '').split('\n');
    let w = 0;
    for (const ln of lines) w = Math.max(w, measCx.measureText(ln || ' ').width);
    const lh = fs * 1.22;
    return { fs, lh, w, h: lines.length * lh, n: Math.max(1, lines.length) };
  }
  /* the op the side panel currently acts on: the block being typed, the
     selected block, or the defaults for the NEXT block */
  function textTarget() {
    if (E.txtEditing) return E.txtEditing.op;
    if (E.txtSel) return E.txtSel;
    return E.txtDraft;
  }
  function afterTextChange(save) {
    renderPreview();
    if (save !== false && (E.txtEditing || E.txtSel)) scheduleEditSave();
  }
  function setTxUI(op) {
    const g = (id) => q(id);
    if (!g('#txFont')) return;
    g('#txFont').value = op.font;
    g('#txAlign').value = op.align || 'center';
    g('#txColor').value = op.color;
    g('#txStrokeC').value = op.stroke;
    g('#txStrokeW').value = op.strokeW; g('#txStrokeWV').textContent = op.strokeW;
    g('#txAlpha').value = Math.round((op.alpha == null ? 1 : op.alpha) * 100);
    g('#txAlphaV').textContent = Math.round((op.alpha == null ? 1 : op.alpha) * 100) + '%';
    g('#txShadow').checked = !!op.shadow;
    const tog = (id, on) => { const b = g(id); if (b) { b.style.borderColor = on ? 'var(--accent)' : ''; b.style.background = on ? '#dcebfb' : ''; } };
    tog('#txBold', op.bold); tog('#txItalic', op.italic); tog('#txUnder', op.underline);
  }
  function hideTxtEdit() { txtTa.hidden = true; }
  function discardEditing() {
    E.txtEditing = null;
    hideTxtEdit();
    renderPreview();
  }
  /* finish typing: empty new block = discarded, otherwise committed */
  function commitEditing() {
    const t = E.txtEditing;
    if (!t) { hideTxtEdit(); return; }
    E.txtEditing = null;
    hideTxtEdit();
    if (t.isNew) {
      const txt = String(t.op.text || '').replace(/\s+$/, '');
      if (txt.trim()) {
        t.op.text = txt;
        pushUndo();
        E.ops.push(t.op);
        updUndoBtns();
        E.txtSel = t.op;
        renderPreview();
        scheduleEditSave();
        toast('Text added \u2014 drag the wheel to place it', 'ok', 1700);
      } else {
        renderPreview();
      }
    } else {
      if (!String(t.op.text || '').trim()) {
        pushUndo();
        E.ops = E.ops.filter((o) => o !== t.op);
        E.txtSel = null;
      }
      renderPreview();
      scheduleEditSave();
    }
  }
  function startEditing(op, isNew) {
    E.txtEditing = { op, isNew };
    E.txtSel = isNew ? null : op;
    txtTa.value = op.text || '';
    txtTa.hidden = false;
    syncTextOverlay();
    renderPreview();
    txtTa.focus();
    if (!isNew) txtTa.setSelectionRange(txtTa.value.length, txtTa.value.length);
    if (E.tool === 'text' && q('#txFont')) setTxUI(op);
  }
  function newDraftText(nx, ny) {
    const d = E.txtDraft;
    return {
      type: 'text', x: clampN(nx, 0.03, 0.97), y: clampN(ny, 0.05, 0.95),
      text: '', size: d.size, color: d.color, font: d.font, rot: 0,
      alpha: d.alpha == null ? 1 : d.alpha, bold: !!d.bold, italic: !!d.italic,
      underline: !!d.underline, stroke: d.stroke, strokeW: d.strokeW,
      shadow: !!d.shadow, align: d.align || 'center'
    };
  }
  function clearAllText() {
    if (E.txtEditing) discardEditing();
    if (!E.ops.some((o) => o.type === 'text')) { toast('No text on this photo', undefined, 1600); return; }
    pushUndo();
    E.ops = E.ops.filter((o) => o.type !== 'text');
    E.txtSel = null;
    updUndoBtns();
    renderPreview();
    scheduleEditSave();
    toast('All text removed', 'ok', 1600);
  }

  /* ---------- geometry (DISPLAY space, i.e. what you see) ---------- */
  function textDisplayGeom(op) {
    const cv = ed.canvas;
    const ds = cv.clientWidth / Math.max(1, cv.width);
    const m = measureTextOp(op, cv.height);
    return {
      cx: cv.offsetLeft + op.x * cv.clientWidth,
      cy: cv.offsetTop + op.y * cv.clientHeight,
      w: Math.max(6, m.w * ds), h: Math.max(6, m.h * ds),
      fs: m.fs * ds, lh: m.lh * ds, rot: op.rot || 0,
      r: Math.max(44, (Math.hypot(m.w, m.h) * ds) / 2 + 26)
    };
  }
  function pointInText(op, nx, ny) {
    const cv = ed.canvas;
    const m = measureTextOp(op, cv.height);
    const dx = (nx * cv.clientWidth) - (op.x * cv.clientWidth);
    const dy = (ny * cv.clientHeight) - (op.y * cv.clientHeight);
    const a = -(op.rot || 0) * Math.PI / 180;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= m.w / 2 + 10 && Math.abs(ly) <= m.h / 2 + 8;
  }
  function hitText(nx, ny) {
    for (let i = E.ops.length - 1; i >= 0; i--) {
      const op = E.ops[i];
      if (op.type === 'text' && pointInText(op, nx, ny)) return op;
    }
    if (E.txtEditing && E.txtEditing.isNew && pointInText(E.txtEditing.op, nx, ny)) return E.txtEditing.op;
    return null;
  }

  /* ---------- the manipulator wheel ---------- */
  function drawGizmo() {
    const st = ed.stage;
    const dpr = window.devicePixelRatio || 1;
    const W = st.clientWidth, H = st.clientHeight;
    if (!W || !H) return;
    if (gizCv.width !== Math.round(W * dpr) || gizCv.height !== Math.round(H * dpr)) {
      gizCv.width = Math.round(W * dpr); gizCv.height = Math.round(H * dpr);
    }
    const g = gizCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const op = (E.txtEditing && E.txtEditing.op) || E.txtSel;
    if (!op) return;
    const gm = textDisplayGeom(op);
    const rad = gm.rot * Math.PI / 180;
    const hx = gm.cx + Math.cos(rad) * gm.r, hy = gm.cy + Math.sin(rad) * gm.r;
    /* dashed bounding box (rotated) */
    g.save();
    g.translate(gm.cx, gm.cy); g.rotate(rad);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.strokeRect(-gm.w / 2 - 4, -gm.h / 2 - 4, gm.w + 8, gm.h + 8);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2;
    g.strokeRect(-gm.w / 2 - 4, -gm.h / 2 - 4, gm.w + 8, gm.h + 8);
    g.restore();
    /* spoke from centre to the ring handle */
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(gm.cx, gm.cy); g.lineTo(hx, hy); g.stroke();
    /* outer ring — dark + light double stroke so it reads on any photo */
    for (const [col, lw] of [['rgba(0,0,0,.4)', 3.4], ['rgba(255,255,255,.9)', 1.6]]) {
      g.strokeStyle = col; g.lineWidth = lw;
      g.beginPath(); g.arc(gm.cx, gm.cy, gm.r, 0, Math.PI * 2); g.stroke();
    }
    /* centre pin = move */
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.beginPath(); g.arc(gm.cx, gm.cy, 7.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(gm.cx, gm.cy, 5.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f7fd1';
    g.beginPath(); g.arc(gm.cx, gm.cy, 2.6, 0, Math.PI * 2); g.fill();
    /* ring handle = rotate + scale */
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.beginPath(); g.arc(hx, hy, 9.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(hx, hy, 7.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f7fd1';
    g.beginPath(); g.arc(hx, hy, 4, 0, Math.PI * 2); g.fill();
  }
  /* position the wheel canvas + the on-canvas typing box */
  function syncTextOverlay() {
    const active = E.open && E.tool === 'text' && !comparing;
    gizCv.classList.toggle('live', active);
    if (!active) { gizCv.hidden = true; hideTxtEdit(); return; }
    gizCv.hidden = false;
    gizCv.style.left = '0px'; gizCv.style.top = '0px';
    gizCv.style.width = ed.stage.clientWidth + 'px';
    gizCv.style.height = ed.stage.clientHeight + 'px';
    drawGizmo();
    if (E.txtEditing) {
      const op = E.txtEditing.op;
      const m = measureTextOp(op, ed.canvas.height);
      const ds = ed.canvas.clientWidth / Math.max(1, ed.canvas.width);
      const gm = textDisplayGeom(op);
      txtTa.style.left = gm.cx + 'px';
      txtTa.style.top = gm.cy + 'px';
      txtTa.style.width = Math.max(130, m.w * ds + 22) + 'px';
      txtTa.style.height = Math.max(m.lh * ds, m.h * ds + 4) + 'px';
      txtTa.style.transform = `translate(-50%,-50%) rotate(${gm.rot}deg)`;
      txtTa.style.font = textFontStr(op, m.fs * ds);
      txtTa.style.lineHeight = '1.22';
      txtTa.style.textAlign = op.align || 'center';
      txtTa.style.caretColor = op.color || '#fff';
    } else {
      hideTxtEdit();
    }
  }

  /* ---------- gestures on the wheel ---------- */
  let txG = null; /* { mode:'move'|'wheel', op, ox, oy, rot0, size0, ang0, dist0, committed } */
  function gizPt(e) {
    const r = gizCv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function normPt(p) {
    const cv = ed.canvas;
    return {
      nx: clampN((p.x - cv.offsetLeft) / Math.max(1, cv.clientWidth), 0, 1),
      ny: clampN((p.y - cv.offsetTop) / Math.max(1, cv.clientHeight), 0, 1)
    };
  }
  gizCv.addEventListener('pointerdown', (e) => {
    if (!E.open || E.tool !== 'text' || comparing) return;
    e.preventDefault();
    try { gizCv.setPointerCapture(e.pointerId); } catch (err) {}
    const p = gizPt(e);
    /* typing? clicking anywhere else finishes the current block first */
    if (E.txtEditing) commitEditing();
    const cur = (E.txtEditing && E.txtEditing.op) || E.txtSel;
    if (cur) {
      const gm = textDisplayGeom(cur);
      const rad = gm.rot * Math.PI / 180;
      const hx = gm.cx + Math.cos(rad) * gm.r, hy = gm.cy + Math.sin(rad) * gm.r;
      if (Math.hypot(p.x - hx, p.y - hy) < 17) {
        /* ring handle: angle rotates, radial distance scales the font */
        pushUndo();
        txG = { mode: 'wheel', op: cur, committed: E.ops.includes(cur), rot0: cur.rot || 0, size0: cur.size, ang0: Math.atan2(p.y - gm.cy, p.x - gm.cx), dist0: Math.max(8, Math.hypot(p.x - gm.cx, p.y - gm.cy)) };
        return;
      }
      if (Math.hypot(p.x - gm.cx, p.y - gm.cy) < 20) {
        pushUndo();
        const { nx, ny } = normPt(p);
        txG = { mode: 'move', op: cur, committed: E.ops.includes(cur), ox: nx - cur.x, oy: ny - cur.y };
        return;
      }
    }
    const { nx, ny } = normPt(p);
    const hit = hitText(nx, ny);
    if (hit) {
      E.txtSel = hit;
      if (E.tool === 'text' && q('#txFont')) setTxUI(hit);
      pushUndo();
      txG = { mode: 'move', op: hit, committed: E.ops.includes(hit), ox: nx - hit.x, oy: ny - hit.y };
      drawGizmo();
      return;
    }
    /* empty spot -> a brand-new block opens right there, ready to type */
    const op = newDraftText(nx, ny);
    startEditing(op, true);
  });
  gizCv.addEventListener('pointermove', (e) => {
    if (!txG) return;
    e.preventDefault();
    const p = gizPt(e);
    if (txG.mode === 'move') {
      const { nx, ny } = normPt(p);
      txG.op.x = clampN(nx - txG.ox, 0.02, 0.98);
      txG.op.y = clampN(ny - txG.oy, 0.04, 0.96);
      renderPreview();
      drawGizmo();
    } else {
      const gm = textDisplayGeom(txG.op);
      const ang = Math.atan2(p.y - gm.cy, p.x - gm.cx);
      const dist = Math.max(8, Math.hypot(p.x - gm.cx, p.y - gm.cy));
      let rot = txG.rot0 + ((ang - txG.ang0) * 180) / Math.PI;
      rot = ((rot + 540) % 360) - 180;
      txG.op.rot = Math.round(rot * 10) / 10;
      txG.op.size = clampN((txG.size0 * dist) / txG.dist0, 1.5, 60);
      renderPreview();
      drawGizmo();
    }
  });
  ['pointerup', 'pointercancel'].forEach((ev) => gizCv.addEventListener(ev, () => {
    if (!txG) return;
    const wasCommitted = txG.committed;
    txG = null;
    renderPreview();
    if (wasCommitted) scheduleEditSave();
  }));
  /* wheel over the selected block nudges the size too */
  gizCv.addEventListener('wheel', (e) => {
    if (!E.open || E.tool !== 'text') return;
    const op = (E.txtEditing && E.txtEditing.op) || E.txtSel;
    if (!op) return;
    e.preventDefault();
    op.size = clampN(op.size * (e.deltaY < 0 ? 1.07 : 0.935), 1.5, 60);
    renderPreview();
    syncTextOverlay();
    scheduleEditSave();
  }, { passive: false });
  /* double-click an existing block to re-edit its words */
  gizCv.addEventListener('dblclick', (e) => {
    if (!E.open || E.tool !== 'text' || comparing) return;
    const { nx, ny } = normPt(gizPt(e));
    const hit = hitText(nx, ny);
    if (hit && !E.txtEditing) {
      pushUndo();
      startEditing(hit, false);
    }
  });

  /* ---------- on-canvas typing ---------- */
  txtTa.addEventListener('input', () => {
    if (!E.txtEditing) return;
    E.txtEditing.op.text = txtTa.value;
    renderPreview();
    syncTextOverlay();
  });
  txtTa.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); commitEditing(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEditing(); }
  });
  txtTa.addEventListener('blur', (e) => {
    if (!E.txtEditing) return;
    /* clicking the side panel keeps the editor open so styles can be
       changed while typing — clicking anywhere else commits */
    const to = e.relatedTarget;
    if (to && ed.toolBox.contains(to)) return;
    commitEditing();
  });

  /* ---------- crop ---------- */
  function startCrop() {
    const cv = ed.canvas;
    E.aspect = 0;
    E.cropR = { x: cv.width * 0.1, y: cv.height * 0.1, w: cv.width * 0.8, h: cv.height * 0.8 };
    setTool('crop');
    syncCropOverlay();
  }
  function syncCropOverlay() {
    if (E.tool !== 'crop' || !E.cropR) { ed.crop.hidden = true; return; }
    const cv = ed.canvas;
    const ds = cv.clientWidth / cv.width;
    ed.crop.hidden = false;
    ed.crop.style.left = (cv.offsetLeft + E.cropR.x * ds) + 'px';
    ed.crop.style.top = (cv.offsetTop + E.cropR.y * ds) + 'px';
    ed.crop.style.width = (E.cropR.w * ds) + 'px';
    ed.crop.style.height = (E.cropR.h * ds) + 'px';
  }
  function applyCrop() {
    const cv = ed.canvas;
    if (!E.cropR || E.cropR.w < 24 || E.cropR.h < 24) { setTool(null); return; }
    commit({
      type: 'crop',
      x: E.cropR.x / cv.width, y: E.cropR.y / cv.height,
      w: E.cropR.w / cv.width, h: E.cropR.h / cv.height
    });
    setTool(null);
  }

  let drag = null;
  ed.crop.addEventListener('pointerdown', (e) => {
    if (E.tool !== 'crop') return;
    drag = { h: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, r: { ...E.cropR } };
    e.preventDefault();
    try { ed.crop.setPointerCapture(e.pointerId); } catch (err) {}
  });
  ed.crop.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const cv = ed.canvas;
    const ds = cv.clientWidth / cv.width;
    const dxi = (e.clientX - drag.sx) / ds;
    const dyi = (e.clientY - drag.sy) / ds;
    const W = cv.width, H = cv.height;
    const r = { ...drag.r };
    const h = drag.h;
    if (h === 'move') {
      r.x = clamp(r.x + dxi, 0, W - r.w);
      r.y = clamp(r.y + dyi, 0, H - r.h);
    } else {
      if (h.indexOf('w') >= 0) { const nx = clamp(r.x + dxi, 0, r.x + r.w - 32); r.w = r.w + (r.x - nx); r.x = nx; }
      if (h.indexOf('e') >= 0) { r.w = clamp(r.w + dxi, 32, W - r.x); }
      if (h.indexOf('n') >= 0) { const ny = clamp(r.y + dyi, 0, r.y + r.h - 32); r.h = r.h + (r.y - ny); r.y = ny; }
      if (h.indexOf('s') >= 0) { r.h = clamp(r.h + dyi, 32, H - r.y); }
      if (E.aspect) {
        if (h === 'n' || h === 's') {
          const nw = clamp(r.h * E.aspect, 32, W);
          const cx0 = r.x + r.w / 2;
          r.w = nw;
          r.x = clamp(cx0 - r.w / 2, 0, W - r.w);
        } else {
          const nh = clamp(r.w / E.aspect, 32, H);
          if (h.indexOf('n') >= 0) r.y = clamp(r.y + (r.h - nh), 0, H - nh);
          else if (r.y + nh > H) r.y = H - nh;
          r.h = nh;
        }
      }
    }
    E.cropR = r;
    syncCropOverlay();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => ed.crop.addEventListener(ev, () => { drag = null; }));

  /* ---------- brush (redeye / retouch) ---------- */
  let stroking = false;
  function strokeAt(e) {
    const cv = ed.canvas;
    const r = cv.getBoundingClientRect();
    const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
    const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
    const nr = E.brush / Math.min(r.width, r.height);
    const ctx = cv.getContext('2d');
    if (E.tool === 'redeye') FX.redeyePt(ctx, cv.width, cv.height, nx, ny, nr);
    else FX.retouchPt(ctx, cv.width, cv.height, nx, ny, nr);
    E.pendPts.push({ x: nx, y: ny, r: nr });
  }

  /* ---------- stickers ---------- */
  function stickerHit(nx, ny) {
    const cv = ed.canvas;
    for (let i = E.ops.length - 1; i >= 0; i--) {
      const o = E.ops[i];
      if (o.type !== 'sticker') continue;
      const s = E.stickers.find((x) => x.sid === o.sid);
      if (!s) continue;
      const hh = (o.scale || 0.3) / 2;
      const hw = hh * (s.bmp.width / s.bmp.height) * (cv.height / Math.max(1, cv.width));
      if (Math.abs(nx - o.x) <= hw * 1.2 && Math.abs(ny - o.y) <= hh * 1.2) return o;
    }
    return null;
  }
  let dragStk = null;
  async function addSticker(blob) {
    let bmp = null;
    try { bmp = await createImageBitmap(blob); }
    catch (e1) {
      bmp = await new Promise((res, rej) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 8000); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode fail')); };
        img.src = url;
      }).catch(() => null);
    }
    if (!bmp) { toast('This sticker file could not be opened (try PNG/WebP/GIF)', 'err'); return; }
    const sid = ++E.stkSeq;
    E.stickers.push({ sid, bmp, blob });
    E.stkSel = sid;
    pushUndo();
    E.ops.push({ type: 'sticker', sid, x: 0.5, y: 0.45, scale: 0.32, rot: 0, alpha: 1 });
    updUndoBtns();
    setTool('sticker');
    renderPreview();
    scheduleEditSave();
    toast('Sticker added', 'ok', 2000);
  }
  q('#stickerFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) addSticker(f);
  });

  /* ---------- canvas pointer: text position + sticker drag ---------- */
  ed.canvas.addEventListener('pointerdown', (e) => {
    if (!E.open) return;
    /* v3.14.0 Paint: strokes, bucket and picker live here (shapes & select
       go through the #eOvl overlay above the canvas) */
    if (PAINT_STROKES.includes(E.tool)) {
      e.preventDefault();
      try { ed.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      strokeBegin(e);
      return;
    }
    if (E.tool === 'fill') { e.preventDefault(); bucketAt(e); return; }
    if (E.tool === 'picker') { e.preventDefault(); pickColor(e); return; }
    if (E.tool === 'redeye' || E.tool === 'retouch') {
      stroking = true;
      try { ed.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      strokeAt(e);
    } else if (E.tool === 'sticker') {
      const cv = ed.canvas;
      const r = cv.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
      const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
      const hit = stickerHit(nx, ny) || E.ops.filter((o) => o.type === 'sticker' && o.sid === E.stkSel).pop();
      if (!hit) return;
      E.stkSel = hit.sid;
      pushUndo();
      E.pmax = 900; /* fast low-res while dragging the sticker */
      dragStk = { op: hit, ox: hit.x - nx, oy: hit.y - ny };
      try { ed.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    }
  });
  ed.canvas.addEventListener('pointermove', (e) => {
    if (pnStroke) { strokeMove(e); return; }
    if (stroking) { strokeAt(e); return; }
    if (dragStk) {
      const cv = ed.canvas;
      const r = cv.getBoundingClientRect();
      dragStk.op.x = clamp((e.clientX - r.left) / r.width, 0, 1);
      dragStk.op.y = clamp((e.clientY - r.top) / r.height, 0, 1);
      renderPreview();
    }
  });
  ['pointerup', 'pointercancel'].forEach((ev) => ed.canvas.addEventListener(ev, () => {
    if (pnStroke) { strokeEnd(); return; }
    stroking = false;
    if (dragStk) { dragStk = null; E.pmax = 1400; renderPreview(); scheduleEditSave(); }
  }));

  /* ---------- auto fixes ---------- */
  function autoContrast() {
    const c = FX.renderStack(E.src, E.ops, null, 900, stickerMap());
    const { lo, hi } = FX.computeLevels(c);
    commit({ type: 'autocontrast', lo, hi });
    toast('Auto Contrast applied', 'ok', 1500);
  }
  function autoColor() {
    const c = FX.renderStack(E.src, E.ops, null, 900, stickerMap());
    const wb = FX.computeWB(c);
    commit({ type: 'autocolor', gr: wb.gr, gg: wb.gg, gb: wb.gb });
    toast('Auto Color applied', 'ok', 1500);
  }
  function feelingLucky() {
    const c = FX.renderStack(E.src, E.ops, null, 900, stickerMap());
    const { lo, hi } = FX.computeLevels(c);
    const wb = FX.computeWB(c);
    pushUndo();
    E.ops.push({ type: 'autocontrast', lo, hi }, { type: 'autocolor', gr: wb.gr, gg: wb.gg, gb: wb.gb });
    updFxTiles(); updUndoBtns();
    renderPreview(); scheduleEditSave();
    toast("I'm Feeling Lucky", 'ok', 1500);
  }

  /* ======================================================================
     v3.14.0 — PAINT (Windows-11-Paint style) & SELECT (Windows style)
     Paint: pencil / brush / eraser strokes, flood fill, colour picker and
     6 shapes with Color 1 (outline) / Color 2 (fill) — all non-destructive
     ops rendered by fx.js, with undo/redo and autosave included.
     Select: rectangle, lasso and magic-wand (colour) selections; copy,
     cut, delete (fills the hole with the surrounding colour — removes
     text and objects), paste as a floating draggable patch, and
     drag-inside-to-move. Selection edits are committed as full-resolution
     'patch' ops, so Save exports exactly what you see.
     ====================================================================== */
  const ovlCv = q('#eOvl');

  const cvPtN = (e) => {
    const r = ed.canvas.getBoundingClientRect();
    return { nx: clamp((e.clientX - r.left) / r.width, 0, 1), ny: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };
  const ovlPt = (e) => {
    const r = ovlCv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  }

  /* ---------- side panels: palette, size, colors, tolerance ---------- */
  const PALETTE = [
    '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
    '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'
  ];
  (function buildPaintPanel() {
    const pal = q('#pnPal');
    if (!pal) return;
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button'; b.style.background = c; b.title = c;
      b.addEventListener('click', () => { E.paint.c1 = c; q('#pnC1').value = c; });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); E.paint.c2 = c; q('#pnC2').value = c; });
      pal.appendChild(b);
    }
    q('#pnSize').addEventListener('input', (e) => { E.paint.size = +e.target.value; q('#pnSizeV').textContent = e.target.value; });
    q('#pnC1').addEventListener('input', (e) => { E.paint.c1 = e.target.value; });
    q('#pnC2').addEventListener('input', (e) => { E.paint.c2 = e.target.value; });
    q('#pnSwap').addEventListener('click', () => {
      const t = E.paint.c1; E.paint.c1 = E.paint.c2; E.paint.c2 = t;
      q('#pnC1').value = E.paint.c1; q('#pnC2').value = E.paint.c2;
    });
    q('#pnNoFill').addEventListener('change', (e) => { E.paint.noFill = e.target.checked; });
    const st = q('#selTol');
    if (st) st.addEventListener('input', (e) => { E.wandTol = +e.target.value; q('#selTolV').textContent = e.target.value; });
  })();

  /* ---------- Paint: live strokes on the preview canvas ---------- */
  let pnStroke = null;
  function strokeBegin(e) {
    const { nx, ny } = cvPtN(e);
    pnStroke = {
      tool: E.tool,
      color: E.tool === 'eraser' ? E.paint.c2 : E.paint.c1,
      size: E.paint.size,
      pts: [[nx, ny]],
      snap: snap()
    };
    drawLiveSeg();
  }
  function drawLiveSeg() {
    const cv = ed.canvas, cx = cv.getContext('2d');
    const lw = Math.max(1, (pnStroke.size / 100) * Math.min(cv.width, cv.height));
    cx.save();
    cx.strokeStyle = pnStroke.color; cx.fillStyle = pnStroke.color;
    cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.lineWidth = lw;
    const p = pnStroke.pts;
    if (p.length === 1) {
      cx.beginPath();
      cx.arc(p[0][0] * cv.width, p[0][1] * cv.height, lw / 2, 0, Math.PI * 2);
      cx.fill();
    } else {
      const a = p[p.length - 2], b = p[p.length - 1];
      cx.beginPath();
      cx.moveTo(a[0] * cv.width, a[1] * cv.height);
      cx.lineTo(b[0] * cv.width, b[1] * cv.height);
      cx.stroke();
    }
    cx.restore();
  }
  function strokeMove(e) {
    const { nx, ny } = cvPtN(e);
    const last = pnStroke.pts[pnStroke.pts.length - 1];
    if (Math.hypot(nx - last[0], ny - last[1]) < 0.0015) return;
    pnStroke.pts.push([nx, ny]);
    drawLiveSeg();
  }
  function strokeEnd() {
    if (!pnStroke) return;
    const op = { type: 'paint', tool: pnStroke.tool, pts: pnStroke.pts, color: pnStroke.color, size: pnStroke.size, alpha: 1 };
    const s = pnStroke.snap;
    pnStroke = null;
    commit(op, s);
  }
  function bucketAt(e) {
    const { nx, ny } = cvPtN(e);
    const cv = ed.canvas;
    const s = snap();
    const ok = FX.floodFillCanvas(cv.getContext('2d'), cv, nx, ny, E.paint.c1, 30);
    if (ok) commit({ type: 'fill', x: nx, y: ny, color: E.paint.c1, tol: 30 }, s);
  }
  function pickColor(e) {
    const { nx, ny } = cvPtN(e);
    const cv = ed.canvas;
    try {
      const d = cv.getContext('2d').getImageData(Math.round(nx * (cv.width - 1)), Math.round(ny * (cv.height - 1)), 1, 1).data;
      const hex = rgbToHex(d[0], d[1], d[2]);
      E.paint.c1 = hex;
      q('#pnC1').value = hex;
      toast('Color picked: ' + hex, 'ok', 1300);
    } catch (err) {}
  }

  /* ---------- Select: marquee, wand, copy/cut/delete/paste/move ---------- */
  let ovDrag = null; /* active overlay drag { mode, ... } */
  let antPhase = 0;
  setInterval(() => {
    if (E.open && (E.sel || E.floatSel || E.lift || ovDrag)) { antPhase = (antPhase + 1) % 12; drawOverlay(); }
  }, 130);

  function updSelUI() {
    const has = !!E.sel;
    ['selCopy', 'selCut', 'selDel'].forEach((id) => { const b = q('#' + id); if (b) b.disabled = !has; });
    const pb = q('#selPaste'); if (pb) pb.disabled = !E.clipboard;
    const db = q('#selDeselect');
    if (db) { db.disabled = !has && !E.floatSel; db.textContent = E.floatSel ? 'Apply Patch (Esc)' : 'Deselect (Esc)'; }
  }
  function clearSel() {
    E.sel = null;
    drawOverlay();
    updSelUI();
  }
  /* mask canvases: white = selected, built at preview-canvas resolution */
  function maskFromRect(rc) {
    const cv = ed.canvas;
    const m = FX.mkCanvas(cv.width, cv.height);
    const mx = m.getContext('2d');
    mx.fillStyle = '#fff';
    mx.fillRect(rc.x, rc.y, rc.w, rc.h);
    return m;
  }
  function maskFromPath(pts /* stage px */) {
    const cv = ed.canvas;
    const m = FX.mkCanvas(cv.width, cv.height);
    const mx = m.getContext('2d');
    const ox = cv.offsetLeft, oy = cv.offsetTop;
    const ds = cv.clientWidth / Math.max(1, cv.width);
    mx.fillStyle = '#fff';
    mx.beginPath();
    pts.forEach((p, i) => {
      const X = (p.x - ox) / ds, Y = (p.y - oy) / ds;
      if (i === 0) mx.moveTo(X, Y); else mx.lineTo(X, Y);
    });
    mx.closePath();
    mx.fill();
    return m;
  }
  function wandMask(nx, ny) {
    const cv = ed.canvas, W = cv.width, H = cv.height;
    let d;
    try { d = cv.getContext('2d').getImageData(0, 0, W, H).data; } catch (e) { return null; }
    const sx = Math.round(nx * (W - 1)), sy = Math.round(ny * (H - 1));
    const i0 = (sy * W + sx) * 4;
    const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2];
    const t = E.wandTol * 2.42, t2 = t * t * 3;
    const match = (i) => {
      const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
      return dr * dr + dg * dg + db * db <= t2;
    };
    const mask = new Uint8Array(W * H);
    const stack = [[sx, sy]];
    let minX = sx, minY = sy, maxX = sx, maxY = sy, count = 0;
    while (stack.length) {
      let [x, y] = stack.pop();
      const row = y * W;
      while (x >= 0 && !mask[row + x] && match((row + x) * 4)) x--;
      x++;
      let up = false, dn = false;
      while (x < W && !mask[row + x] && match((row + x) * 4)) {
        const idx = row + x;
        mask[idx] = 1; count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (y > 0) { const u = match((idx - W) * 4) && !mask[idx - W]; if (u && !up) { stack.push([x, y - 1]); up = true; } else if (!u) up = false; }
        if (y < H - 1) { const v = match((idx + W) * 4) && !mask[idx + W]; if (v && !dn) { stack.push([x, y + 1]); dn = true; } else if (!v) dn = false; }
        x++;
      }
    }
    if (!count) return null;
    const m = FX.mkCanvas(W, H);
    const mx = m.getContext('2d');
    const img = mx.createImageData(W, H);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) { const o = i * 4; img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = 255; }
    }
    mx.putImageData(img, 0, 0);
    return { mcv: m, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
  }

  /* full-resolution patch pieces for the current selection */
  function sampleRingColor(full, bx, by, bw, bh) {
    const W = full.width, H = full.height;
    const gx = Math.max(0, bx - 10), gy = Math.max(0, by - 10);
    const gw = Math.min(W, bx + bw + 10) - gx, gh = Math.min(H, by + bh + 10) - gy;
    if (gw <= 0 || gh <= 0) return '#808080';
    let d;
    try { d = full.getContext('2d').getImageData(gx, gy, gw, gh).data; } catch (e) { return '#808080'; }
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = 0; yy < gh; yy += 2) {
      for (let xx = 0; xx < gw; xx += 2) {
        const X = gx + xx, Y = gy + yy;
        if (X >= bx && X < bx + bw && Y >= by && Y < by + bh) continue;
        const i = (yy * gw + xx) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    if (!n) return '#808080';
    return rgbToHex(r / n, g / n, b / n);
  }
  async function buildPatchParts() {
    const cv = ed.canvas;
    const b = E.sel.bbox;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const full = FX.renderStack(E.src, E.ops, E.adj, 0, stickerMap());
      let bx = Math.max(0, Math.round((b.x / cv.width) * full.width));
      let by = Math.max(0, Math.round((b.y / cv.height) * full.height));
      let fw = Math.max(1, Math.round((b.w / cv.width) * full.width));
      let fh = Math.max(1, Math.round((b.h / cv.height) * full.height));
      fw = Math.min(fw, full.width - bx); fh = Math.min(fh, full.height - by);
      if (fw < 2 || fh < 2) throw new Error('empty selection');
      const mask = FX.mkCanvas(fw, fh);
      /* v3.14.0 fix: crop the bbox SUB-REGION out of the full-size mask and
         scale it to the patch size — drawing the whole mask squashed the
         selection rect into a corner of the patch */
      mask.getContext('2d').drawImage(E.sel.mcv, b.x, b.y, b.w, b.h, 0, 0, fw, fh);
      const bg = sampleRingColor(full, bx, by, fw, fh);
      return { full, bx, by, fw, fh, mask, bg, sx: bx / full.width, sy: by / full.height, sw: fw / full.width, sh: fh / full.height };
    } finally { setBusy(false); }
  }
  async function addPatch(cv2) {
    const sid = ++E.stkSeq;
    const blob = await new Promise((r) => cv2.toBlob(r, 'image/png'));
    E.stickers.push({ sid, bmp: cv2, blob });
    return sid;
  }
  function makeHole(P0) {
    const hole = FX.mkCanvas(P0.fw, P0.fh);
    const hx = hole.getContext('2d');
    hx.fillStyle = P0.bg;
    hx.fillRect(0, 0, P0.fw, P0.fh);
    hx.globalCompositeOperation = 'destination-in';
    try { hx.filter = 'blur(0.6px)'; } catch (e) {}
    hx.drawImage(P0.mask, 0, 0);
    return hole;
  }
  function makeContent(P0) {
    const cont = FX.mkCanvas(P0.fw, P0.fh);
    const cx = cont.getContext('2d');
    cx.drawImage(P0.full, P0.bx, P0.by, P0.fw, P0.fh, 0, 0, P0.fw, P0.fh);
    cx.globalCompositeOperation = 'destination-in';
    try { cx.filter = 'blur(0.6px)'; } catch (e) {}
    cx.drawImage(P0.mask, 0, 0);
    return cont;
  }
  async function deleteSelection() {
    if (!E.sel || E.busySel) return;
    E.busySel = true;
    try {
      const P0 = await buildPatchParts();
      const hole = makeHole(P0);
      const sid = await addPatch(hole);
      commit({ type: 'patch', sid, x: P0.sx, y: P0.sy, w: P0.sw, h: P0.sh });
      clearSel();
      toast('Removed — hole filled with the surrounding colour', 'ok', 2200);
    } catch (e) { toast('Could not process the selection', 'err', 2500); }
    finally { E.busySel = false; }
  }
  async function copySelection(cut) {
    if (!E.sel || E.busySel) return;
    E.busySel = true;
    try {
      const P0 = await buildPatchParts();
      const cont = makeContent(P0);
      E.clipboard = { cv: cont };
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          const blob = await new Promise((r) => cont.toBlob(r, 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        }
      } catch (e) { /* system clipboard is optional */ }
      if (!cut) { updSelUI(); toast('Copied — Paste puts it anywhere (also on your clipboard)', 'ok', 2400); return; }
      const hole = makeHole(P0);
      const sid = await addPatch(hole);
      commit({ type: 'patch', sid, x: P0.sx, y: P0.sy, w: P0.sw, h: P0.sh });
      clearSel();
      toast('Cut — Paste it anywhere', 'ok', 2000);
    } catch (e) { toast('Could not process the selection', 'err', 2500); }
    finally { E.busySel = false; }
  }
  function pasteClipboard() {
    if (!E.clipboard) return;
    const cv = ed.canvas;
    let w = E.clipboard.cv.width / cv.width, h = E.clipboard.cv.height / cv.height;
    const k = Math.min(1, 0.92 / Math.max(w, h));
    w *= k; h *= k;
    E.floatSel = { cv: E.clipboard.cv, x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    if (!SEL_TOOLS[E.tool]) setTool('selrect');
    drawOverlay(); updSelUI();
    toast('Pasted — drag it, then Apply Patch (Esc / click outside)', 'ok', 2600);
  }
  async function stampFloat() {
    const fl = E.floatSel;
    if (!fl || E.busySel) return;
    E.floatSel = null;
    E.busySel = true;
    try {
      const sid = await addPatch(fl.cv);
      commit({ type: 'patch', sid, x: fl.x, y: fl.y, w: fl.w, h: fl.h });
      updSelUI();
      toast('Pasted in place', 'ok', 1500);
    } finally { E.busySel = false; }
  }
  async function liftSelection(p) {
    if (E.busySel) return;
    E.busySel = true;
    try {
      const P0 = await buildPatchParts();
      const hole = makeHole(P0);
      const cont = makeContent(P0);
      const cv = ed.canvas;
      const b = E.sel.bbox;
      /* paint the hole straight onto the preview so the original pixels
         vanish under the moving copy (a re-render restores them anyway) */
      cv.getContext('2d').drawImage(hole, b.x, b.y, b.w, b.h);
      const n = normPt(p);
      E.lift = {
        hole, cont,
        x0: P0.sx, y0: P0.sy, w: P0.sw, h: P0.sh,
        x: P0.sx, y: P0.sy,
        bbox: b,
        grabNx: n.nx - P0.sx, grabNy: n.ny - P0.sy,
        snap: snap()
      };
      drawOverlay();
    } finally { E.busySel = false; }
  }
  async function dropLift() {
    const L = E.lift;
    if (!L) return;
    E.lift = null;
    E.busySel = true;
    try {
      const sidH = await addPatch(L.hole);
      const sidC = await addPatch(L.cont);
      pushUndo(L.snap);
      E.ops.push({ type: 'patch', sid: sidH, x: L.x0, y: L.y0, w: L.w, h: L.h });
      E.ops.push({ type: 'patch', sid: sidC, x: L.x, y: L.y, w: L.w, h: L.h });
      updFxTiles(); updUndoBtns();
      renderPreview(); scheduleEditSave();
      clearSel();
      toast('Moved', 'ok', 1200);
    } finally { E.busySel = false; }
  }

  /* ---------- overlay canvas: shape preview + marquees + float ---------- */
  function syncOverlay() {
    const active = E.open && !comparing &&
      (PAINT_SHAPES.has(E.tool) || !!SEL_TOOLS[E.tool] || !!E.floatSel || !!E.lift);
    ovlCv.hidden = !active;
    ovlCv.classList.toggle('live', active);
    if (!active) return;
    ovlCv.style.left = '0px'; ovlCv.style.top = '0px';
    ovlCv.style.width = ed.stage.clientWidth + 'px';
    ovlCv.style.height = ed.stage.clientHeight + 'px';
    drawOverlay();
  }
  function dashRect(g, x, y, w, h) {
    if (w < 2 || h < 2) return;
    g.save();
    g.setLineDash([6, 4]); g.lineDashOffset = -antPhase;
    g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 2.4;
    g.strokeRect(x, y, w, h);
    g.setLineDash([6, 4]); g.lineDashOffset = -antPhase - 5;
    g.strokeStyle = '#fff'; g.lineWidth = 1.2;
    g.strokeRect(x, y, w, h);
    g.restore();
  }
  function dashPath(g, pts, close) {
    g.save();
    g.setLineDash([5, 4]); g.lineDashOffset = -antPhase;
    g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 2.2;
    g.beginPath();
    pts.forEach((p, i) => { if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
    if (close) g.closePath();
    g.stroke();
    g.setLineDash([5, 4]); g.lineDashOffset = -antPhase - 4;
    g.strokeStyle = '#fff'; g.lineWidth = 1.1;
    g.stroke();
    g.restore();
  }
  function drawOverlay() {
    if (ovlCv.hidden) return;
    const st = ed.stage;
    const dpr = window.devicePixelRatio || 1;
    const W = st.clientWidth, H = st.clientHeight;
    if (!W || !H) return;
    if (ovlCv.width !== Math.round(W * dpr) || ovlCv.height !== Math.round(H * dpr)) {
      ovlCv.width = Math.round(W * dpr); ovlCv.height = Math.round(H * dpr);
    }
    const g = ovlCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cv = ed.canvas;
    const ox = cv.offsetLeft, oy = cv.offsetTop;
    const dw = cv.clientWidth, dh = cv.clientHeight;
    /* live shape preview */
    if (E.liveShape) {
      g.save(); g.translate(ox, oy);
      FX.drawShapeOp(g, dw, dh, E.liveShape);
      g.restore();
    }
    /* rect drag preview */
    if (ovDrag && ovDrag.mode === 'rect') {
      dashRect(g, ox + Math.min(ovDrag.a.x, ovDrag.cur.x), oy + Math.min(ovDrag.a.y, ovDrag.cur.y),
        Math.abs(ovDrag.cur.x - ovDrag.a.x), Math.abs(ovDrag.cur.y - ovDrag.a.y));
    }
    /* lasso drag preview */
    if (ovDrag && ovDrag.mode === 'lasso' && ovDrag.pts.length > 1) dashPath(g, ovDrag.pts, false);
    /* committed selection */
    if (E.sel && !E.lift) {
      const b = E.sel.bbox, ds = cv.clientWidth / Math.max(1, cv.width);
      dashRect(g, ox + b.x * ds, oy + b.y * ds, b.w * ds, b.h * ds);
      if (E.sel.kind === 'lasso' && E.sel.pts) dashPath(g, E.sel.pts, true);
    }
    /* floating paste */
    if (E.floatSel) {
      const fl = E.floatSel;
      g.drawImage(fl.cv, ox + fl.x * dw, oy + fl.y * dh, fl.w * dw, fl.h * dh);
      dashRect(g, ox + fl.x * dw, oy + fl.y * dh, fl.w * dw, fl.h * dh);
    }
    /* moving selection (lift) */
    if (E.lift) {
      const L = E.lift;
      g.drawImage(L.cont, ox + L.x * dw, oy + L.y * dh, L.w * dw, L.h * dh);
      dashRect(g, ox + L.x * dw, oy + L.y * dh, L.w * dw, L.h * dh);
    }
  }

  /* ---------- overlay gestures ---------- */
  ovlCv.addEventListener('pointerdown', (e) => {
    if (!E.open || comparing || E.busySel) return;
    const isShape = PAINT_SHAPES.has(E.tool);
    const isSel = !!SEL_TOOLS[E.tool];
    if (!isShape && !isSel) return;
    e.preventDefault();
    try { ovlCv.setPointerCapture(e.pointerId); } catch (err) {}
    const p = ovlPt(e);
    if (isShape) {
      const n = normPt(p);
      ovDrag = { mode: 'shape' };
      E.liveShape = { kind: E.tool, x1: n.nx, y1: n.ny, x2: n.nx, y2: n.ny, color: E.paint.c1, fill: E.paint.noFill ? null : E.paint.c2, size: E.paint.size };
      drawOverlay();
      return;
    }
    const n = normPt(p);
    if (E.floatSel) {
      const fl = E.floatSel, cv = ed.canvas;
      const fx0 = cv.offsetLeft + fl.x * cv.clientWidth, fy0 = cv.offsetTop + fl.y * cv.clientHeight;
      const fx1 = fx0 + fl.w * cv.clientWidth, fy1 = fy0 + fl.h * cv.clientHeight;
      if (p.x >= fx0 && p.x <= fx1 && p.y >= fy0 && p.y <= fy1) {
        ovDrag = { mode: 'float', ox: n.nx - fl.x, oy: n.ny - fl.y };
      } else {
        stampFloat();
        clearSel();
      }
      return;
    }
    if (E.sel) {
      const b = E.sel.bbox, cv = ed.canvas;
      const dx0 = cv.offsetLeft + (b.x / cv.width) * cv.clientWidth;
      const dy0 = cv.offsetTop + (b.y / cv.height) * cv.clientHeight;
      const dx1 = dx0 + (b.w / cv.width) * cv.clientWidth;
      const dy1 = dy0 + (b.h / cv.height) * cv.clientHeight;
      if (p.x >= dx0 && p.x <= dx1 && p.y >= dy0 && p.y <= dy1) {
        /* Windows-style: drag inside the selection MOVES those pixels */
        liftSelection(p).then(() => { ovDrag = { mode: 'lift' }; });
        return;
      }
    }
    if (E.tool === 'selrect') {
      ovDrag = { mode: 'rect', a: p, cur: p };
      drawOverlay();
    } else if (E.tool === 'sellasso') {
      ovDrag = { mode: 'lasso', pts: [p] };
    } else if (E.tool === 'selwand') {
      const r = wandMask(n.nx, n.ny);
      if (r) {
        E.sel = { kind: 'wand', mcv: r.mcv, bbox: r.bbox, pts: null };
        toast('Colour selected — Copy / Cut / Delete / drag to move', 'ok', 2000);
      } else {
        toast('Nothing matched — raise the Tolerance', undefined, 1800);
      }
      updSelUI();
      drawOverlay();
    }
  });
  ovlCv.addEventListener('pointermove', (e) => {
    if (!ovDrag) return;
    const p = ovlPt(e);
    const n = normPt(p);
    if (ovDrag.mode === 'shape') {
      E.liveShape.x2 = n.nx; E.liveShape.y2 = n.ny;
      drawOverlay();
    } else if (ovDrag.mode === 'rect') {
      ovDrag.cur = p;
      drawOverlay();
    } else if (ovDrag.mode === 'lasso') {
      const lastP = ovDrag.pts[ovDrag.pts.length - 1];
      if (Math.hypot(p.x - lastP.x, p.y - lastP.y) > 3) { ovDrag.pts.push(p); drawOverlay(); }
    } else if (ovDrag.mode === 'float') {
      const fl = E.floatSel;
      if (fl) {
        fl.x = clampN(n.nx - ovDrag.ox, -fl.w + 0.02, 0.98);
        fl.y = clampN(n.ny - ovDrag.oy, -fl.h + 0.02, 0.98);
        drawOverlay();
      }
    } else if (ovDrag.mode === 'lift') {
      const L = E.lift;
      if (L) {
        L.x = clampN(n.nx - L.grabNx, -L.w + 0.02, 0.98);
        L.y = clampN(n.ny - L.grabNy, -L.h + 0.02, 0.98);
        drawOverlay();
      }
    }
  });
  ['pointerup', 'pointercancel'].forEach((ev) => ovlCv.addEventListener(ev, () => {
    if (!ovDrag) return;
    const drag = ovDrag;
    ovDrag = null;
    if (drag.mode === 'shape') {
      const op = E.liveShape;
      E.liveShape = null;
      if (op && (Math.abs(op.x2 - op.x1) > 0.002 || Math.abs(op.y2 - op.y1) > 0.002)) {
        commit({ type: 'shape', kind: op.kind, x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2, color: op.color, fill: op.fill, size: op.size });
      }
      drawOverlay();
    } else if (drag.mode === 'rect') {
      const cv = ed.canvas;
      const ds = cv.clientWidth / Math.max(1, cv.width);
      const x0 = (Math.min(drag.a.x, drag.cur.x) - cv.offsetLeft) / ds;
      const y0 = (Math.min(drag.a.y, drag.cur.y) - cv.offsetTop) / ds;
      const w0 = Math.abs(drag.cur.x - drag.a.x) / ds;
      const h0 = Math.abs(drag.cur.y - drag.a.y) / ds;
      if (w0 < 6 || h0 < 6) { drawOverlay(); return; } /* too small — treat as a click */
      E.sel = { kind: 'rect', mcv: maskFromRect({ x: x0, y: y0, w: w0, h: h0 }), bbox: { x: x0, y: y0, w: w0, h: h0 }, pts: null };
      updSelUI();
      drawOverlay();
    } else if (drag.mode === 'lasso') {
      if (drag.pts.length > 2) {
        const cv = ed.canvas;
        const ds = cv.clientWidth / Math.max(1, cv.width);
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (const p of drag.pts) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
        E.sel = {
          kind: 'lasso',
          mcv: maskFromPath(drag.pts),
          bbox: { x: (minX - cv.offsetLeft) / ds, y: (minY - cv.offsetTop) / ds, w: (maxX - minX) / ds, h: (maxY - minY) / ds },
          pts: drag.pts
        };
        updSelUI();
      }
      drawOverlay();
    } else if (drag.mode === 'lift') {
      dropLift();
    }
    /* 'float' keeps floating until Apply / click outside */
  }));

  /* ---------- Select side-panel actions ---------- */
  [['#selCopy', () => copySelection(false)],
   ['#selCut', () => copySelection(true)],
   ['#selDel', () => deleteSelection()],
   ['#selPaste', () => pasteClipboard()],
   ['#selDeselect', () => { if (E.floatSel) stampFloat(); else clearSel(); }]
  ].forEach(([sel2, fn]) => { const b = q(sel2); if (b) b.addEventListener('click', fn); });

  /* ---------- save ---------- */
  const baseName = (n) => n.replace(/\.[^.]+$/, '') || 'photo';
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function renderFull() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 60));
    let blob;
    try {
      const c = FX.renderStack(E.src, E.ops, E.adj, 0, stickerMap());
      /* if transparent PNG/WebP, save as PNG — transparency is never lost */
      const wantPng = /\.png$|\.webp$/i.test(E.photo.name) || FX.hasAlpha(c);
      blob = await new Promise((r) => c.toBlob(r, wantPng ? 'image/png' : 'image/jpeg', 0.92));
    } finally {
      setBusy(false);
    }
    return blob;
  }
  async function doSave() {
    const blob = await renderFull();
    if (!blob) { toast('Save failed — please try again', 'err'); return; }
    const p = E.photo;
    const oldKey = P.photoKey(p);
    let ok = false;
    if (p.cloud && window.PixsaCloud && window.PixsaCloud.enabled) {
      /* v3.7.0: cloud photos have no local disk file — saving updates the
         cached copy and queues the same Drive file for overwrite */
      try { ok = await window.PixsaCloud.onPhotoSaved(p, blob); } catch (e) { ok = false; }
    } else if (p.handle) {
      try {
        let perm = await p.handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await p.handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          const w = await p.handle.createWritable();
          await w.write(blob);
          await w.close();
          ok = true;
        }
      } catch (e) { ok = false; }
    }
    if (ok) {
      /* now permanently saved in the file — clear the auto-save session and set the new base */
      await P.idbDel('edits', oldKey).catch(() => {});
      P.invalidateThumb(p);
      p.size = blob.size;
      p.lastModified = Date.now();
      /* v3.7.0: cloud photos — the SAME Google Drive file is overwritten in
         the background (no duplicate photo is ever created) */
      if (p.cloud && window.PixsaCloud) window.PixsaCloud.onPhotoSaved(p, blob);
      E.saved = true;
      E.dirty = false;
      try { if (E.src && E.src.close) E.src.close(); } catch (e) {}
      E.src = await createImageBitmap(blob).catch(() => E.src);
      E.ops = []; E.adj = { ...ADJ0 }; E.prevAdj = { ...E.adj };
      E.undo = []; E.redo = []; E.stickers = []; E.stkSel = null;
      E.txtSel = null; E.txtEditing = null; E.txtDraft = { ...TEXT0, alpha: 1 };
      E.sel = null; E.floatSel = null; E.lift = null; E.liveShape = null;
      hideTxtEdit();
      resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
      await renderPreview();
      ed.dims.textContent = `${E.src.width} \u00D7 ${E.src.height} px \u2022 ${fmtBytes(blob.size)}`;
      toast('Saved \u2713', 'ok', 2500);
    } else {
      const ext = blob.type === 'image/png' ? '.png' : '.jpg';
      download(blob, baseName(p.name) + '-edited' + ext);
      toast('Direct save not possible — edited copy downloaded', 'err', 6000);
    }
  }
  async function doSaveCopy() {
    const blob = await renderFull();
    if (!blob) { toast('Save failed — please try again', 'err'); return; }
    const ext = blob.type === 'image/png' ? '.png' : '.jpg';
    const nm = baseName(E.photo.name) + '-edited' + ext;
    const dir = state.dirHandle;
    if (dir && await P.saveBlobToDir(dir, nm, blob)) {
      toast(`Copy saved: ${nm}`, 'ok', 4000);
      P.loadFolder(dir, true);
    } else {
      download(blob, nm);
      toast(`${nm} downloaded`, 'ok', 4000);
    }
  }

  /* ---------- open / close / nav ---------- */
  async function open(idx) {
    const photo = state.filtered[idx];
    if (!photo) return;
    if (E.open) { try { if (E.src && E.src.close) E.src.close(); } catch (e) {} }
    E.open = true;
    E.photo = photo; E.idx = idx; E.saved = false;
    ed.root.hidden = false;
    document.body.classList.add('noscroll', 'ed-open');
    ed.name.textContent = photo.name;
    ed.count.textContent = `${idx + 1} / ${state.filtered.length}`;
    ed.dims.textContent = '';
    setBusy(true);
    let bmp = null;
    let file = null;
    try {
      file = await getFile(photo);
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { bmp = await createImageBitmap(file); }
    } catch (e) {
      setBusy(false);
      toast('This photo could not be opened (unsupported format or corrupt file)', 'err', 6000);
      close();
      return;
    }
    E.src = bmp;
    E.ops = [];
    E.adj = { ...ADJ0 };
    E.prevAdj = { ...E.adj };
    E.undo = []; E.redo = [];
    E.tool = null; E.cropR = null; E.aspect = 0; E.pendPts = []; E.draft = null;
    E.stickers = []; E.stkSeq = 0; E.stkSel = null;
    E.txtSel = null; E.txtEditing = null; E.txtDraft = { ...TEXT0, alpha: 1 };
    E.paint = { size: 6, c1: '#1a1a1a', c2: '#ffffff', noFill: false };
    E.sel = null; E.floatSel = null; E.lift = null; E.clipboard = null; E.liveShape = null;
    hideTxtEdit();
    E.dirty = false; E.restored = false;
    E.fit = true; E.zoom = 100; ed.zoom.value = 100;
    baseCv = null; baseKey = '';
    comparing = false;
    q('#eOrig').hidden = true; q('#eOrigTag').hidden = true;
    ed.root.classList.remove('tools-open');
    ed.exif.textContent = '';
    readExif(file).then((txt) => { if (E.open && E.photo === photo) ed.exif.textContent = txt; });

    /* power-cut safe: reload the previous auto-saved edits */
    try {
      const ses = await P.idbGet('edits', P.photoKey(photo));
      if (ses && Array.isArray(ses.ops) && ses.ops.length) {
        E.ops = ses.ops;
        E.adj = Object.assign({ ...ADJ0 }, ses.adj || {});
        E.prevAdj = { ...E.adj };
        for (const sd of (ses.stickers || [])) {
          if (!sd || !sd.blob) continue;
          try {
            const sb = await createImageBitmap(sd.blob);
            E.stickers.push({ sid: sd.sid, bmp: sb, blob: sd.blob });
            E.stkSeq = Math.max(E.stkSeq, sd.sid);
          } catch (e) {}
        }
        E.restored = true;
      }
    } catch (e) {}

    resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
    await renderPreview();
    ed.dims.textContent = `${bmp.width} \u00D7 ${bmp.height} px \u2022 ${fmtBytes(photo.size)}`;
    setBusy(false);
    if (E.restored) {
      toast('Previous edits auto-restored \u2713', 'ok', 3000);
      E.dirty = true;
    }
  }
  function close() {
    if (!E.open) return;
    if (E.txtEditing) commitEditing();
    E.open = false;
    E.tool = null;
    comparing = false;
    q('#eOrig').hidden = true; q('#eOrigTag').hidden = true;
    gizCv.hidden = true; hideTxtEdit(); ovlCv.hidden = true;
    E.sel = null; E.floatSel = null; E.lift = null; E.liveShape = null;
    baseCv = null; baseKey = '';
    if (E.dirty) saveEditSession();
    ed.root.hidden = true;
    document.body.classList.remove('noscroll', 'ed-open');
    if (E.src) { try { if (E.src.close) E.src.close(); } catch (e) {} }
    E.src = null;
    if (E.saved || E.dirty) setTimeout(() => P.applyFilter(), 60);
  }
  function nav(d) {
    const n = state.filtered.length;
    if (!n) return;
    open((E.idx + d + n) % n);
  }

  /* ---------- wiring ---------- */
  const toolsBtn = q('#eTools');
  if (toolsBtn) toolsBtn.addEventListener('click', () => ed.root.classList.toggle('tools-open'));
  const closeTools = () => { if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) ed.root.classList.remove('tools-open'); };
  qa('.e-tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      qa('.e-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      qa('.e-tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
      closeTools();
    });
  });
  qa('.fixbtn[data-fix]').forEach((b) => {
    b.addEventListener('click', () => {
      const f = b.dataset.fix;
      if (f === 'autocon') autoContrast();
      else if (f === 'autocolor') autoColor();
      else if (f === 'lucky') feelingLucky();
      else if (f === 'rotl') commit({ type: 'rot', deg: -90 });
      else if (f === 'rotr') commit({ type: 'rot', deg: 90 });
      else if (f === 'sticker') q('#stickerFile').click();
      else if (E.tool === f) setTool(null);
      else if (f === 'crop') startCrop();
      else setTool(f);
      closeTools();
    });
  });
  ed.undoBtn.addEventListener('click', doUndo);
  ed.redoBtn.addEventListener('click', doRedo);
  const cmpBtn = q('#eCompare');
  if (cmpBtn) {
    cmpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); setCompare(true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => cmpBtn.addEventListener(ev, () => setCompare(false)));
  }
  document.addEventListener('keyup', (e) => { if (E.open && (e.key === 'b' || e.key === 'B')) setCompare(false); });
  q('#eSave').addEventListener('click', doSave);
  q('#eSaveCopy').addEventListener('click', doSaveCopy);
  q('#eBack').addEventListener('click', close);
  q('#ePrev').addEventListener('click', () => nav(-1));
  q('#eNext').addEventListener('click', () => nav(1));
  q('#eFit').addEventListener('click', () => { E.fit = true; applyDisp(); });
  ed.zoom.addEventListener('input', () => { E.fit = false; E.zoom = +ed.zoom.value; applyDisp(); });
  window.addEventListener('resize', () => { if (E.open) applyDisp(); });
  const fxPrev = q('#fxPrev'), fxNext = q('#fxNext');
  if (fxPrev) fxPrev.addEventListener('click', () => { if (E.fxPage > 1) { E.fxPage--; buildFx(); } });
  if (fxNext) fxNext.addEventListener('click', () => { if (E.fxPage < 3) { E.fxPage++; buildFx(); } });

  document.addEventListener('keydown', (e) => {
    if (!E.open) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (e.key === 'Escape') {
      e.preventDefault();
      /* v3.14.0: Esc stamps a pasted patch, else drops the selection, else
         closes the active tool, else the editor */
      if (E.floatSel) { stampFloat(); clearSel(); }
      else if (E.sel) clearSel();
      else if (E.tool) setTool(null);
      else close();
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    /* v3.13.0: Delete removes the selected text block */
    if (E.tool === 'text' && E.txtSel && !E.txtEditing && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      pushUndo();
      E.ops = E.ops.filter((o) => o !== E.txtSel);
      E.txtSel = null;
      updUndoBtns();
      renderPreview();
      scheduleEditSave();
      return;
    }
    /* v3.14.0: Delete removes the selected area (Windows style) */
    if (E.sel && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
    else if (e.key === 'b' || e.key === 'B') { if (!e.repeat) setCompare(true); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
    /* v3.14.0: Windows-style clipboard for selections */
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && E.sel) { e.preventDefault(); copySelection(false); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && E.sel) { e.preventDefault(); copySelection(true); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && E.clipboard) { e.preventDefault(); pasteClipboard(); }
  });

  buildFx();
  wireSliders();
  wireFxStr();

  window.PixsaEditor = {
    open, close, isOpen: () => E.open,
    /* test hook */
    _selDbg: () => E.sel ? { kind: E.sel.kind, mw: E.sel.mcv.width, mh: E.sel.mcv.height, bbox: { x: +E.sel.bbox.x.toFixed(1), y: +E.sel.bbox.y.toFixed(1), w: +E.sel.bbox.w.toFixed(1), h: +E.sel.bbox.h.toFixed(1) }, cvW: ed.canvas.width, cvH: ed.canvas.height } : null,
    _dbg: () => {
      const op = (E.txtEditing && E.txtEditing.op) || E.txtSel;
      const gm = op ? textDisplayGeom(op) : null;
      const gr = gizCv.getBoundingClientRect();
      return {
        tool: E.tool, ops: E.ops.length,
        sel: E.sel ? E.sel.kind : null, float: !!E.floatSel, clip: !!E.clipboard,
        paintOps: E.ops.filter((o) => ['paint', 'shape', 'fill', 'patch'].includes(o.type)).length,
        text: E.ops.filter((o) => o.type === 'text').map((o) => ({ t: o.text, x: +o.x.toFixed(3), y: +o.y.toFixed(3), size: +o.size.toFixed(1), rot: o.rot || 0 })),
        txtSel: !!E.txtSel, editing: !!(E.txtEditing && E.txtEditing.op.text),
        geom: gm ? { cx: Math.round(gm.cx), cy: Math.round(gm.cy), r: Math.round(gm.r), rot: gm.rot, w: Math.round(gm.w), h: Math.round(gm.h) } : null,
        giz: { x: Math.round(gr.x), y: Math.round(gr.y), w: Math.round(gr.width), h: Math.round(gr.height) }
      };
    }
  };
})();
