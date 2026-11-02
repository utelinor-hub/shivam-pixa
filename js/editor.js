/* SHIVAM PIXA — editor.js
   Picasa-style edit view: Basic Fixes | Tuning | Effects
   Non-destructive: original + ops list; Save par full-res render.
   v3.1.0: power-cut safe auto-save (IndexedDB 'edits' store), text panel
   (fonts/bold/italic/outline/shadow/align), transparent PNG stickers. */
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
    dims: q('#eDims'), undoBtn: q('#eUndo'), redoBtn: q('#eRedo'),
    toolBox: q('#eToolBox'), zoom: q('#eZoom'), fxGrid: q('#fxGrid')
  };

  const ADJ_IDS = [['adFill', 'vFill', 'fill'], ['adHigh', 'vHigh', 'high'], ['adShad', 'vShad', 'shad'],
                   ['adTemp', 'vTemp', 'temp'], ['adTint', 'vTint', 'tint'], ['adSat', 'vSat', 'sat']];

  const ADJ0 = { fill: 0, high: 0, shad: 0, temp: 0, tint: 0, sat: 0 };
  const TEXT0 = {
    size: 7, color: '#ffffff', font: '"Segoe UI", sans-serif', rot: 0, alpha: 100,
    bold: false, italic: false, stroke: '#000000', strokeW: 0, shadow: true, align: 'center'
  };

  const E = {
    open: false, photo: null, idx: -1, src: null,
    ops: [], adj: { ...ADJ0 },
    prevAdj: null, undo: [], redo: [], tool: null, saved: false,
    cropR: null, aspect: 0, pendPts: [], brush: 16, draft: null,
    fit: true, zoom: 100, fxPage: 1,
    /* v3.1.0: stickers + text draft + autosave state */
    stickers: [], stkSeq: 0, stkSel: null,
    pendText: { x: 0.5, y: 0.5 }, textDraft: { ...TEXT0 },
    dirty: false, restored: false
  };

  /* ---------- busy ---------- */
  const setBusy = (b) => { ed.busy.hidden = !b; };

  /* ---------- sticker map (ops -> bitmaps) ---------- */
  function stickerMap() {
    const m = new Map();
    for (const s of E.stickers) m.set(s.sid, s.bmp);
    return m;
  }

  /* ---------- preview ---------- */
  let rafPend = false;
  function renderPreview() {
    if (rafPend) return Promise.resolve();
    rafPend = true;
    return new Promise((res) => requestAnimationFrame(() => {
      rafPend = false;
      if (!E.src) return res();
      const ops = E.draft ? [...E.ops, E.draft] : E.ops;
      const c = FX.renderStack(E.src, ops, E.adj, 1400, stickerMap());
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
    scheduleEditSave();
  }
  function doRedo() {
    if (!E.redo.length) return;
    E.undo.push(snap());
    const s = JSON.parse(E.redo.pop());
    E.ops = s.ops; E.adj = s.adj; E.prevAdj = { ...E.adj };
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
    E.ops.push(op);
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
    } catch (e) { /* storage full etc. — chup rehna, Save button phir bhi kaam karega */ }
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
      b.addEventListener('click', () => { commit({ type: 'effect', id: f.id }); toast(f.name + ' lag gaya', 'ok', 1300); });
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
  }

  /* ---------- fonts (system + PC se add kiye hue) ---------- */
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
      html += '<optgroup label="PC se add kiye fonts">';
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
    E.tool = t;
    ed.crop.hidden = !(t === 'crop' && E.cropR);
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
      const td = E.textDraft;
      tb.innerHTML = `
        <h4>Photo pe click karo — text wahin lagega. Ya seedha Add Text dabao (center).</h4>
        <input id="txText" type="text" placeholder="Yahan text likho... (Enter = nayi line ke liye \\n)" maxlength="200"
               style="width:100%;padding:6px 8px;border:1px solid #bcbcbc;border-radius:4px;font-size:13px;outline:none" />
        <div class="trow" style="margin-top:8px"><label>Font</label><select id="txFont" style="flex:1;height:27px;min-width:0">${fontOptionsHTML(td.font)}</select></div>
        <button id="txAddFont" class="fixbtn" type="button" style="margin:5px 0 4px">+ PC se Font Add Karo</button>
        <div class="trow"><label>Size</label><input id="txSize" type="range" min="2" max="30" value="${td.size}" /><span class="val" id="txSizeV">${td.size}%</span></div>
        <div class="trow">
          <label>Style</label>
          <button id="txBold" type="button" class="fixbtn" style="width:34px;margin:0;font-weight:900;${td.bold ? 'border-color:var(--accent);background:#dcebfb' : ''}">B</button>
          <button id="txItalic" type="button" class="fixbtn" style="width:34px;margin:0;font-style:italic;${td.italic ? 'border-color:var(--accent);background:#dcebfb' : ''}">I</button>
          <select id="txAlign" style="flex:1;height:27px;min-width:0">
            <option value="left"${td.align === 'left' ? ' selected' : ''}>Left</option>
            <option value="center"${td.align === 'center' ? ' selected' : ''}>Center</option>
            <option value="right"${td.align === 'right' ? ' selected' : ''}>Right</option>
          </select>
        </div>
        <div class="trow"><label>Color</label><input id="txColor" type="color" value="${td.color}" style="height:27px;flex:1" /></div>
        <div class="trow"><label>Outline</label><input id="txStrokeC" type="color" value="${td.stroke}" style="height:27px;width:36px;padding:0" /><input id="txStrokeW" type="range" min="0" max="12" value="${td.strokeW}" style="flex:1" /><span class="val" id="txStrokeWV">${td.strokeW}</span></div>
        <label class="chkrow"><input type="checkbox" id="txShadow"${td.shadow ? ' checked' : ''} /> Shadow on/off</label>
        <div class="trow"><label>Rotate</label><input id="txRot" type="range" min="-45" max="45" value="${td.rot}" /><span class="val" id="txRotV">${td.rot}\u00B0</span></div>
        <div class="trow"><label>Opacity</label><input id="txAlpha" type="range" min="10" max="100" value="${td.alpha}" /><span class="val" id="txAlphaV">${td.alpha}%</span></div>
        <div class="mrow">
          <button id="txAdd" class="btn btn-accent" type="button">Add Text</button>
          <button id="txDone" class="btn" type="button">Done</button>
        </div>`;
      const grab = (id) => q(id);
      grab('#txText').focus();
      grab('#txFont').addEventListener('change', (e) => { td.font = e.target.value; });
      grab('#txSize').addEventListener('input', (e) => { td.size = +e.target.value; grab('#txSizeV').textContent = e.target.value + '%'; });
      grab('#txBold').addEventListener('click', (e) => { td.bold = !td.bold; e.target.style.borderColor = td.bold ? 'var(--accent)' : ''; e.target.style.background = td.bold ? '#dcebfb' : ''; });
      grab('#txItalic').addEventListener('click', (e) => { td.italic = !td.italic; e.target.style.borderColor = td.italic ? 'var(--accent)' : ''; e.target.style.background = td.italic ? '#dcebfb' : ''; });
      grab('#txAlign').addEventListener('change', (e) => { td.align = e.target.value; });
      grab('#txColor').addEventListener('input', (e) => { td.color = e.target.value; });
      grab('#txStrokeC').addEventListener('input', (e) => { td.stroke = e.target.value; });
      grab('#txStrokeW').addEventListener('input', (e) => { td.strokeW = +e.target.value; grab('#txStrokeWV').textContent = e.target.value; });
      grab('#txShadow').addEventListener('change', (e) => { td.shadow = e.target.checked; });
      grab('#txRot').addEventListener('input', (e) => { td.rot = +e.target.value; grab('#txRotV').textContent = e.target.value + '\u00B0'; });
      grab('#txAlpha').addEventListener('input', (e) => { td.alpha = +e.target.value; grab('#txAlphaV').textContent = e.target.value + '%'; });
      grab('#txAddFont').addEventListener('click', () => q('#fontFile').click());
      grab('#txAdd').addEventListener('click', () => {
        const txt = grab('#txText').value.trim();
        if (!txt) { toast('Pehle kuch text likho', 'err', 1800); return; }
        commit({
          type: 'text',
          x: E.pendText.x, y: E.pendText.y,
          text: txt, size: td.size, color: td.color, font: td.font,
          rot: td.rot, alpha: td.alpha / 100,
          bold: td.bold, italic: td.italic,
          stroke: td.stroke, strokeW: td.strokeW,
          shadow: td.shadow, align: td.align
        });
        grab('#txText').value = '';
        E.pendText = { x: 0.5, y: 0.5 };
        toast('Text lag gaya \u2713', 'ok', 1500);
      });
      grab('#txDone').addEventListener('click', () => setTool(null));
      document.addEventListener('pixa-fonts-updated', () => { if (E.tool === 'text') renderToolbox(); }, { once: true });
    } else if (E.tool === 'sticker') {
      const op = E.ops.filter((o) => o.type === 'sticker' && o.sid === E.stkSel).pop();
      const sc = op ? Math.round(op.scale * 100) : 32;
      const rt = op ? op.rot : 0;
      const al = op ? Math.round((op.alpha == null ? 1 : op.alpha) * 100) : 100;
      tb.innerHTML = `
        <h4>Sticker ko photo par <b>drag</b> karke rakho. Transparent PNG best rehta hai.</h4>
        <div class="trow"><label>Size</label><input id="skScale" type="range" min="4" max="100" value="${sc}" /><span class="val" id="skScaleV">${sc}%</span></div>
        <div class="trow"><label>Rotate</label><input id="skRot" type="range" min="-180" max="180" value="${rt}" /><span class="val" id="skRotV">${rt}\u00B0</span></div>
        <div class="trow"><label>Opacity</label><input id="skAlpha" type="range" min="10" max="100" value="${al}" /><span class="val" id="skAlphaV">${al}%</span></div>
        <div class="mrow">
          <button id="skNew" class="btn" type="button">+ Naya Sticker</button>
          <button id="skDone" class="btn btn-accent" type="button">Done</button>
        </div>
        <p class="cnote">Sliders selected sticker par lagte hain. Hatana ho to Undo dabao. Sticker auto-save hota hai \u2014 band hone par bhi rahenge.</p>`;
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
    if (!bmp) { toast('Ye sticker file khul nahi payi (PNG/WebP/GIF try karo)', 'err'); return; }
    const sid = ++E.stkSeq;
    E.stickers.push({ sid, bmp, blob });
    E.stkSel = sid;
    pushUndo();
    E.ops.push({ type: 'sticker', sid, x: 0.5, y: 0.45, scale: 0.32, rot: 0, alpha: 1 });
    updUndoBtns();
    setTool('sticker');
    renderPreview();
    scheduleEditSave();
    toast('Sticker lag gaya \u2014 drag karke rakho, sliders se size/rotate', 'ok', 3000);
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
    } else if (E.tool === 'text') {
      const cv = ed.canvas;
      const r = cv.getBoundingClientRect();
      E.pendText = {
        x: clamp((e.clientX - r.left) / r.width, 0.02, 0.98),
        y: clamp((e.clientY - r.top) / r.height, 0.03, 0.97)
      };
      toast(`Text position set: ${Math.round(E.pendText.x * 100)}%, ${Math.round(E.pendText.y * 100)}% — ab "Add Text" dabao`, 'ok', 2200);
    } else if (E.tool === 'sticker') {
      const cv = ed.canvas;
      const r = cv.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
      const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
      const hit = stickerHit(nx, ny) || E.ops.filter((o) => o.type === 'sticker' && o.sid === E.stkSel).pop();
      if (!hit) return;
      E.stkSel = hit.sid;
      pushUndo();
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
    if (dragStk) { dragStk = null; scheduleEditSave(); }
  }));

  /* ---------- auto fixes ---------- */
  function autoContrast() {
    const c = FX.renderStack(E.src, E.ops, null, 900, stickerMap());
    const { lo, hi } = FX.computeLevels(c);
    commit({ type: 'autocontrast', lo, hi });
    toast('Auto Contrast lag gaya', 'ok', 1500);
  }
  function autoColor() {
    const c = FX.renderStack(E.src, E.ops, null, 900, stickerMap());
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
      const c = FX.renderStack(E.src, E.ops, E.adj, 0, stickerMap());
      /* transparent PNG/WebP ho to PNG me save — transparency kabhi nahi khoyegi */
      const wantPng = /\.png$|\.webp$/i.test(E.photo.name) || FX.hasAlpha(c);
      blob = await new Promise((r) => c.toBlob(r, wantPng ? 'image/png' : 'image/jpeg', 0.92));
    } finally {
      setBusy(false);
    }
    return blob;
  }
  async function doSave() {
    const blob = await renderFull();
    if (!blob) { toast('Save fail hua — dobara try karo', 'err'); return; }
    const p = E.photo;
    const oldKey = P.photoKey(p);
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
      /* ab file me pakka ho gaya — auto-save session hatao, naya base set karo */
      await P.idbDel('edits', oldKey).catch(() => {});
      P.invalidateThumb(p);
      p.size = blob.size;
      p.lastModified = Date.now();
      E.saved = true;
      E.dirty = false;
      try { if (E.src && E.src.close) E.src.close(); } catch (e) {}
      E.src = await createImageBitmap(blob).catch(() => E.src);
      E.ops = []; E.adj = { ...ADJ0 }; E.prevAdj = { ...E.adj };
      E.undo = []; E.redo = []; E.stickers = []; E.stkSel = null;
      resetAdjUI(); updFxTiles(); updUndoBtns(); setTool(null);
      await renderPreview();
      ed.dims.textContent = `${E.src.width} \u00D7 ${E.src.height} px \u2022 ${fmtBytes(blob.size)}`;
      toast('Save ho gaya \u2713 — ab ye photo hamesha isi roop me dikhegi', 'ok', 4000);
    } else {
      const ext = blob.type === 'image/png' ? '.png' : '.jpg';
      download(blob, baseName(p.name) + '-edited' + ext);
      toast('Original file direct edit nahi ho payi — edited copy download kar li. (Folder dobara import karo to direct save hoga)', 'err', 8000);
    }
  }
  async function doSaveCopy() {
    const blob = await renderFull();
    if (!blob) { toast('Save fail hua — dobara try karo', 'err'); return; }
    const ext = blob.type === 'image/png' ? '.png' : '.jpg';
    const nm = baseName(E.photo.name) + '-edited' + ext;
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
    E.adj = { ...ADJ0 };
    E.prevAdj = { ...E.adj };
    E.undo = []; E.redo = [];
    E.tool = null; E.cropR = null; E.aspect = 0; E.pendPts = []; E.draft = null;
    E.stickers = []; E.stkSeq = 0; E.stkSel = null;
    E.pendText = { x: 0.5, y: 0.5 }; E.textDraft = { ...TEXT0 };
    E.dirty = false; E.restored = false;
    E.fit = true; E.zoom = 100; ed.zoom.value = 100;

    /* power-cut safe: pichle auto-saved edits wapas load karo */
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
      toast('Pichle edits auto-restore ho gaye \u2713 (Save dabate hi file me pakka ho jayega)', 'ok', 5000);
      E.dirty = true;
    }
  }
  function close() {
    if (!E.open) return;
    E.open = false;
    E.tool = null;
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
      else if (f === 'sticker') q('#stickerFile').click();
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
    if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
  });

  buildFx();
  wireSliders();

  window.PixsaEditor = { open, close, isOpen: () => E.open };
})();
