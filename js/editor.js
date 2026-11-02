/* SHIVAM PIXSA — editor.js
   Picasa-style edit view: Basic Fixes | Tuning | Effects
   Non-destructive: original + ops list; Save par full-res render. */
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
    textPop: q('#eTextPop'), busy: q('#eBusy'), name: q('#eName'), count: q('#eCount'),
    dims: q('#eDims'), undoBtn: q('#eUndo'), redoBtn: q('#eRedo'),
    toolBox: q('#eToolBox'), zoom: q('#eZoom'), fxGrid: q('#fxGrid')
  };

  const ADJ_IDS = [['adFill', 'vFill', 'fill'], ['adHigh', 'vHigh', 'high'], ['adShad', 'vShad', 'shad'],
                   ['adTemp', 'vTemp', 'temp'], ['adTint', 'vTint', 'tint'], ['adSat', 'vSat', 'sat']];

  const E = {
    open: false, photo: null, idx: -1, src: null,
    ops: [], adj: { fill: 0, high: 0, shad: 0, temp: 0, tint: 0, sat: 0 },
    prevAdj: null, undo: [], redo: [], tool: null, saved: false,
    cropR: null, aspect: 0, pendPts: [], brush: 16, draft: null,
    pendText: null, fit: true, zoom: 100
  };

  /* ---------- busy ---------- */
  const setBusy = (b) => { ed.busy.hidden = !b; };

  /* ---------- preview ---------- */
  let rafPend = false;
  function renderPreview() {
    if (rafPend) return Promise.resolve();
    rafPend = true;
    return new Promise((res) => requestAnimationFrame(() => {
      rafPend = false;
      if (!E.src) return res();
      const ops = E.draft ? [...E.ops, E.draft] : E.ops;
      const c = FX.renderStack(E.src, ops, E.adj, 1400);
      const cv = ed.canvas;
      if (cv.width !== c.width || cv.height !== c.height) { cv.width = c.width; cv.height = c.height; }
      cv.getContext('2d').drawImage(c, 0, 0);
      applyDisp();
      res();
    }));
  }

  function applyDisp() {
    const cv = ed.canvas, st = ed.stage;
    const pad = 36;
    if (E.fit) {
      const sc = Math.min((st.clientWidth - pad) / cv.width, (st.clientHeight - pad) / cv.height, 1.5);
      cv.style.width = (cv.width * sc) + 'px';
      cv.style.height = (cv.height * sc) + 'px';
    } else {
      const zz = E.zoom / 100;
      cv.style.width = (cv.width * zz) + 'px';
      cv.style.height = (cv.height * zz) + 'px';
    }
    syncCropOverlay();
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
    resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
    renderPreview();
  }
  function doRedo() {
    if (!E.redo.length) return;
    E.undo.push(snap());
    const s = JSON.parse(E.redo.pop());
    E.ops = s.ops; E.adj = s.adj; E.prevAdj = { ...E.adj };
    resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
    renderPreview();
  }
  function updUndoBtns() {
    ed.undoBtn.disabled = !E.undo.length;
    ed.redoBtn.disabled = !E.redo.length;
  }

  function commit(op) {
    pushUndo();
    E.ops.push(op);
    updFxTiles(); updUndoBtns();
    renderPreview();
  }

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
      });
      el.addEventListener('dblclick', () => {
        if (+el.value === 0) return;
        pushUndo(JSON.stringify({ ops: E.ops, adj: E.prevAdj }));
        E.adj[key] = 0; el.value = 0; q('#' + lab).textContent = '0';
        E.prevAdj = { ...E.adj };
        renderPreview();
      });
    }
  }

  /* ---------- effects grid ---------- */
  function buildFx() {
    ed.fxGrid.innerHTML = '';
    for (const f of FX.EFFECTS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fxtile'; b.textContent = f.name; b.dataset.fx = f.id;
      b.addEventListener('click', () => { commit({ type: 'effect', id: f.id }); toast(f.name + ' lag gaya', 'ok', 1300); });
      ed.fxGrid.appendChild(b);
    }
  }
  function updFxTiles() {
    const has = new Set(E.ops.filter((o) => o.type === 'effect').map((o) => o.id));
    qa('.fxtile').forEach((t) => t.classList.toggle('applied', has.has(t.dataset.fx)));
  }

  /* ---------- tools ---------- */
  function setTool(t) {
    if ((E.tool === 'redeye' || E.tool === 'retouch') && t !== E.tool) E.pendPts = [];
    if (E.tool === 'crop' && t !== 'crop') { E.cropR = null; }
    if (E.tool === 'straighten' && t !== 'straighten' && E.draft) { E.draft = null; }
    E.tool = t;
    ed.crop.hidden = !(t === 'crop' && E.cropR);
    hideTextPop();
    qa('.fixbtn[data-fix]').forEach((b) => b.classList.toggle('on', b.dataset.fix === t));
    renderToolbox();
    if (E.tool === 'straighten' && E.draft) renderPreview();
  }

  function renderToolbox() {
    const tb = ed.toolBox;
    if (!E.tool) { tb.hidden = true; tb.innerHTML = ''; return; }
    tb.hidden = false;
    if (E.tool === 'crop') {
      tb.innerHTML = `
        <h4>Photo pe box drag karo — corners se resize</h4>
        <div class="asprow">
          <button type="button" data-ar="0">Free</button>
          <button type="button" data-ar="1">1:1</button>
          <button type="button" data-ar="${4 / 3}">4:3</button>
          <button type="button" data-ar="${3 / 4}">3:4</button>
          <button type="button" data-ar="${16 / 9}">16:9</button>
          <button type="button" data-ar="${9 / 16}">9:16</button>
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
      const label = E.tool === 'redeye' ? 'Redeye wali aankh pe click-drag karo' : 'Dagha (spot) pe click-drag karo — blur hoga';
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
      tb.innerHTML = `
        <h4>Photo pe jahan text chahiye wahan <b>click</b> karo</h4>
        <div class="mrow"><button id="tbCancel" class="btn" type="button">Cancel</button></div>`;
      q('#tbCancel').addEventListener('click', () => setTool(null));
    } else if (E.tool === 'straighten') {
      tb.innerHTML = `
        <h4>Straighten karo (photo ghumao)</h4>
        <div class="trow"><label>Angle</label><input id="tbStr" type="range" min="-15" max="15" value="${E.draft ? E.draft.deg : 0}" /><span class="val" id="tbStrV">${E.draft ? E.draft.deg : 0}&deg;</span></div>
        <div class="mrow">
          <button id="tbApply" class="btn btn-accent" type="button">Apply</button>
          <button id="tbCancel" class="btn" type="button">Cancel</button>
        </div>`;
      const s = q('#tbStr');
      s.addEventListener('input', () => {
        const v = +s.value;
        q('#tbStrV').textContent = v + '\u00B0';
        E.draft = { type: 'straighten', deg: v };
        renderPreview();
      });
      q('#tbApply').addEventListener('click', () => {
        if (E.draft) { const d = E.draft; E.draft = null; commit(d); }
        setTool(null);
      });
      q('#tbCancel').addEventListener('click', () => { E.draft = null; setTool(null); renderPreview(); });
    }
  }

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
  ed.canvas.addEventListener('pointerdown', (e) => {
    if (!E.open) return;
    if (E.tool === 'redeye' || E.tool === 'retouch') {
      stroking = true;
      try { ed.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      strokeAt(e);
    } else if (E.tool === 'text') {
      placeTextPop(e);
    }
  });
  ed.canvas.addEventListener('pointermove', (e) => { if (stroking) strokeAt(e); });
  ['pointerup', 'pointercancel'].forEach((ev) => ed.canvas.addEventListener(ev, () => { stroking = false; }));

  /* ---------- text tool ---------- */
  function placeTextPop(e) {
    const cv = ed.canvas;
    const r = cv.getBoundingClientRect();
    E.pendText = {
      x: clamp((e.clientX - r.left) / r.width, 0.02, 0.98),
      y: clamp((e.clientY - r.top) / r.height, 0.03, 0.97)
    };
    const sr = ed.stage.getBoundingClientRect();
    const px2 = clamp(e.clientX - sr.left + ed.stage.scrollLeft + 12, 6, sr.width - 244);
    const py2 = clamp(e.clientY - sr.top + ed.stage.scrollTop + 12, 6, sr.height - 186);
    ed.textPop.style.left = px2 + 'px';
    ed.textPop.style.top = py2 + 'px';
    ed.textPop.hidden = false;
    q('#etText').focus();
  }
  function hideTextPop() {
    ed.textPop.hidden = true;
    E.pendText = null;
  }
  function wireText() {
    const ts = q('#etSize');
    ts.addEventListener('input', () => { q('#etSizeVal').textContent = ts.value + '%'; });
    q('#etAdd').addEventListener('click', () => {
      const txt = q('#etText').value.trim();
      if (!txt || !E.pendText) { hideTextPop(); return; }
      commit({
        type: 'text', x: E.pendText.x, y: E.pendText.y, text: txt,
        size: +ts.value, color: q('#etColor').value
      });
      q('#etText').value = '';
      hideTextPop();
    });
    q('#etCancel').addEventListener('click', hideTextPop);
    q('#etText').addEventListener('keydown', (e) => { if (e.key === 'Enter') q('#etAdd').click(); });
  }

  /* ---------- auto fixes ---------- */
  function autoContrast() {
    const c = FX.renderStack(E.src, E.ops, null, 900);
    const { lo, hi } = FX.computeLevels(c);
    commit({ type: 'autocontrast', lo, hi });
    toast('Auto Contrast lag gaya', 'ok', 1500);
  }
  function autoColor() {
    const c = FX.renderStack(E.src, E.ops, null, 900);
    const wb = FX.computeWB(c);
    commit({ type: 'autocolor', gr: wb.gr, gg: wb.gg, gb: wb.gb });
    toast('Auto Color lag gaya', 'ok', 1500);
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
      const c = FX.renderStack(E.src, E.ops, E.adj, 0);
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    } finally {
      setBusy(false);
    }
    return blob;
  }
  async function doSave() {
    const blob = await renderFull();
    if (!blob) { toast('Save fail hua — dobara try karo', 'err'); return; }
    const p = E.photo;
    let ok = false;
    if (p.handle) {
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
      P.invalidateThumb(p);
      p.size = blob.size;
      p.lastModified = Date.now();
      E.saved = true;
      ed.dims.textContent = `${E.src.width} \u00D7 ${E.src.height} px \u2022 ${fmtBytes(blob.size)}`;
      toast('Save ho gaya — original photo update ho gayi', 'ok', 4000);
    } else {
      download(blob, baseName(p.name) + '-edited.jpg');
      toast('Original file direct edit nahi ho payi — edited copy download kar li. (Picasa me folder dobara import karo to direct save hoga)', 'err', 8000);
    }
  }
  async function doSaveCopy() {
    const blob = await renderFull();
    if (!blob) { toast('Save fail hua — dobara try karo', 'err'); return; }
    const nm = baseName(E.photo.name) + '-edited.jpg';
    const dir = state.dirHandle;
    if (dir && await P.saveBlobToDir(dir, nm, blob)) {
      toast(`Copy save hui: ${nm}`, 'ok', 4000);
      P.loadFolder(dir, true);
    } else {
      download(blob, nm);
      toast(`${nm} download ho gayi`, 'ok', 4000);
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
    try {
      const file = await getFile(photo);
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { bmp = await createImageBitmap(file); }
    } catch (e) {
      setBusy(false);
      toast('Ye photo open nahi ho payi (format support nahi ya file corrupt)', 'err', 6000);
      close();
      return;
    }
    E.src = bmp;
    E.ops = [];
    E.adj = { fill: 0, high: 0, shad: 0, temp: 0, tint: 0, sat: 0 };
    E.prevAdj = { ...E.adj };
    E.undo = []; E.redo = [];
    E.tool = null; E.cropR = null; E.aspect = 0; E.pendPts = []; E.draft = null;
    E.fit = true; E.zoom = 100; ed.zoom.value = 100;
    resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
    await renderPreview();
    ed.dims.textContent = `${bmp.width} \u00D7 ${bmp.height} px \u2022 ${fmtBytes(photo.size)}`;
    setBusy(false);
  }
  function close() {
    if (!E.open) return;
    E.open = false;
    E.tool = null;
    ed.root.hidden = true;
    document.body.classList.remove('noscroll', 'ed-open');
    if (E.src) { try { if (E.src.close) E.src.close(); } catch (e) {} }
    E.src = null;
    if (E.saved) P.applyFilter();
  }
  function nav(d) {
    const n = state.filtered.length;
    if (!n) return;
    open((E.idx + d + n) % n);
  }

  /* ---------- wiring ---------- */
  qa('.e-tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      qa('.e-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      qa('.e-tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
    });
  });
  qa('.fixbtn[data-fix]').forEach((b) => {
    b.addEventListener('click', () => {
      const f = b.dataset.fix;
      if (f === 'autocon') autoContrast();
      else if (f === 'autocolor') autoColor();
      else if (f === 'rotl') commit({ type: 'rot', deg: -90 });
      else if (f === 'rotr') commit({ type: 'rot', deg: 90 });
      else if (E.tool === f) setTool(null);
      else if (f === 'crop') startCrop();
      else setTool(f);
    });
  });
  ed.undoBtn.addEventListener('click', doUndo);
  ed.redoBtn.addEventListener('click', doRedo);
  q('#eSave').addEventListener('click', doSave);
  q('#eSaveCopy').addEventListener('click', doSaveCopy);
  q('#eBack').addEventListener('click', close);
  q('#ePrev').addEventListener('click', () => nav(-1));
  q('#eNext').addEventListener('click', () => nav(1));
  q('#eFit').addEventListener('click', () => { E.fit = true; applyDisp(); });
  ed.zoom.addEventListener('input', () => { E.fit = false; E.zoom = +ed.zoom.value; applyDisp(); });
  window.addEventListener('resize', () => { if (E.open) applyDisp(); });

  document.addEventListener('keydown', (e) => {
    if (!E.open) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (e.key === 'Escape') {
      e.preventDefault();
      if (E.tool) setTool(null); else close();
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
  });

  buildFx();
  wireSliders();
  wireText();

  window.PixsaEditor = { open, close, isOpen: () => E.open };
})();
