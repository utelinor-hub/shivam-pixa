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
   first (instant) and overwrites the same Drive file in the background. */
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
  }

  /* ---------- before / after compare (hold) ---------- */
  let comparing = false;
  function setCompare(on) {
    if (!E.open || on === comparing) return;
    comparing = on;
    const oc = q('#eOrig'), tag = q('#eOrigTag'), btn = q('#eCompare');
    if (on) {
      /* v3.13.0: hide the text wheel + typing layer while comparing */
      gizCv.hidden = true; hideTxtEdit();
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
    if (E.txtSel && !E.ops.includes(E.txtSel)) E.txtSel = null;
    resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
    renderPreview();
    scheduleEditSave();
  }
  function updUndoBtns() {
    ed.undoBtn.disabled = !E.undo.length;
    ed.redoBtn.disabled = !E.redo.length;
  }

  function commit(op) {
    pushUndo();
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
    if (t === 'text' && !E.txtDraft) E.txtDraft = { ...TEXT0 };
    E.tool = t;
    ed.crop.hidden = !(t === 'crop' && E.cropR);
    qa('.fixbtn[data-fix]').forEach((b) => b.classList.toggle('on', b.dataset.fix === t));
    renderToolbox();
    if (E.tool === 'straighten' && E.draft) renderPreview();
    syncTextOverlay();
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
    gizCv.hidden = true; hideTxtEdit();
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
      if (E.tool) setTool(null); else close();
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
    if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
    else if (e.key === 'b' || e.key === 'B') { if (!e.repeat) setCompare(true); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
  });

  buildFx();
  wireSliders();
  wireFxStr();

  window.PixsaEditor = {
    open, close, isOpen: () => E.open,
    /* test hook */
    _dbg: () => {
      const op = (E.txtEditing && E.txtEditing.op) || E.txtSel;
      const gm = op ? textDisplayGeom(op) : null;
      const gr = gizCv.getBoundingClientRect();
      return {
        tool: E.tool, ops: E.ops.length,
        text: E.ops.filter((o) => o.type === 'text').map((o) => ({ t: o.text, x: +o.x.toFixed(3), y: +o.y.toFixed(3), size: +o.size.toFixed(1), rot: o.rot || 0 })),
        sel: !!E.txtSel, editing: !!(E.txtEditing && E.txtEditing.op.text),
        geom: gm ? { cx: Math.round(gm.cx), cy: Math.round(gm.cy), r: Math.round(gm.r), rot: gm.rot, w: Math.round(gm.w), h: Math.round(gm.h) } : null,
        giz: { x: Math.round(gr.x), y: Math.round(gr.y), w: Math.round(gr.width), h: Math.round(gr.height) }
      };
    }
  };
})();
