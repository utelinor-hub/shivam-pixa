/* SHIVAM PIXA — collage.js  (v3.19.0 "PicasaCollage" DOM engine)
   100% Google Picasa 3 authentic collage engine — the user's reference
   prototype, integrated 1:1: every photo is a REAL DOM element (absolute
   positioned, CSS transform rotate+scale), Picasa's center round wheel +
   knob is a real overlay element (donut ring + knob resting at 3 o'clock),
   dragging is native pointer-dragging anywhere on a photo.

   v3.22.2 — the four Picasa-behaviour fixes:
   • Create Collage = one clean action: final image saved to the Collages
     folder + file downloads immediately + working auto-save record cleaned
     up (the "Auto-saved Collage found — reopen it?" bar in index.html was
     deleted — Picasa never nagged; the working collage still resumes
     silently from the Collage tab).
   • right-click opens the context menu EVERYWHERE on a photo: the round
     wheel + knob overlay the photo centre, so contextmenu is now forwarded
     from them too (before, a right-click on the middle of a photo showed
     the browser's own menu).
   • MAGNETIC SNAP while knob-rotating: through the -4°..+4° zone the photo
     clicks to exactly 0° and a small "0°" badge shows at the photo centre.
   • the last Page Format + Landscape/Portrait choice are remembered
     (localStorage pixsa.collageFormat / pixsa.collageOrientation) and
     applied to every NEW collage.

   v3.19.0 — the DOM engine swap:
   • the HTML5-canvas hit-scan renderer is GONE — photos are DOM items now:
     free 60fps dragging, mouse-wheel zoom, Shift+wheel rotate, wheel-knob
     rotate+resize at once (atan2 angle = rotation, distance = scale).
   • the round wheel shows on hover (faint) and selection (strong) and
     counter-rotates so its knob always rests at the ring's right edge
     (3 o'clock, screen-space) — the v3.17.1 reference alignment is kept.
   • right-click menu: Set as Background, Bring to Top / Forward /
     Backward / Bottom, Rotate Right/Left (90°), View and Edit, Remove.
   • Collage Type (Picture Pile / Mosaic / Frame Mosaic / Grid / Contact
     Sheet) now ARRANGES the free items: the slotted types compute their
     slot rectangles and drop every photo into its cell (cover-cropped),
     after which photos stay freely movable — exactly like the prototype.
   • Page Format list, Landscape/Portrait, Picture Borders (None / White /
     Polaroid), Solid Color (+ presets + eyedropper) / Use Image background,
     Draw Shadows, Show Captions, Desktop Background | Create Collage |
     Reset | Close — all preserved.
   • production wiring kept: Library open (tray/folder), IndexedDB
     persistence ('pixsa' → 'collage' auto-save + 'collages' records),
     double-click re-edit with positions, 4K / 300-DPI export, Clips tab
     from the Photo Tray (+ Add Photos from PC), keyboard shortcuts,
     power-cut restore.

   Interactivity: click = select, drag = move (every selected photo),
   wheel = resize, Shift+wheel = rotate, wheel knob = rotate+resize,
   ]/[ = front/back, Delete = remove, Escape = deselect / close. */

(() => {
  'use strict';
  const P = window.Pixsa;
  if (!P) return;
  const { state, toast, getFile, clamp, photoKey } = P;

  const q = (s) => document.querySelector(s);
  const el = {
    root: q('#collage'), wrap: q('#cWrap'), busy: q('#cBusy'), note: q('#cNote'),
    count: q('#cCount'), toolInfo: q('#cToolInfo'),
    fmt: q('#cFormat'), custRow: q('#cCustomRow'), custW: q('#cCustW'), custH: q('#cCustH'),
    custApply: q('#cCustApply'),
    bg: q('#cBg'), bgSolid: q('#cBgSolid'), bgPhoto: q('#cBgPhoto'), eyedrop: q('#cEyedropper'),
    type: q('#cType'), borders: q('#cBorders'),
    orientL: q('#cOrientL'), orientP: q('#cOrientP'),
    shadows: q('#cShadows'), captions: q('#cCaptions'),
    cDesktop: q('#cDesktop'), cReset: q('#cReset'), cClose2: q('#cClose2'),
    tabLib: q('#cTabLib'), tabCol: q('#cTabCol'),
    tabSettings: q('#cTabSettings'), tabClips: q('#cTabClips'),
    paneSettings: q('#cPaneSettings'), paneClips: q('#cPaneClips'),
    clips: q('#cClips'), clipCount: q('#cClipCount'), addPhotos: q('#cAddPhotos'),
    exportFmt: q('#cExportFmt'), resultBar: q('#cResultBar'), resultNote: q('#cResultNote'),
    menu: q('#cMenu'),
    cCreate: q('#cCreate'), cSaveDir: q('#cSaveDir'),
    cDownload: q('#cDownload'), cBack: q('#cBack')
  };
  /* stage + wheel are built here (index.html only provides the shells) */
  const stage = q('#cStage');
  const wheelEl = q('#cWheel');
  const knobEl = q('#cKnob');

  const SLOTTED = ['grid', 'sheet', 'mosaic', 'frame'];
  const ALL_TYPES = ['pile'].concat(SLOTTED);
  const DEG = Math.PI / 180;
  const MAXP = 60;                       /* Picasa-era sanity cap */
  const SCALE_MIN = 0.2, SCALE_MAX = 4.5;

  const S = {
    open: false, list: [], items: [], sel: new Set(), hover: null,
    type: 'pile', bg: '#f5f2ec', bgImage: false, bgIdx: 0,
    border: 'white', landscape: true, shadows: true, captions: false,
    fmt: '4x3', custW: 16, custH: 9, seed: 7,
    alphaAny: false, restored: false, final: false,
    editId: null, editName: '', outW: 0, outH: 0,
    blob: null, url: null, noteBase: '', savedProj: false
  };
  let zTop = 20;

  /* ================= small helpers ================= */
  function rng() {
    let s = S.seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function drawCover(x, img, dx, dy, dw, dh) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sc = Math.max(dw / iw, dh / ih);
    x.drawImage(img, dx + (dw - iw * sc) / 2, dy + (dh - ih * sc) / 2, iw * sc, ih * sc);
  }
  function drawContain(x, img, dx, dy, dw, dh) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sc = Math.min(dw / iw, dh / ih);
    x.drawImage(img, dx + (dw - iw * sc) / 2, dy + (dh - ih * sc) / 2, iw * sc, ih * sc);
  }
  /* deterministic pile geometry — the SAME formula the canvas engine used,
     so old saved collages reopen with their exact scatter (replay: photo i
     consumes rng values i*4 .. i*4+3) */
  function pileFrac(i, n) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cw = 1 / cols, ch = 1 / rows;
    const rand = rng();
    for (let k = 0; k < i * 4; k++) rand();
    return {
      wFrac: cw * (0.55 + rand() * 0.35),
      x: (i % cols) * cw + cw / 2 + (rand() - 0.5) * cw * 0.3,
      y: Math.floor(i / cols) * ch + ch / 2 + (rand() - 0.5) * ch * 0.3,
      rot: (rand() - 0.5) * 30
    };
  }

  /* ================= page geometry ================= */
  const NORM_FMT = { a4: 'letter', '5x7': '4x6', '8x10': 'letter', '11x14': 'letter', '16x20': 'letter' };
  const fmtVal = () => {
    let v = el.fmt.value;
    if (NORM_FMT[v]) v = NORM_FMT[v];
    if (!el.fmt.querySelector(`option[value="${v}"]`)) v = '4x3';
    return v;
  };
  const custR = () => {
    const w = Math.max(1, S.custW || 16), h = Math.max(1, S.custH || 9);
    return clamp(w / h, 0.2, 5);
  };
  function screenDims() {
    const sw = (window.screen && screen.width) || 1920;
    const sh = (window.screen && screen.height) || 1080;
    return [sw, sh];
  }
  function nativeDims(fmt) {
    switch (fmt) {
      case '16x9': return [1920, 1080];
      case '3x2': return [1500, 1000];
      case 'sq': return [1400, 1400];
      case '4x6': return [1200, 1800];
      case 'letter': return [1700, 2200];
      case 'screen': return screenDims();
      case 'custom': {
        const r = custR();
        return r >= 1 ? [Math.round(1600 * r), 1600] : [1600, Math.round(1600 / r)];
      }
      default: return [1600, 1200]; /* 4x3 */
    }
  }
  function dims() {
    const [W, H] = nativeDims(fmtVal());
    return (S.landscape !== (W >= H)) ? [H, W] : [W, H];
  }
  /* hi-res export: screen formats at 4K class, print formats at true
     300 DPI (4x6 = 1800x1200 ... Letter = 2550x3300) */
  function exportDims() {
    let W, H;
    switch (fmtVal()) {
      case '16x9': W = 3840; H = 2160; break;
      case '3x2': W = 3000; H = 2000; break;
      case '4x3': W = 3200; H = 2400; break;
      case 'sq': W = 3000; H = 3000; break;
      case '4x6': W = 1800; H = 1200; break;
      case 'letter': W = 2550; H = 3300; break;
      case 'screen': {
        const [sw, sh] = screenDims();
        const k = Math.min(2, 4200 / Math.max(sw, sh));
        W = Math.round(sw * k); H = Math.round(sh * k);
        break;
      }
      case 'custom': {
        const r = custR();
        W = Math.round(3000 * (r >= 1 ? r : 1));
        H = Math.round(3000 * (r >= 1 ? 1 : 1 / r));
        break;
      }
      default: W = 3200; H = 2400;
    }
    if (S.landscape !== (W >= H)) { const t = W; W = H; H = t; }
    const mx = Math.max(W, H);
    if (mx > 6000) { const k = 6000 / mx; W = Math.round(W * k); H = Math.round(H * k); }
    return [W, H];
  }

  /* ================= engine styles (the reference prototype's) ================= */
  function injectStyles() {
    if (document.getElementById('picasa-collage-styles')) return;
    const style = document.createElement('style');
    style.id = 'picasa-collage-styles';
    style.textContent = `
      /* the preview column centers its children — the stage must stretch */
      .c-prev .c-stage { align-self: stretch; width: auto; }
      #cStage {
        position: relative; background-color: #f5f2ec; background-size: cover;
        background-position: center; box-shadow: 0 5px 22px rgba(0,0,0,0.42);
        overflow: visible; flex: none; touch-action: none;
      }
      .c-item {
        position: absolute; box-sizing: border-box; cursor: grab; touch-action: none;
        transform-origin: center center; line-height: 0;
      }
      .c-item:active { cursor: grabbing; }
      .c-item img { display: block; width: 100%; height: 100%; pointer-events: none; }
      .c-item.selected { outline: 2px solid rgba(255, 153, 0, 0.9); outline-offset: -1px; }
      .c-cap {
        position: absolute; left: 0; right: 0; bottom: 0; line-height: 1.1;
        display: flex; align-items: center; justify-content: center;
        overflow: hidden; white-space: nowrap; pointer-events: none;
        font-family: 'Segoe UI', system-ui, sans-serif;
      }
      /* PICASA 3 AUTHENTIC CENTER ROUND WHEEL + KNOB (counter-rotated so the
         knob always rests at the ring's right edge — 3 o'clock) */
      #cWheel {
        position: absolute; border-radius: 50%;
        border-style: solid; border-color: rgba(110, 120, 130, 0.55);
        box-shadow: inset 0 0 2px rgba(255,255,255,0.85), 0 0 4px rgba(0,0,0,0.35);
        cursor: move; z-index: 99998; box-sizing: border-box;
      }
      #cWheel.hov { border-color: rgba(110, 120, 130, 0.28); }
      #cKnob {
        position: absolute; right: 0; top: 50%; border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, #ffffff, #cfd5de);
        border: 2px solid #333; cursor: ew-resize; box-sizing: border-box;
        box-shadow: 0 1px 4px rgba(0,0,0,0.65); touch-action: none;
      }
      #cKnob:hover { background: #ffffff; }
      /* v3.22.2: MAGNETIC SNAP badge — shows "0°" at the photo centre while
         the knob drags the photo through the straight zone (Picasa style) */
      #cSnap {
        position: absolute; transform: translate(-50%, -50%);
        background: rgba(28, 28, 30, 0.88); color: #fff;
        font: 600 13px 'Segoe UI', system-ui, sans-serif;
        padding: 3px 10px; border-radius: 12px; pointer-events: none;
        z-index: 100001; box-shadow: 0 2px 8px rgba(0,0,0,0.45);
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  /* ================= stage geometry ================= */
  function stageBox() {
    const holder = el.wrap.parentElement || el.wrap;
    const r = holder.getBoundingClientRect();
    const cs = getComputedStyle(holder);
    const availW = Math.max(120, r.width - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0) - 16);
    const availH = Math.max(90, r.height - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0) - 16);
    let [W, H] = dims();
    const target = W / H;
    let sw = availW, sh = sw / target;
    if (sh > availH) { sh = availH; sw = sh * target; }
    return { w: Math.max(200, Math.round(sw)), h: Math.max(150, Math.round(sh)) };
  }
  function updateStageGeometry() {
    if (!stage) return;
    const b = stageBox();
    stage.style.width = b.w + 'px';
    stage.style.height = b.h + 'px';
    refreshBackground();
    S.items.forEach(renderItem);
    positionWheel();
  }

  /* ================= background ================= */
  function refreshBackground() {
    if (!stage) return;
    if (S.bgImage && S.items.length) {
      const it = S.items[Math.min(S.bgIdx, S.items.length - 1)];
      if (it && it.url) stage.style.backgroundImage = `url("${it.url}")`;
    } else {
      stage.style.backgroundImage = 'none';
      stage.style.backgroundColor = S.bg;
    }
  }

  /* ================= items ================= */
  function renderItem(it) {
    if (!it.el || !stage) return;
    const sw = stage.clientWidth || 800, sh = stage.clientHeight || 600;
    const bw = it.wFrac * sw, bh = it.hFrac * sh;
    const u = Math.min(bw, bh);
    const sheet = S.type === 'sheet';
    let pad = 0, bot = 0;
    if (sheet) { pad = bw * 0.045; bot = pad; }
    else if (S.border === 'polaroid') { pad = u * 0.05; bot = u * 0.16; }
    else if (S.border === 'white') { pad = S.type === 'pile' ? u * 0.032 : u * 0.035; bot = pad; }
    it.el.style.width = bw + 'px';
    it.el.style.height = bh + 'px';
    it.el.style.left = (it.x * 100) + '%';
    it.el.style.top = (it.y * 100) + '%';
    it.el.style.zIndex = it.z;
    it.el.style.transform = `translate(-50%, -50%) rotate(${it.rot}deg) scale(${it.scale})`;
    it.el.style.background = (sheet || S.border !== 'none') ? '#ffffff' : 'transparent';
    it.el.style.padding = `${pad}px ${pad}px ${bot}px ${pad}px`;
    it.el.style.boxShadow = S.shadows ? '0 6px 16px rgba(0,0,0,0.38)' : 'none';
    const img = it.el.firstChild;
    if (img) {
      img.style.objectFit = sheet ? 'contain' : (S.type === 'pile' ? 'fill' : 'cover');
      /* cover/contain crop must clip to the padded box */
      it.el.style.overflow = 'hidden';
    }
    /* caption: Picasa writes the name under the photo — inside the white
       border when there is one, on a soft strip when there is none */
    let cap = it.el.querySelector('.c-cap');
    if (S.captions && S.type === 'pile' && it.name) {
      if (!cap) { cap = document.createElement('div'); cap.className = 'c-cap'; it.el.appendChild(cap); }
      const capH = Math.max(10, u * 0.085);
      if (S.border === 'none') {
        cap.style.background = 'rgba(0,0,0,0.45)';
        cap.style.color = '#ffffff';
        cap.style.height = capH + 'px';
        cap.style.left = '0px'; cap.style.right = '0px';
        cap.style.padding = '0 4px';
      } else {
        cap.style.background = 'transparent';
        cap.style.color = '#4a4a4a';
        cap.style.height = Math.max(capH, bot) + 'px';
        cap.style.left = pad + 'px'; cap.style.right = pad + 'px';
        cap.style.padding = '0';
      }
      cap.style.fontSize = Math.max(7, Math.min(capH * 0.66, 13)).toFixed(1) + 'px';
      cap.textContent = it.name;
      cap.style.display = 'flex';
    } else if (cap) cap.style.display = 'none';
  }
  const renderAll = () => S.items.forEach(renderItem);

  function makeItemEl(it) {
    const d = document.createElement('div');
    d.className = 'c-item';
    d.dataset.id = it.id;
    const img = document.createElement('img');
    img.decoding = 'async';
    img.alt = it.name || '';
    img.draggable = false;
    img.src = it.url;
    d.appendChild(img);
    stage.appendChild(d);
    return d;
  }
  /* item factory — async because the blob URL must resolve first */
  async function itemFrom(imgCanvas, name, st) {
    const blob = await new Promise((r) => imgCanvas.toBlob(r, 'image/jpeg', 0.9));
    const it = Object.assign({
      id: 'pi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'photo', img: imgCanvas,
      natW: imgCanvas.width, natH: imgCanvas.height,
      x: 0.5, y: 0.5, rot: 0, scale: 1, z: ++zTop, fit: 'fill',
      url: URL.createObjectURL(blob)
    }, st || {});
    it.el = makeItemEl(it);
    renderItem(it);
    bindItem(it);
    S.items.push(it);
    return it;
  }
  function destroyItem(it) {
    if (it.url) URL.revokeObjectURL(it.url);
    if (it.el) it.el.remove();
  }
  function itemById(id) { return S.items.find((i) => i.id === id); }
  const firstSel = () => { for (const id of S.sel) return itemById(id); return null; };

  /* ================= selection ================= */
  function select(it) {
    S.sel = new Set([it.id]);
    paintSel();
  }
  function selectAll() {
    S.sel = new Set(S.items.map((i) => i.id));
    if (S.items.length) zTopOf(S.items[S.items.length - 1]);
    paintSel();
  }
  function selectNone() { S.sel.clear(); paintSel(); }
  function paintSel() {
    S.items.forEach((it) => it.el.classList.toggle('selected', S.sel.has(it.id)));
    positionWheel();
  }

  /* ================= THE ROUND WHEEL (hover + selection) ================= */
  function wheelTarget() {
    if (S.final || !S.items.length) return null;
    const selIt = firstSel();
    return selIt || (S.hover && itemById(S.hover)) || null;
  }
  function positionWheel() {
    const it = wheelTarget();
    if (!it || !it.el || !wheelEl) { if (wheelEl) wheelEl.hidden = true; return; }
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const bw = it.wFrac * sw * it.scale, bh = it.hFrac * sh * it.scale;
    const R = clamp(Math.min(bw, bh) * 0.38, 20, Math.min(sw, sh) * 0.22);
    const ringW = Math.max(5, R * 0.21);        /* v3.17.1: a touch thicker */
    const knobR = Math.max(5.5, R * 0.2);
    wheelEl.hidden = false;
    wheelEl.style.width = (R * 2) + 'px';
    wheelEl.style.height = (R * 2) + 'px';
    wheelEl.style.borderWidth = ringW + 'px';
    wheelEl.style.left = (it.x * sw - R) + 'px';
    wheelEl.style.top = (it.y * sh - R) + 'px';
    /* counter-rotate: the ring is symmetric, the knob must stay at 3 o'clock */
    wheelEl.style.transform = `rotate(${-it.rot}deg)`;
    wheelEl.classList.toggle('hov', !S.sel.has(it.id));
    knobEl.style.width = (knobR * 2) + 'px';
    knobEl.style.height = (knobR * 2) + 'px';
    knobEl.style.right = (-knobR - 2) + 'px';
    knobEl.style.marginTop = (-knobR) + 'px';
    wheelEl.dataset.id = it.id;
  }

  /* ================= v3.22.2 MAGNETIC SNAP "0°" badge ================= */
  let snapEl = null, snapT = 0;
  function showSnapBadge(it) {
    if (!S.open) return;
    if (!snapEl) {
      snapEl = document.createElement('div');
      snapEl.id = 'cSnap';
      snapEl.textContent = '0\u00b0';
      snapEl.hidden = true;
      stage.appendChild(snapEl);
    }
    snapEl.style.left = (it.x * stage.clientWidth) + 'px';
    snapEl.style.top = (it.y * stage.clientHeight - 34) + 'px';
    snapEl.hidden = false;
    clearTimeout(snapT);
    snapT = setTimeout(() => { if (snapEl) snapEl.hidden = true; }, 900);
  }
  function hideSnapBadge() {
    clearTimeout(snapT);
    if (snapEl) snapEl.hidden = true;
  }

  /* ================= item interactions (the prototype's, 1:1) ================= */
  function bindItem(it) {
    /* 1. SMOOTH FREE DRAGGING (anywhere on the photo) — every selected
          photo moves together, like Picasa's multi-drag */
    it.el.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      e.stopPropagation();
      if (S.final) return;
      /* clicking an already-selected photo keeps the multi-selection */
      if (!S.sel.has(it.id)) select(it);
      const rect = stage.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const orig = S.items.filter((i) => S.sel.has(i.id)).map((i) => ({ i, x: i.x, y: i.y }));
      const onMove = (ev) => {
        const dx = (ev.clientX - startX) / rect.width;
        const dy = (ev.clientY - startY) / rect.height;
        for (const o of orig) {
          o.i.x = clamp(o.x + dx, -0.5, 1.5);
          o.i.y = clamp(o.y + dy, -0.5, 1.5);
          renderItem(o.i);
        }
        positionWheel();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        scheduleColSave();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    /* 2. WHEEL KNOB: SIMULTANEOUS ROTATE + SCALE (angle + distance) */
    knobEl.addEventListener('pointerdown', (e) => {
      if (S.final) return;
      e.stopPropagation();
      e.preventDefault();
      const tgt = itemById(wheelEl.dataset.id);
      if (!tgt) return;
      select(tgt);
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const rect = stage.getBoundingClientRect();
      const cx = rect.left + tgt.x * sw, cy = rect.top + tgt.y * sh;
      const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
      const startDist = Math.hypot(e.clientX - cx, e.clientY - cy);
      const origRot = tgt.rot, origScale = tgt.scale;
      const onMove = (ev) => {
        const curAngle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
        const curDist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        let rot = origRot + (curAngle - startAngle);
        tgt.scale = clamp(origScale * (curDist / Math.max(20, startDist)), SCALE_MIN, SCALE_MAX);
        /* v3.22.2 MAGNETIC SNAP (Picasa straighten): while the knob drags the
           rotation through the -4°..+4° zone, the photo clicks to exactly 0°
           and a "0°" badge flashes at the photo centre — no more "almost
           straight but not quite" */
        const norm = ((rot % 360) + 540) % 360 - 180;   /* (-180, 180] */
        if (Math.abs(norm) <= 4) {
          if (norm !== 0) showSnapBadge(tgt);
          rot = 0;
        }
        tgt.rot = rot;
        renderItem(tgt);
        positionWheel();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        hideSnapBadge();
        scheduleColSave();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    /* wheel ring body = drag the photo too (Picasa: grab the ring to move) */
    wheelEl.addEventListener('pointerdown', (e) => {
      if (e.target === knobEl || e.button === 2) return;
      const tgt = itemById(wheelEl.dataset.id);
      if (!tgt || S.final) return;
      e.stopPropagation();
      select(tgt);
      const rect = stage.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const ox = tgt.x, oy = tgt.y;
      const onMove = (ev) => {
        tgt.x = clamp(ox + (ev.clientX - startX) / rect.width, -0.5, 1.5);
        tgt.y = clamp(oy + (ev.clientY - startY) / rect.height, -0.5, 1.5);
        renderItem(tgt);
        positionWheel();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        scheduleColSave();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    /* 3. MOUSE WHEEL ZOOM + SHIFT+WHEEL ROTATE */
    it.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (S.final) return;
      select(it);
      if (e.shiftKey) it.rot += e.deltaY > 0 ? 5 : -5;
      else it.scale = clamp(it.scale * (e.deltaY < 0 ? 1.07 : 0.93), SCALE_MIN, SCALE_MAX);
      renderItem(it);
      positionWheel();
      scheduleColSave();
    }, { passive: false });

    /* 4. PICASA RIGHT-CLICK CONTEXT MENU */
    it.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      select(it);
      openMenu(e.clientX, e.clientY, it);
    });

    /* 5. hover shows the faint wheel */
    it.el.addEventListener('pointerenter', () => { S.hover = it.id; positionWheel(); });
    it.el.addEventListener('pointerleave', () => { if (S.hover === it.id) { S.hover = null; positionWheel(); } });
  }

  /* ================= z-order (prototype semantics) ================= */
  function changeZ(it, dir) {
    if (dir === 'top') it.z = ++zTop;
    else if (dir === 'forward') it.z += 2;
    else if (dir === 'backward') it.z = Math.max(1, it.z - 2);
    else if (dir === 'bottom') it.z = 1;
    renderItem(it);
    scheduleColSave();
  }
  function rotateOne(it, deg) {
    it.rot += deg;
    renderItem(it);
    scheduleColSave();
  }

  /* ================= remove / background / view-edit ================= */
  function removeSelected() {
    const it = firstSel();
    if (!it) return;
    returnToClips(it);
    destroyItem(it);
    S.items.splice(S.items.indexOf(it), 1);
    S.sel.delete(it.id);
    S.hover = null;
    if (S.bgImage && S.bgIdx >= S.items.length) S.bgIdx = 0;
    syncClips();
    noteCount();
    refreshBackground();
    positionWheel();
    scheduleColSave();
  }
  /* removed photos drop back into the Clips tray (the Photo Tray) */
  function returnToClips(it) {
    if (!P.state) return;
    const item = S.list[S.items.indexOf(it)];
    if (!item) return;
    const k = photoKey(item);
    const lib = P.state.photos || [];
    const lp = lib.find((p) => photoKey(p) === k) ||
               lib.find((p) => p.name === item.name);   /* re-edited records */
    if (lp && !P.state.selArr.some((x) => photoKey(x) === photoKey(lp))) {
      P.state.selArr.push(lp);
      if (P.renderTray) P.renderTray();
    }
  }
  function setAsBackground() {
    const it = firstSel();
    if (!it) return;
    S.bgIdx = S.items.indexOf(it);
    S.bgImage = true;
    el.bgPhoto.checked = true;
    el.bgSolid.checked = false;
    refreshBackground();
    scheduleColSave();
  }
  function viewAndEdit() {
    const it = firstSel();
    if (!it) { toast('Select a photo first, then press View and Edit', 'err'); return; }
    const item = S.list[S.items.indexOf(it)];
    const k = item ? photoKey(item) : null;
    const idx = k != null ? state.photos.findIndex((p) => photoKey(p) === k) : -1;
    if (idx < 0) { toast('This photo is not in the library — View and Edit works with library photos', 'err', 4500); return; }
    close();
    if (window.PixsaEditor) window.PixsaEditor.open(idx);
  }

  /* ================= v3.19.0: context menu ================= */
  function openMenu(cx, cy, it) {
    const m = el.menu;
    m.innerHTML = '';
    const add = (label, cmd, dis) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.disabled = !!dis;
      b.addEventListener('click', () => { m.hidden = true; menuCmd(cmd, it); });
      m.appendChild(b);
    };
    const sep = () => { const s = document.createElement('div'); s.className = 'csep'; m.appendChild(s); };
    add('Set as Background', 'setbg');
    sep();
    add('Bring to Top', 'top');
    add('Bring Forward', 'fwd');
    add('Send Backward', 'back1');
    add('Send to Bottom', 'bottom');
    sep();
    add('Rotate Right (90\u00b0)', 'rotR');
    add('Rotate Left (-90\u00b0)', 'rotL');
    sep();
    add('View and Edit', 'view');
    add('Remove', 'remove');
    m.hidden = false;
    m.style.left = '0px'; m.style.top = '0px';
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(cx, window.innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(6, Math.min(cy, window.innerHeight - r.height - 8)) + 'px';
  }
  function menuCmd(cmd, it) {
    if (!it || S.final) return;
    select(it);
    switch (cmd) {
      case 'setbg': setAsBackground(); break;
      case 'top': changeZ(it, 'top'); break;
      case 'fwd': changeZ(it, 'forward'); break;
      case 'back1': changeZ(it, 'backward'); break;
      case 'bottom': changeZ(it, 'bottom'); break;
      case 'rotR': rotateOne(it, 90); break;
      case 'rotL': rotateOne(it, -90); break;
      case 'view': viewAndEdit(); break;
      case 'remove': removeSelected(); break;
    }
  }

  /* ================= LAYOUTS — slotted types arrange the free items ================= */
  /* every layout returns slot rects {x,y,w,h} in 0..1 stage fractions; the
     items are dropped into the cells (cover-cropped), then stay draggable */
  /* all slot functions work in STAGE PIXELS (W × H with the page ratio);
     applyLayout converts each rect to per-axis fractions */
  function slotCells(n, W, H, sheet) {
    const sp = sheet ? 16 : 8;
    const marg = sheet ? 34 : 14;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * (W / H))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cw = (W - marg * 2 - sp * (cols - 1)) / cols;
    const ch = (H - marg * 2 - sp * (rows - 1)) / rows;
    const out = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols && i < n; c++, i++) {
        out.push({ x: marg + c * (cw + sp), y: marg + r * (ch + sp), w: cw, h: ch });
      }
    }
    return out;
  }
  function packRowsSlots(ox, oy, Rw, Rh, imgs, sp) {
    /* justified tessellation: R rows close up exactly (no gaps) */
    const m = imgs.length, out = new Array(m);
    if (!m || Rw <= 4 || Rh <= 4) return out.fill({ x: ox, y: oy, w: Rw, h: Rh });
    sp = Math.min(sp, Rw / 4, Rh / 4);
    const asp = imgs.map((im) => (im.natW || 1) / (im.natH || 1));
    const totalA = asp.reduce((a, b) => a + b, 0);
    const R = clamp(Math.round(Math.sqrt(totalA * Rh / Rw)), 1, m);
    const rows = [];
    let i = 0;
    for (let r = 0; r < R; r++) {
      const left = m - i, rowsLeft = R - r;
      const take = r === R - 1 ? left : Math.max(1, Math.min(left - (rowsLeft - 1), Math.round(left / rowsLeft)));
      const row = [];
      for (let k = 0; k < take && i < m; k++, i++) row.push(i);
      row.A = row.reduce((a, j) => a + asp[j], 0);
      row.h = (Rw - sp * (row.length - 1)) / row.A;
      rows.push(row);
    }
    const hSum = rows.reduce((a, row) => a + row.h, 0);
    const sy = (Rh - sp * (rows.length - 1)) / hSum;
    let y = oy;
    for (const row of rows) {
      const h = row.h * sy;
      const wSum = Rw - sp * (row.length - 1);
      let cx = ox;
      for (const j of row) {
        const w = wSum * (asp[j] / row.A);
        out[j] = { x: cx, y, w, h };
        cx += w + sp;
      }
      y += h + sp;
    }
    return out;
  }
  function slotMosaic(W, H) {
    const n = S.items.length;
    const sp = 8;
    const land = W >= H;
    const out = new Array(n);
    if (!n) return out;
    if (n === 1) { out[0] = { x: 0, y: 0, w: W, h: H }; return out; }
    if (n === 2) {
      if (land) {
        const w2 = (W - sp) / 2;
        out[0] = { x: 0, y: 0, w: w2, h: H };
        out[1] = { x: w2 + sp, y: 0, w: w2, h: H };
      } else {
        const h2 = (H - sp) / 2;
        out[0] = { x: 0, y: 0, w: W, h: h2 };
        out[1] = { x: 0, y: h2 + sp, w: W, h: h2 };
      }
      return out;
    }
    const f = n >= 6 ? 2 : 1;
    const fw = land ? Math.round(W * 0.5) : W;
    const fh = land ? H : Math.round(H * 0.52);
    if (f === 1) {
      out[0] = { x: 0, y: 0, w: fw, h: fh };
    } else if (land) {
      const h2 = (fh - sp) / 2;
      out[0] = { x: 0, y: 0, w: fw, h: h2 };
      out[1] = { x: 0, y: h2 + sp, w: fw, h: h2 };
    } else {
      const w2 = (fw - sp) / 2;
      out[0] = { x: 0, y: 0, w: w2, h: fh };
      out[1] = { x: w2 + sp, y: 0, w: w2, h: fh };
    }
    const tx = land ? fw + sp : 0;
    const ty = land ? 0 : fh + sp;
    const tw = land ? W - fw - sp : W;
    const th = land ? H : H - fh - sp;
    const rest = packRowsSlots(tx, ty, tw, th, S.items.slice(f), sp);
    for (let k = 0; k < rest.length; k++) out[f + k] = rest[k];
    return out;
  }
  function slotFrame(W, H) {
    const n = S.items.length;
    const sp = 8;
    const out = new Array(n);
    if (n <= 2) return slotMosaic(W, H);
    const m = n - 1;
    let kT, kB, kL, kR, tv, th;
    if (m < 4) {
      kT = Math.ceil(m / 2); kB = m - kT; kL = 0; kR = 0;
      tv = Math.min(H * clamp(0.16 + 0.07 * m, 0.22, 0.42), (H - 2 * sp) / 2);
      th = 0;
    } else {
      tv = clamp(H * 0.24, H * 0.08, Math.max(H * 0.08, (H - 3 * sp) / 2));
      th = clamp(W * 0.24, W * 0.08, Math.max(W * 0.08, (W - 3 * sp) / 2));
      const sideOK = () => th > sp && H - 2 * (tv + sp) > sp;
      const capOf = () => 2 * Math.max(1, Math.round(W / tv)) +
        (sideOK() ? 2 * Math.max(1, Math.round((H - 2 * (tv + sp)) / th)) : 0);
      let cap = capOf(), guard = 80;
      while (cap < m && guard-- > 0) {
        const k = Math.max(0.8, Math.sqrt(cap / m));
        const ntv = Math.max(H * 0.06, tv * k), nth = Math.max(W * 0.06, th * k);
        if (ntv === tv && nth === th) break;
        tv = ntv; th = nth;
        cap = capOf();
      }
      const bandH = H - 2 * (tv + sp);
      const sides = sideOK();
      const strips = [
        { key: 'T', w: W }, { key: 'B', w: W },
        ...(sides ? [{ key: 'L', w: bandH }, { key: 'R', w: bandH }] : [])
      ];
      const wSum = strips.reduce((a, s) => a + s.w, 0);
      for (const s of strips) s.k = Math.max(1, Math.round(m * s.w / wSum));
      let tot = strips.reduce((a, s) => a + s.k, 0), g2 = 300;
      while (tot !== m && g2-- > 0) {
        if (tot > m) {
          const s = strips.reduce((best, v) => (v.k > best.k ? v : best), strips[0]);
          if (s.k <= 1) break;
          s.k--; tot--;
        } else {
          const s = strips.reduce((best, v) => (v.k < best.k ? v : best), strips[0]);
          s.k++; tot++;
        }
      }
      kT = strips.find((s) => s.key === 'T').k;
      kB = strips.find((s) => s.key === 'B').k;
      kL = sides ? strips.find((s) => s.key === 'L').k : 0;
      kR = sides ? strips.find((s) => s.key === 'R').k : 0;
      if (!kL) th = 0;
    }
    const cx = kL > 0 ? th + sp : 0;
    const cy = kT > 0 ? tv + sp : 0;
    const cw2 = W - (kL > 0 ? 2 * (th + sp) : 0);
    const ch2 = H - (kT > 0 ? 2 * (tv + sp) : 0);
    const put = (i, x, y, w, h) => { out[i] = { x, y, w, h }; };
    if (cw2 > 4 && ch2 > 4) put(0, cx, cy, cw2, ch2);
    let idx = 1;
    if (kT > 0) {
      const w = (W - sp * (kT - 1)) / kT;
      for (let k = 0; k < kT && idx < n; k++, idx++) put(idx, k * (w + sp), 0, w, tv);
    }
    if (kR > 0) {
      const bandY = tv + sp, bandH = H - 2 * (tv + sp);
      const h = (bandH - sp * (kR - 1)) / kR;
      for (let k = 0; k < kR && idx < n; k++, idx++) put(idx, W - th, bandY + k * (h + sp), th, h);
    }
    if (kB > 0) {
      const w = (W - sp * (kB - 1)) / kB;
      for (let k = 0; k < kB && idx < n; k++, idx++) put(idx, k * (w + sp), H - tv, w, tv);
    }
    if (kL > 0) {
      const bandY = tv + sp, bandH = H - 2 * (tv + sp);
      const h = (bandH - sp * (kL - 1)) / kL;
      for (let k = 0; k < kL && idx < n; k++, idx++) put(idx, 0, bandY + k * (h + sp), th, h);
    }
    return out;
  }
  /* apply the current type's arrangement to the free items */
  function applyLayout(save) {
    const n = S.items.length;
    if (!n) return;
    const [W, H] = dims();
    if (S.type === 'pile') {
      /* back to the automatic Picasa scatter */
      S.items.forEach((it, i) => {
        const g = pileFrac(i, n);
        it.x = g.x; it.y = g.y; it.rot = g.rot;
        it.wFrac = g.wFrac; it.hFrac = g.wFrac * (it.natH / it.natW) * (W / H);
        it.scale = 1; it.fit = 'fill';
      });
    } else {
      let slots;
      if (S.type === 'mosaic') slots = slotMosaic(W, H);
      else if (S.type === 'frame') slots = slotFrame(W, H);
      else slots = slotCells(n, W, H, S.type === 'sheet');
      /* slots are stage-pixel rects (W × H with the page ratio) —
         convert to per-axis fractions of the live stage */
      S.items.forEach((it, i) => {
        const s = slots[i] || { x: 0, y: 0, w: W, h: H };
        it.x = (s.x + s.w / 2) / W;
        it.y = (s.y + s.h / 2) / H;
        it.wFrac = s.w / W;        /* fraction of stage width */
        it.hFrac = s.h / H;        /* fraction of stage height */
        it.rot = 0; it.scale = 1;
        it.fit = S.type === 'sheet' ? 'contain' : 'cover';
      });
    }
    /* draw order follows list order after an auto-layout */
    S.items.forEach((it, i) => { it.z = i + 1; });
    zTop = n + 20;
    renderAll();
    positionWheel();
    refreshBackground();
    if (save) scheduleColSave();
  }

  /* ================= scramble / shuffle ================= */
  function scramble() {
    if (S.final || !S.items.length) return;
    S.type = 'pile';
    el.type.value = 'pile';
    S.items.forEach((it) => {
      it.x = 0.2 + Math.random() * 0.6;
      it.y = 0.2 + Math.random() * 0.6;
      it.rot = (Math.random() - 0.5) * 32;
      it.scale = 1;
    });
    renderAll();
    positionWheel();
    scheduleColSave();
  }
  function shufflePictures() {
    if (S.final || S.items.length < 2) return;
    const states = S.items.map((i) => ({ x: i.x, y: i.y, rot: i.rot }));
    states.sort(() => Math.random() - 0.5);
    S.items.forEach((it, idx) => {
      it.x = states[idx].x; it.y = states[idx].y; it.rot = states[idx].rot;
      renderItem(it);
    });
    positionWheel();
    scheduleColSave();
  }

  /* ================= photo decoding ================= */
  async function decodeToCanvas(src) {
    let bmp;
    try { bmp = await createImageBitmap(src, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await createImageBitmap(src); }
    /* always land on a real <canvas> — items need toBlob + drawImage */
    const t = document.createElement('canvas');
    if (Math.max(bmp.width, bmp.height) > 1400) {
      const sc = 1400 / Math.max(bmp.width, bmp.height);
      t.width = Math.round(bmp.width * sc);
      t.height = Math.round(bmp.height * sc);
    } else {
      t.width = bmp.width; t.height = bmp.height;
    }
    t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
    if (bmp.close) bmp.close();
    return t;
  }
  async function loadImgs(list) {
    el.busy.hidden = false;
    const out = [];
    S.alphaAny = list.some((p) => /\.(png|webp|gif)$/i.test(p.name || ''));
    for (const p of list) {
      try {
        const file = await getFile(p);
        out.push(await decodeToCanvas(file));
      } catch (e) { /* skip unreadable */ }
    }
    el.busy.hidden = true;
    return out;
  }
  /* place a freshly added photo in the middle, on top, selected */
  function freshState() {
    return { x: 0.5, y: 0.5, rot: 0, scale: 1, z: ++zTop, fit: 'fill' };
  }

  /* ================= Clips tab (Photo Tray + PC files) ================= */
  const clipThumbs = new Map();
  function syncClips() {
    if (!el.clips) return;
    const tray = (P.state && P.state.selArr) || [];
    if (el.clipCount) el.clipCount.textContent = String(tray.length);
    if (!S.open || el.root.hidden) return;
    const box = el.clips;
    box.innerHTML = '';
    if (!tray.length) {
      const tip = document.createElement('div');
      tip.className = 'cliptip';
      tip.textContent = 'Select photos in the Library — they appear here as Clips. You can also add photos straight from your PC below.';
      box.appendChild(tip);
      return;
    }
    const inCol = new Set(S.list.map((x) => photoKey(x)));
    for (const p of tray) {
      const k = photoKey(p);
      const used = inCol.has(k);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'clip';
      b.title = used ? `${p.name} — in the collage; click to drop another copy` : `Add ${p.name} to the collage`;
      const img = document.createElement('img');
      img.decoding = 'async'; img.alt = '';
      b.appendChild(img);
      if (used) { const t = document.createElement('span'); t.className = 'inuse'; t.textContent = 'in collage'; b.appendChild(t); }
      b.addEventListener('click', () => addClipPhoto(p));
      box.appendChild(b);
      if (clipThumbs.has(k)) img.src = clipThumbs.get(k);
      else clipThumb(p, img, k);
    }
  }
  async function clipThumb(p, imgEl, k) {
    try {
      const file = await getFile(p);
      const bmp = await decodeToCanvas(file);
      const c = document.createElement('canvas');
      const sc = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
      c.width = Math.max(1, Math.round(bmp.width * sc));
      c.height = Math.max(1, Math.round(bmp.height * sc));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.78);
      clipThumbs.set(k, url);
      if (imgEl.isConnected) imgEl.src = url;
    } catch (e) { /* unreadable clip — leave blank */ }
  }
  async function addClipPhoto(p) {
    if (S.items.length >= MAXP) { toast('The collage is full (60 photos max)', 'err'); return; }
    el.busy.hidden = false;
    try {
      const file = await getFile(p);
      const canvas = await decodeToCanvas(file);
      const st = freshState();
      const [W, H] = dims();
      const n = S.items.length;
      const g = pileFrac(n, n + 1);
      st.wFrac = g.wFrac;
      st.hFrac = g.wFrac * (canvas.height / canvas.width) * (W / H);
      S.list.push(p);
      if (/\.(png|webp|gif)$/i.test(p.name || '')) S.alphaAny = true;
      const it = await itemFrom(canvas, p.name || 'photo', st);
      select(it);
      syncClips();
      noteCount();
      refreshBackground();
      scheduleColSave();
      toast(`${it.name} added to the collage — drag it anywhere`, 'ok', 2600);
    } catch (e) { toast('That photo could not be added', 'err'); }
    el.busy.hidden = true;
  }
  async function addFileToCollage(f) {
    if (!f) return;
    if (!/^image\//.test(f.type || '') && !/\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(f.name || '')) return;
    if (S.items.length >= MAXP) { toast('The collage is full (60 photos max)', 'err'); return; }
    el.busy.hidden = false;
    try {
      const canvas = await decodeToCanvas(f);
      const st = freshState();
      const [W, H] = dims();
      const n = S.items.length;
      const g = pileFrac(n, n + 1);
      st.wFrac = g.wFrac;
      st.hFrac = g.wFrac * (canvas.height / canvas.width) * (W / H);
      S.list.push({ name: f.name || 'photo', size: f.size || 0, lastModified: f.lastModified || 0, handle: null, file: f });
      if (/\.(png|webp|gif)$/i.test(f.name || '') || f.type === 'image/png') S.alphaAny = true;
      const it = await itemFrom(canvas, f.name || 'photo', st);
      select(it);
      syncClips();
      noteCount();
      refreshBackground();
      scheduleColSave();
      toast(`${it.name} added to the collage — drag it anywhere`, 'ok', 2600);
    } catch (e) { toast('That photo could not be added', 'err'); }
    el.busy.hidden = true;
  }

  /* ================= persistence (IndexedDB, Picasa-style re-edit) ======= */
  let colSaveT = null;
  function scheduleColSave() {
    if (!S.open) return;
    clearTimeout(colSaveT);
    colSaveT = setTimeout(saveCollageProject, 1200);
  }
  async function imgToBlob(im) {
    const c = document.createElement('canvas');
    c.width = im.width || im.naturalWidth; c.height = im.height || im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const alpha = window.PixsaFX ? window.PixsaFX.hasAlpha(c) : false;
    return await new Promise((r) => c.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.88));
  }
  async function collectPhotoBlobs() {
    const photos = [];
    for (let i = 0; i < S.items.length && i < 40; i++) {
      const b = await imgToBlob(S.items[i].img);
      if (!b) continue;
      const li = S.list[i] || {};
      photos.push({
        name: S.items[i].name || ('photo-' + (i + 1)),
        size: li.size || 0, lastModified: li.lastModified || 0,
        blob: b
      });
    }
    return photos;
  }
  /* the shared state snapshot — pos/geo are resolution-independent */
  function stateSnapshot() {
    return {
      type: S.type, bg: S.bg, bgImage: S.bgImage, border: S.border,
      landscape: S.landscape, bgIdx: S.bgIdx, seed: S.seed, fmt: fmtVal(),
      custW: S.custW, custH: S.custH, shadows: S.shadows, captions: S.captions,
      exportFmt: el.exportFmt.value,
      pos: S.items.map((it) => ({ x: it.x, y: it.y, rot: it.rot * DEG, scale: it.scale })),
      geo: S.items.map((it) => ({ w: it.wFrac, h: it.hFrac })),
      zarr: S.items.map((it) => it.z)
    };
  }
  async function saveCollageProject() {
    /* v3.22.2: once Create Collage finished, the working auto-save must not
       resurrect the 'current' record (an in-flight timer could re-write it
       after create() cleaned it up) */
    if (!S.open || S.final || !S.items.length) return;
    try {
      const photos = await collectPhotoBlobs();
      if (!photos.length) return;
      const [pw, ph] = dims();
      const k = Math.min(1, 1400 / Math.max(pw, ph));
      const pv = renderExport(Math.round(pw * k), Math.round(ph * k));
      const previewBlob = await new Promise((r) => pv.toBlob(r, S.alphaAny ? 'image/png' : 'image/jpeg', 0.9));
      const proj = Object.assign(stateSnapshot(), {
        photos, previewBlob, ts: Date.now(),
        editId: S.editId, editName: S.editName   /* an interrupted re-edit reopens linked */
      });
      await P.idbSet('collage', 'current', proj);
      S.savedProj = true;
    } catch (e) { /* storage full — Create/Download still work */ }
  }
  /* every Create Collage stores a full record (result + photos + positions)
     in the 'collages' store — double-clicking it in the library reopens it */
  async function saveCollage() {
    if (!S.blob) return;
    try {
      const photos = await collectPhotoBlobs();
      if (!photos.length) return;
      const id = S.editId || ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
      let name = S.editName;
      if (!name) {
        const d = new Date();
        const p2 = (n) => String(n).padStart(2, '0');
        name = `Collage ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}.jpg`;
      }
      const rec = Object.assign(stateSnapshot(), {
        id, name, ts: Date.now(), blob: S.blob, w: S.outW || 0, h: S.outH || 0, photos
      });
      await P.idbSet('collages', id, rec);
      if (P.addCollageItem) P.addCollageItem(rec);
      S.editId = id; S.editName = name;
      toast('Collage saved to the Collages folder', 'ok', 3500);
    } catch (e) { /* storage full — Download still works */ }
  }
  async function editCollage(id) {
    try {
      const rec = await P.idbGet('collages', id);
      if (!rec || !rec.photos || !rec.photos.length || !rec.blob) { toast('This collage could not be opened', 'err'); return; }
      await openRestored(Object.assign({}, rec, { editId: id, previewBlob: rec.blob }));
    } catch (e) { toast('This collage could not be opened', 'err'); }
  }

  /* ================= export (one renderer: preview + 4K / 300 DPI) ======= */
  function renderExport(W, H) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(W)); c.height = Math.max(2, Math.round(H));
    W = c.width; H = c.height;
    const x = c.getContext('2d');
    x.fillStyle = S.bg;
    x.fillRect(0, 0, W, H);
    const n = S.items.length;
    if (!n) return c;
    /* Use Image background: the chosen photo, cover-fitted (the prototype's way) */
    if (S.bgImage) {
      const bi = S.items[Math.min(S.bgIdx, n - 1)];
      if (bi && bi.img) drawCover(x, bi.img, 0, 0, W, H);
    }
    const k = W;   /* slots are proportional — fractions map straight over */
    const sorted = [...S.items].sort((a, b) => a.z - b.z);
    const sheet = S.type === 'sheet';
    for (const it of sorted) {
      const bw = it.wFrac * k * it.scale;
      const bh = it.hFrac * H * it.scale;
      const cx = it.x * W, cy = it.y * H;
      const u = Math.min(bw, bh);
      let pad = 0, bot = 0;
      if (sheet) { pad = bw * 0.045; bot = pad; }
      else if (S.border === 'polaroid') { pad = u * 0.05; bot = u * 0.16; }
      else if (S.border === 'white') { pad = S.type === 'pile' ? u * 0.032 : u * 0.035; bot = pad; }
      x.save();
      x.translate(cx, cy);
      x.rotate(it.rot * DEG);
      if (S.shadows) {
        x.shadowColor = 'rgba(0,0,0,0.38)';
        x.shadowBlur = Math.min(W, H) * 0.006 * it.scale;
        x.shadowOffsetY = Math.min(W, H) * 0.002 * it.scale;
      }
      if (sheet || S.border !== 'none') {
        x.fillStyle = '#ffffff';
        x.fillRect(-bw / 2, -bh / 2, bw, bh);
      }
      x.shadowColor = 'transparent';
      const ix = -bw / 2 + pad, iy = -bh / 2 + pad;
      const iw = Math.max(4, bw - pad * 2), ih = Math.max(4, bh - pad - bot);
      if (sheet) drawContain(x, it.img, ix, iy, iw, ih);
      else if (S.type === 'pile') x.drawImage(it.img, ix, iy, iw, ih);
      else drawCover(x, it.img, ix, iy, iw, ih);
      /* captions: pile photos get the Picasa name strip */
      if (S.captions && S.type === 'pile' && it.name) {
        const capH = Math.max(10, u * 0.085);
        let cn = it.name;
        x.save();
        x.beginPath();
        if (S.border === 'none') {
          x.rect(-bw / 2, bh / 2 - capH, bw, capH);
          x.fillStyle = 'rgba(0,0,0,0.45)';
        } else {
          x.rect(-bw / 2 + pad, bh / 2 - Math.max(capH, bot), bw - pad * 2, Math.max(capH, bot));
          x.fillStyle = '#4a4a4a';
        }
        x.clip();
        x.fill();
        x.fillStyle = S.border === 'none' ? '#ffffff' : '#4a4a4a';
        x.font = `${Math.max(7, Math.min(capH * 0.66, 18)).toFixed(1)}px 'Segoe UI', system-ui, sans-serif`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const rw = S.border === 'none' ? bw : bw - pad * 2;
        while (cn.length > 3 && x.measureText(cn).width > rw * 0.94) cn = cn.slice(0, -2);
        if (cn !== it.name && cn.length > 3) cn = cn.slice(0, -1) + '\u2026';
        const ty = bh / 2 - (S.border === 'none' ? capH / 2 : Math.max(capH, bot) / 2);
        x.fillText(cn, 0, ty, rw * 0.94);
        x.restore();
      }
      x.restore();
    }
    return c;
  }

  /* ================= open / close / create ================= */
  function noteCount() {
    el.count.textContent = S.items.length
      ? `${S.items.length} photo${S.items.length !== 1 ? 's' : ''} in the collage`
      : '';
  }
  function updateUI() {
    el.orientL.classList.toggle('on', S.landscape);
    el.orientP.classList.toggle('on', !S.landscape);
    for (const b of el.borders.querySelectorAll('button')) b.classList.toggle('on', b.dataset.b === S.border);
    el.type.value = ALL_TYPES.includes(S.type) ? S.type : 'pile';
    el.shadows.checked = S.shadows;
    el.captions.checked = S.captions;
    el.bgPhoto.checked = S.bgImage;
    el.bgSolid.checked = !S.bgImage;
    el.bg.value = S.bg;
    el.cDesktop.disabled = el.cCreate.disabled = S.final;
    el.toolInfo.textContent = 'Drag to move \u2022 drag the wheel knob to rotate + resize \u2022 wheel resizes \u2022 Shift+wheel rotates \u2022 right-click for more';
    noteCount();
    if (S.noteBase && !S.final) {
      el.note.textContent = S.noteBase +
        ' \u2022 Drag the wheel knob to rotate + resize \u2014 wheel resizes, Shift+wheel rotates, right-click for more';
    }
  }
  async function open(list) {
    if (!list || !list.length) return;
    S.list = list.slice(0, MAXP);
    S.open = true;
    S.blob = null;
    S.restored = false;
    S.type = 'pile';
    S.sel.clear(); S.hover = null;
    S.editId = null; S.editName = '';
    S.bgIdx = 0;
    /* a brand-new collage always starts on Solid Color */
    S.bgImage = false;
    S.final = false;
    clearTimeout(colSaveT);
    if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
    el.root.hidden = false;
    el.resultBar.hidden = true;
    /* v3.22.2: a brand-new collage starts with the page format + orientation
       the user used LAST time (Picasa remembered it too). Saved collages
       reopened from the library keep their own format (openRestored). */
    try {
      const lastFmt = localStorage.getItem('pixsa.collageFormat');
      if (lastFmt) {
        let fmtVal2 = NORM_FMT[lastFmt] || lastFmt;
        for (const o of el.fmt.options) {
          if (o.value === fmtVal2) { el.fmt.value = fmtVal2; break; }
        }
      }
      const lastOrient = localStorage.getItem('pixsa.collageOrientation');
      if (lastOrient === 'portrait') S.landscape = false;
      else if (lastOrient === 'landscape') S.landscape = true;
    } catch (e) {}
    el.custRow.hidden = fmtVal() !== 'custom';
    clearItems();
    updateUI();
    const canvases = await loadImgs(S.list);
    const [W, H] = dims();
    for (let i = 0; i < canvases.length; i++) {
      const g = pileFrac(i, canvases.length);
      await itemFrom(canvases[i], S.list[i] ? S.list[i].name : 'photo', {
        x: g.x, y: g.y, rot: g.rot,
        wFrac: g.wFrac, hFrac: g.wFrac * (canvases[i].height / canvases[i].width) * (W / H),
        fit: 'fill', z: i + 1
      });
    }
    zTop = canvases.length + 20;
    updateStageGeometry();
    syncClips();
    noteCount();
    refreshBackground();
    positionWheel();
    scheduleColSave();
  }
  function clearItems() {
    S.items.forEach(destroyItem);
    S.items = [];
    S.sel.clear();
    S.hover = null;
  }
  function close() {
    S.open = false;
    el.root.hidden = true;
    S.sel.clear();
    S.editId = null; S.editName = '';
    S.hover = null; S.final = false;
    el.resultBar.hidden = true;
    el.menu.hidden = true;
    hideSnapBadge();
    clearTimeout(colSaveT);
    if (wheelEl) wheelEl.hidden = true;
    clearItems();
    if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
    S.blob = null;
  }
  async function openRestored(proj) {
    if (!proj || !proj.photos || !proj.photos.length) { toast('The collage project is incomplete', 'err'); return; }
    S.open = true; S.blob = null; S.restored = true;
    S.editId = proj.editId || null;
    S.editName = S.editId ? (proj.name || '') : '';
    S.type = ALL_TYPES.includes(proj.type) ? proj.type : 'pile';
    S.shadows = proj.shadows !== false;
    S.captions = !!proj.captions;
    S.bg = proj.bg || '#f5f2ec';
    /* old records used bgPhoto (blurred style); Use Image stays direct */
    S.bgImage = proj.bgImage != null ? !!proj.bgImage : !!proj.bgPhoto;
    S.border = proj.border || 'white';
    S.landscape = proj.landscape !== false;
    S.bgIdx = proj.bgIdx || 0;
    S.seed = proj.seed || 7;
    S.alphaAny = (proj.photos || []).some((ph) => /\.(png|webp|gif)$/i.test(ph.name || '')) ||
                 (proj.photos || []).some((ph) => ph.blob && ph.blob.type === 'image/png');
    S.custW = (proj.custW && isFinite(proj.custW)) ? proj.custW : 16;
    S.custH = (proj.custH && isFinite(proj.custH)) ? proj.custH : 9;
    S.final = false;
    el.root.hidden = false;
    el.fmt.value = NORM_FMT[proj.fmt] || proj.fmt || '4x3';
    if (el.fmt.selectedIndex < 0) el.fmt.value = '4x3';
    el.custRow.hidden = fmtVal() !== 'custom';
    el.custW.value = S.custW; el.custH.value = S.custH;
    if (proj.exportFmt) el.exportFmt.value = proj.exportFmt;
    el.resultBar.hidden = true;
    clearItems();
    updateUI();
    el.note.textContent = S.editId
      ? `Editing "${S.editName || 'collage'}" — press Create Collage to update it`
      : `Auto-saved collage reopened (${proj.photos.length} photos)`;
    S.noteBase = el.note.textContent;
    noteCount();
    el.busy.hidden = false;
    const canvases = [];
    S.list = [];
    for (const ph of proj.photos) {
      try {
        canvases.push(await decodeToCanvas(ph.blob));
        S.list.push({ name: ph.name || 'photo', size: ph.size || 0, lastModified: ph.lastModified || 0, handle: null, file: null });
      } catch (e) { /* skip */ }
    }
    el.busy.hidden = true;
    const [W, H] = dims();
    for (let i = 0; i < canvases.length; i++) {
      const st = { fit: 'fill', z: i + 1 };
      if (S.type === 'pile') {
        const man = proj.pos && proj.pos[i];
        const g = pileFrac(i, canvases.length);
        if (man) {
          st.x = man.x; st.y = man.y;
          st.rot = man.rot / DEG;
          st.scale = clamp(man.scale || 1, SCALE_MIN, SCALE_MAX);
        } else { st.x = g.x; st.y = g.y; st.rot = g.rot; st.scale = 1; }
        const geo = proj.geo && proj.geo[i];
        if (geo && geo.w > 0) { st.wFrac = geo.w; st.hFrac = geo.h; }
        else st.wFrac = g.wFrac, st.hFrac = g.wFrac * (canvases[i].height / canvases[i].width) * (W / H);
      } else {
        st.x = 0.5; st.y = 0.5; st.rot = 0; st.scale = 1;
        st.wFrac = 0.3; st.hFrac = 0.3;
      }
      await itemFrom(canvases[i], S.list[i] ? S.list[i].name : 'photo', st);
    }
    if (S.type !== 'pile') applyLayout(false);
    if (proj.zarr && proj.zarr.length === S.items.length) {
      S.items.forEach((it, i) => { it.z = proj.zarr[i]; });
      zTop = Math.max(...proj.zarr, 20);
      renderAll();
    }
    updateStageGeometry();
    syncClips();
    noteCount();
    refreshBackground();
    positionWheel();
    if (proj.previewBlob) {
      S.blob = proj.previewBlob;
      if (S.url) URL.revokeObjectURL(S.url);
      S.url = URL.createObjectURL(S.blob);
    }
    scheduleColSave();
    toast(S.editId ? 'Collage opened for editing' : 'Previous collage restored', 'ok', 3000);
  }
  async function create() {
    /* v3.22.2: kill any pending auto-save timer so it cannot re-write the
       working 'current' record after this export cleans it up */
    clearTimeout(colSaveT);
    el.busy.hidden = false;
    await new Promise((r) => setTimeout(r, 40));
    try {
      const [W, H] = exportDims();
      S.outW = W; S.outH = H;
      const c = renderExport(W, H);
      const want = el.exportFmt.value;
      const type = want === 'png' || (want === 'auto' && S.alphaAny) ? 'image/png' : 'image/jpeg';
      S.blob = await new Promise((r) => c.toBlob(r, type, 0.92));
      if (!S.blob) { toast('The collage could not be created — please try again', 'err'); return; }
      if (S.url) URL.revokeObjectURL(S.url);
      S.url = URL.createObjectURL(S.blob);
      S.final = true;
      el.resultBar.hidden = false;
      el.resultNote.textContent = `Collage ready — ${W} \u00D7 ${H}px (${S.blob.type === 'image/png' ? 'PNG' : 'JPEG'}) — saved to the Collages folder`;
      el.note.textContent = 'Collage created — download it, save it to a folder, or go back to edit.';
      el.cDesktop.disabled = el.cCreate.disabled = true;
      saveCollage();
      /* v3.22.2 (Picasa behaviour): Create Collage finishes the job in one
         click — the JPEG/PNG downloads immediately and the working auto-save
         ('collage'/'current') is cleaned up, so no "reopen it?" bar can ever
         appear. The finished collage lives in the library (Collages folder). */
      try { P.idbDel('collage', 'current'); } catch (e) {}
      const extD = S.blob.type === 'image/png' ? 'png' : 'jpg';
      const aD = document.createElement('a');
      aD.href = S.url;
      aD.download = `collage-${new Date().toISOString().slice(0, 10)}.${extD}`;
      aD.click();
      toast(`Collage downloaded (${extD.toUpperCase()})`, 'ok', 3000);
    } finally {
      el.busy.hidden = true;
    }
  }

  /* ================= wiring ================= */
  function wire() {
    injectStyles();
    /* the context menu must sit above the round wheel overlay */
    el.menu.style.zIndex = '100000';
    /* v3.22.2 RIGHT-CLICK FIX: the round wheel + knob sit OVER the centre of
       the hovered/selected photo, so a right-click on the middle of a photo
       landed on the wheel and showed the BROWSER menu instead of Picasa's
       context menu. Forward it: right-click anywhere on a photo — centre
       (wheel/knob) or edges (the photo itself) — always opens the menu. */
    const ctxFromWheel = (e) => {
      const tgt = itemById(wheelEl.dataset.id);
      if (!tgt || S.final) return;
      e.preventDefault();
      e.stopPropagation();
      select(tgt);
      openMenu(e.clientX, e.clientY, tgt);
    };
    wheelEl.addEventListener('contextmenu', ctxFromWheel);
    knobEl.addEventListener('contextmenu', ctxFromWheel);
    /* hidden file input for "Add Photos from PC" */
    const fileAdd = document.createElement('input');
    fileAdd.type = 'file';
    fileAdd.multiple = true;
    fileAdd.accept = 'image/*';
    fileAdd.hidden = true;
    el.paneClips.appendChild(fileAdd);

    el.type.addEventListener('change', () => {
      S.type = ALL_TYPES.includes(el.type.value) ? el.type.value : 'pile';
      S.sel.clear(); S.hover = null;
      updateUI();
      applyLayout(true);
    });
    el.fmt.addEventListener('change', () => {
      /* v3.22.2: remember the last page format */
      try { localStorage.setItem('pixsa.collageFormat', el.fmt.value); } catch (e) {}
      el.custRow.hidden = fmtVal() !== 'custom';
      updateStageGeometry();
      if (S.type !== 'pile') applyLayout(true); else scheduleColSave();
    });
    el.custApply.addEventListener('click', () => {
      const w = parseFloat(el.custW.value), h = parseFloat(el.custH.value);
      if (!(w > 0) || !(h > 0)) { toast('Ratio needs two numbers bigger than 0', 'err'); return; }
      S.custW = clamp(w, 0.2, 60); S.custH = clamp(h, 0.2, 60);
      updateStageGeometry();
      if (S.type !== 'pile') applyLayout(true); else scheduleColSave();
    });
    el.orientL.addEventListener('click', () => {
      if (!S.landscape) {
        S.landscape = true;
        /* v3.22.2: remember the last orientation */
        try { localStorage.setItem('pixsa.collageOrientation', 'landscape'); } catch (e) {}
        updateUI(); updateStageGeometry(); if (S.type !== 'pile') applyLayout(true); else scheduleColSave();
      }
    });
    el.orientP.addEventListener('click', () => {
      if (S.landscape) {
        S.landscape = false;
        /* v3.22.2: remember the last orientation */
        try { localStorage.setItem('pixsa.collageOrientation', 'portrait'); } catch (e) {}
        updateUI(); updateStageGeometry(); if (S.type !== 'pile') applyLayout(true); else scheduleColSave();
      }
    });
    el.borders.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-b]');
      if (!b) return;
      S.border = b.dataset.b;
      updateUI();
      renderAll();
      positionWheel();
      scheduleColSave();
    });
    el.bg.addEventListener('input', () => {
      S.bg = el.bg.value;
      S.bgImage = false; el.bgSolid.checked = true; el.bgPhoto.checked = false;
      refreshBackground();
      scheduleColSave();
    });
    el.bgSolid.addEventListener('change', () => {
      if (el.bgSolid.checked) { S.bgImage = false; el.bgPhoto.checked = false; refreshBackground(); scheduleColSave(); }
    });
    el.bgPhoto.addEventListener('change', () => {
      S.bgImage = el.bgPhoto.checked;
      el.bgSolid.checked = !S.bgImage;
      if (S.bgImage && !S.items.length) {
        toast('Add photos first — then one can become the background', 'err');
        S.bgImage = false; el.bgPhoto.checked = false; el.bgSolid.checked = true;
        return;
      }
      refreshBackground();
      scheduleColSave();
    });
    el.eyedrop.addEventListener('click', () => {
      if (!window.EyeDropper) { toast('The eyedropper needs Chrome or Edge', 'err', 4000); return; }
      new window.EyeDropper().open().then((r) => {
        S.bg = r.sRGBHex; el.bg.value = S.bg;
        S.bgImage = false; el.bgSolid.checked = true; el.bgPhoto.checked = false;
        refreshBackground();
      }).catch(() => { /* user pressed Escape */ });
    });
    q('.c-side .presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-bg]');
      if (!b) return;
      S.bg = b.dataset.bg;
      el.bg.value = S.bg;
      S.bgImage = false; el.bgSolid.checked = true; el.bgPhoto.checked = false;
      refreshBackground();
      scheduleColSave();
    });
    el.shadows.addEventListener('change', () => { S.shadows = el.shadows.checked; renderAll(); scheduleColSave(); });
    el.captions.addEventListener('change', () => { S.captions = el.captions.checked; renderAll(); scheduleColSave(); });
    el.exportFmt.addEventListener('change', () => scheduleColSave());

    /* stage toolbar: Select All | Select None | Remove | Set as Background */
    q('#cSelAll').addEventListener('click', selectAll);
    q('#cSelNone').addEventListener('click', selectNone);
    q('#cRemove').addEventListener('click', removeSelected);
    q('#cSetBg').addEventListener('click', setAsBackground);

    /* bottom bar */
    q('#cScramble').addEventListener('click', scramble);
    q('#cShufflePics').addEventListener('click', shufflePictures);
    q('#cViewEdit').addEventListener('click', viewAndEdit);

    /* header tabs: Library | Collage */
    el.tabLib.addEventListener('click', close);
    el.tabSettings.addEventListener('click', () => showPane(true));
    el.tabClips.addEventListener('click', () => showPane(false));
    function showPane(settings) {
      el.paneSettings.hidden = !settings;
      el.paneClips.hidden = settings;
      el.tabSettings.classList.toggle('on', settings);
      el.tabClips.classList.toggle('on', !settings);
      if (!settings) syncClips();
    }

    /* sidebar 2x2: Desktop Background | Create Collage | Reset | Close */
    el.cDesktop.addEventListener('click', async () => {
      if (!S.items.length) { toast('Add photos first', 'err'); return; }
      el.busy.hidden = false;
      try {
        const [W, H] = exportDims();
        const c = renderExport(W, H);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'shivam-pixa-desktop.jpg';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 8000);
        toast('Wallpaper image downloaded — right-click it and choose "Set as desktop background"', 'ok', 9000);
      } finally { el.busy.hidden = true; }
    });
    el.cReset.addEventListener('click', () => {
      if (S.final) return;
      S.sel.clear(); S.hover = null;
      applyLayout(true);
      toast('Back to the automatic Picasa layout', 'ok', 2500);
    });
    el.cClose2.addEventListener('click', close);

    /* Clips: photos from the tray + files straight from the PC */
    el.addPhotos.addEventListener('click', () => { fileAdd.click(); });
    fileAdd.addEventListener('change', async () => {
      const files = [...fileAdd.files];
      fileAdd.value = '';
      for (const f of files) await addFileToCollage(f);
    });

    el.cCreate.addEventListener('click', create);
    q('#cClose').addEventListener('click', close);
    el.cBack.addEventListener('click', () => {
      if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
      S.blob = null;
      S.final = false;
      el.resultBar.hidden = true;
      updateUI();
      positionWheel();
    });
    el.cDownload.addEventListener('click', () => {
      if (!S.blob) return;
      const ext = S.blob.type === 'image/png' ? 'png' : 'jpg';
      const a = document.createElement('a');
      a.href = S.url;
      a.download = `collage-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      toast(`Collage downloaded (${ext.toUpperCase()})`, 'ok', 3000);
    });
    el.cSaveDir.addEventListener('click', async () => {
      if (!S.blob) return;
      const dir = state.dirHandle;
      const ext = S.blob.type === 'image/png' ? 'png' : 'jpg';
      const nm = `collage-${Date.now().toString(36)}.${ext}`;
      if (dir && await P.saveBlobToDir(dir, nm, S.blob)) {
        toast(`Collage saved to folder: ${nm}`, 'ok', 4000);
        close();
        P.loadFolder(dir, true);
      } else {
        const a = document.createElement('a');
        a.href = S.url;
        a.download = nm;
        a.click();
        toast('No folder access — the collage was downloaded instead', 'ok', 4000);
        close();
      }
    });

    /* blank stage click deselects (the prototype's way) */
    stage.addEventListener('pointerdown', (e) => {
      if (e.target === stage) selectNone();
    });

    /* keyboard: Delete removes, arrows nudge, ]/[ z-order, Escape clears */
    document.addEventListener('keydown', (e) => {
      if (!S.open || el.root.hidden) return;
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (S.sel.size) { S.sel.clear(); paintSel(); } else close();
        return;
      }
      if (S.final) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      const it = firstSel();
      if (!it) return;
      if (e.key === ']') { changeZ(it, 'forward'); return; }
      if (e.key === '[') { changeZ(it, 'backward'); return; }
      if (S.type !== 'pile') return;
      const step = e.shiftKey ? 0.05 : 0.01;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        for (const id of S.sel) {
          const j = itemById(id);
          if (!j) continue;
          j.x = clamp(j.x + mv[0], -0.5, 1.5);
          j.y = clamp(j.y + mv[1], -0.5, 1.5);
          renderItem(j);
        }
        positionWheel();
        scheduleColSave();
      }
    });

    window.addEventListener('resize', () => { if (S.open && !el.root.hidden) updateStageGeometry(); });
    document.addEventListener('pointerdown', (e) => {
      if (!el.menu.hidden && !el.menu.contains(e.target)) el.menu.hidden = true;
    }, true);
  }

  wire();

  window.PixsaCollage = { open, close, openRestored, editCollage, isOpen: () => S.open, syncClips };
  /* the reference prototype's global name also answers */
  window.PicasaCollage = window.PixsaCollage;
})();
