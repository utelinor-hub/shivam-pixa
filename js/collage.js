/* SHIVAM PIXA — collage.js
   Picasa-style collage maker: Picture Pile | Mosaic | Frame Mosaic |
   Picture Grid | Contact Sheet | Multiple Exposure */
(() => {
  'use strict';
  const P = window.Pixsa;
  if (!P) return;
  const { state, toast, getFile, clamp } = P;

  const q = (s) => document.querySelector(s);
  const el = {
    root: q('#collage'), canvas: q('#cCanvas'), busy: q('#cBusy'), note: q('#cNote'),
    fmt: q('#cFormat'), bg: q('#cBg'), spacingRow: q('#cSpacingRow'), spacing: q('#cSpacing'),
    shuffle: q('#cShuffle'), border: q('#cBorder'), orient: q('#cOrient'), bgPhoto: q('#cBgPhoto'),
    cCreate: q('#cCreate'), cCancel: q('#cCancel'), cSaveDir: q('#cSaveDir'),
    cDownload: q('#cDownload'), cBack: q('#cBack')
  };

  const C = { open: false, list: [], imgs: [], type: 'pile', bg: '#f5f2ec', spacing: 10, seed: 7, blob: null, url: null,
              border: 'white', landscape: true, bgPhoto: false, alphaAny: false, restored: false,
              /* v3.11.0: per-photo manual adjustments (Picture Pile) —
                 pos[i] = {x, y (0..1 canvas-normalized), rot (radians), scale};
                 layout = geometry of the last render, used to hit-test drags;
                 order = draw order — a dragged photo is brought to the top */
              pos: null, layout: null, order: null, noteBase: '' };

  /* ---------- power-cut safe project auto-save ---------- */
  let colSaveT = null;
  function scheduleColSave() {
    if (!C.open) return;
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
  async function saveCollageProject() {
    if (!C.open || !C.imgs.length) return;
    try {
      const photos = [];
      for (let i = 0; i < C.imgs.length && i < 40; i++) {
        const b = await imgToBlob(C.imgs[i]);
        if (b) photos.push({ name: (C.list[i] && C.list[i].name) || ('photo-' + (i + 1)), blob: b });
      }
      if (!photos.length) return;
      const previewBlob = await new Promise((r) => el.canvas.toBlob(r, C.alphaAny ? 'image/png' : 'image/jpeg', 0.9));
      const proj = {
        type: C.type, bg: C.bg, spacing: C.spacing, border: C.border,
        landscape: C.landscape, bgPhoto: C.bgPhoto, seed: C.seed, fmt: el.fmt.value,
        pos: C.pos, photos, previewBlob, ts: Date.now()
      };
      await P.idbSet('collage', 'current', proj);
      C.savedProj = true;
    } catch (e) { /* storage full — Create/Download still work */ }
  }
  async function openRestored(proj) {
    if (!proj || !proj.photos || !proj.photos.length) { toast('The collage project is incomplete', 'err'); return; }
    C.open = true; C.blob = null; C.restored = true;
    C.list = proj.photos.map((ph) => ({ name: ph.name || 'photo', size: 0, lastModified: 0, handle: null, file: null }));
    C.type = proj.type || 'pile';
    C.bg = proj.bg || '#f5f2ec';
    C.spacing = proj.spacing == null ? 10 : proj.spacing;
    C.border = proj.border || 'white';
    C.landscape = proj.landscape !== false;
    C.bgPhoto = !!proj.bgPhoto;
    C.seed = proj.seed || 7;
    C.pos = Array.isArray(proj.pos) ? proj.pos : null;
    C.layout = null; C.order = null;
    C.alphaAny = proj.photos.some((ph) => /\.(png|webp|gif)$/i.test(ph.name || '')) ||
                 proj.photos.some((ph) => ph.blob && ph.blob.type === 'image/png');
    el.root.hidden = false;
    el.fmt.value = proj.fmt || '4x3';
    el.bg.value = C.bg; el.spacing.value = C.spacing; el.border.value = C.border;
    el.bgPhoto.checked = C.bgPhoto;
    el.cCreate.hidden = false; el.cCancel.hidden = false;
    el.cSaveDir.hidden = true; el.cDownload.hidden = !proj.previewBlob; el.cBack.hidden = true;
    el.note.textContent = `Auto-saved collage reopened (${proj.photos.length} photos)`;
    C.noteBase = el.note.textContent;
    updateUI();
    el.busy.hidden = false;
    const out = [];
    for (const ph of proj.photos) {
      try { out.push(await createImageBitmap(ph.blob)); } catch (e) { /* skip */ }
    }
    C.imgs = out;
    el.busy.hidden = true;
    renderPreview();
    if (proj.previewBlob) {
      C.blob = proj.previewBlob;
      if (C.url) URL.revokeObjectURL(C.url);
      C.url = URL.createObjectURL(C.blob);
    }
    toast('Previous collage restored', 'ok', 3000);
  }

  function dims() {
    let W, H;
    switch (el.fmt.value) {
      case '16x9': W = 1920; H = 1080; break;
      case 'sq': W = 1400; H = 1400; break;
      case 'a4': W = 1191; H = 1684; break;
      case 'letter': W = 1700; H = 2200; break;
      case '4x6': W = 1200; H = 1800; break;
      case '5x7': W = 1500; H = 2100; break;
      case '8x10': W = 1600; H = 2000; break;
      case '11x14': W = 1760; H = 2240; break;
      case '16x20': W = 2000; H = 2500; break;
      default: W = 1600; H = 1200;
    }
    /* base orientation: print sizes portrait, 4x3/16x9 landscape — toggle swaps */
    return (C.landscape !== (W >= H)) ? [H, W] : [W, H];
  }

  function rng() {
    let s = C.seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function drawCover(x, img, dx, dy, dw, dh) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sc = Math.max(dw / iw, dh / ih);
    const w = iw * sc, h = ih * sc;
    x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
  }
  function drawContain(x, img, dx, dy, dw, dh) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sc = Math.min(dw / iw, dh / ih);
    const w = iw * sc, h = ih * sc;
    x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
  }

  /* border styles: none | white | polaroid — grid/mosaic/frame cells ke liye */
  function drawBordered(x, img, dx, dy, dw, dh) {
    if (C.border === 'none') { drawCover(x, img, dx, dy, dw, dh); return; }
    const u = Math.min(dw, dh);
    const pad = C.border === 'polaroid' ? u * 0.055 : u * 0.035;
    const bot = C.border === 'polaroid' ? u * 0.17 : pad;
    x.fillStyle = '#ffffff';
    x.fillRect(dx, dy, dw, dh);
    drawCover(x, img, dx + pad, dy + pad, Math.max(4, dw - pad * 2), Math.max(4, dh - pad - bot));
  }

  function renderCollage(W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = C.bg;
    x.fillRect(0, 0, W, H);
    const n = C.imgs.length;
    if (!n) return c;
    const rand = rng();

    if (C.bgPhoto && C.imgs[0]) {
      drawCover(x, C.imgs[0], 0, 0, W, H);
      x.globalAlpha = 0.84;
      x.fillStyle = C.bg;
      x.fillRect(0, 0, W, H);
      x.globalAlpha = 1;
    }

    if (C.type === 'mex') {
      x.globalAlpha = 1 / n;
      for (const img of C.imgs) drawCover(x, img, 0, 0, W, H);
      x.globalAlpha = 1;
    } else if (C.type === 'pile') {
      /* v3.11.0: every photo's random values come from its OWN index, so a
         drag or a bring-to-front never moves the other photos. Draw order is
         C.order — the photo being dragged is drawn last (on top), Picasa style */
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const rows = Math.max(1, Math.ceil(n / cols));
      const cw = W / cols, ch = H / rows;
      const bor = Math.min(W, H) * 0.012;
      const base = [];
      for (let i = 0; i < n; i++) {
        const img = C.imgs[i];
        const jw0 = cw * (0.98 + rand() * 0.3);
        const px0 = (i % cols) * cw + cw / 2 + (rand() - 0.5) * cw * 0.3;
        const py0 = Math.floor(i / cols) * ch + ch / 2 + (rand() - 0.5) * ch * 0.3;
        const rot0 = (rand() - 0.5) * 0.3;
        const man = C.pos && C.pos[i];
        const jw = jw0 * (man && man.scale ? man.scale : 1);
        base[i] = { img, jw, jh: jw * (img.height / img.width), px: man ? man.x * W : px0, py: man ? man.y * H : py0, rot: man ? man.rot : rot0 };
      }
      if (!C.order || C.order.length !== n) C.order = C.imgs.map((_, i) => i);
      const layout = [];
      for (const i of C.order) {
        const b = base[i];
        x.save();
        x.translate(b.px, b.py);
        x.rotate(b.rot);
        x.shadowColor = 'rgba(0,0,0,.38)';
        x.shadowBlur = Math.min(W, H) * 0.02;
        x.shadowOffsetY = Math.min(W, H) * 0.008;
        x.fillStyle = '#ffffff';
        x.fillRect(-b.jw / 2 - bor, -b.jh / 2 - bor, b.jw + bor * 2, b.jh + bor * 2);
        x.shadowColor = 'transparent';
        x.drawImage(b.img, -b.jw / 2, -b.jh / 2, b.jw, b.jh);
        x.restore();
        layout[i] = { px: b.px, py: b.py, jw: b.jw, jh: b.jh, rot: b.rot };
      }
      C.layout = layout;
    } else if (C.type === 'mosaic') {
      /* brick-pattern mosaic: each row fills according to the photo aspect ratios */
      const sp = Math.max(C.spacing, 4);
      const rows = clamp(Math.round(Math.sqrt(n * (H / W) * 0.95)), 1, 10);
      const rh = (H - sp * (rows - 1)) / rows;
      let i = 0;
      for (let r = 0; r < rows && i < n; r++) {
        const rowImg = [];
        let aspects = 0;
        while (i < n) {
          const a = C.imgs[i].width / C.imgs[i].height;
          if (rowImg.length && aspects + a > (W / rh) * 1.18) break;
          rowImg.push(i); aspects += a; i++;
        }
        if (!rowImg.length) { rowImg.push(i); aspects = C.imgs[i].width / C.imgs[i].height; i++; }
        const scale = (W - sp * (rowImg.length - 1)) / (aspects * rh);
        let px2 = 0;
        for (const idx of rowImg) {
          const img = C.imgs[idx];
          const wpx = (img.width / img.height) * rh * scale;
          drawBordered(x, img, px2, r * (rh + sp), wpx, rh);
          px2 += wpx + sp;
        }
      }
    } else if (C.type === 'frame') {
      /* frame mosaic: featured photo in the center, border grid all around */
      const side = clamp(Math.ceil(Math.sqrt(n + 4)), 3, 7);
      const sp = Math.max(C.spacing, 8);
      const cw = (W - sp * (side - 1)) / side;
      const ch = (H - sp * (side - 1)) / side;
      const cx0 = Math.floor((side - 2) / 2), cy0 = Math.floor((side - 2) / 2);
      let i = 1;
      for (let r = 0; r < side; r++) {
        for (let c2 = 0; c2 < side; c2++) {
          const px2 = c2 * (cw + sp), py2 = r * (ch + sp);
          const inCenter = c2 >= cx0 && c2 < cx0 + 2 && r >= cy0 && r < cy0 + 2;
          if (inCenter) {
            if (c2 === cx0 && r === cy0) {
              drawBordered(x, C.imgs[0], px2, py2, cw * 2 + sp, ch * 2 + sp);
            }
          } else if (i < n) {
            drawBordered(x, C.imgs[i], px2, py2, cw, ch);
            i++;
          }
        }
      }
    } else {
      const sp = C.type === 'sheet' ? Math.max(C.spacing, 16) : C.spacing;
      const marg = C.type === 'sheet' ? Math.max(34, sp + 20) : sp + 6;
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * (W / H))));
      const rows = Math.max(1, Math.ceil(n / cols));
      const cw = (W - marg * 2 - sp * (cols - 1)) / cols;
      const ch = (H - marg * 2 - sp * (rows - 1)) / rows;
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols && i < n; col++, i++) {
          const img = C.imgs[i];
          const px = marg + col * (cw + sp);
          const py = marg + r * (ch + sp);
          if (C.type === 'sheet') {
            x.fillStyle = '#ffffff';
            x.fillRect(px, py, cw, ch);
            drawContain(x, img, px + cw * 0.045, py + cw * 0.045, cw * 0.91, ch - cw * 0.09);
          } else {
            drawBordered(x, img, px, py, cw, ch);
          }
        }
      }
    }
    return c;
  }

  function renderPreview() {
    const [W, H] = dims();
    const c = renderCollage(W, H);
    el.canvas.width = c.width;
    el.canvas.height = c.height;
    el.canvas.getContext('2d').drawImage(c, 0, 0);
  }

  async function loadImgs() {
    el.busy.hidden = false;
    const out = [];
    C.alphaAny = C.list.some((p) => /\.(png|webp|gif)$/i.test(p.name || ''));
    for (const p of C.list) {
      try {
        const file = await getFile(p);
        let bmp;
        try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (e) { bmp = await createImageBitmap(file); }
        if (Math.max(bmp.width, bmp.height) > 1400) {
          const sc = 1400 / Math.max(bmp.width, bmp.height);
          const t = document.createElement('canvas');
          t.width = Math.round(bmp.width * sc);
          t.height = Math.round(bmp.height * sc);
          t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
          if (bmp.close) bmp.close();
          out.push(t);
        } else {
          out.push(bmp);
        }
      } catch (e) { /* skip unreadable */ }
    }
    C.imgs = out;
    el.busy.hidden = true;
  }

  function updateUI() {
    for (const b of q('.c-types').querySelectorAll('button[data-ct]')) {
      b.classList.toggle('on', b.dataset.ct === C.type);
    }
    el.spacingRow.hidden = !['grid', 'sheet', 'mosaic', 'frame'].includes(C.type);
    el.shuffle.hidden = C.type !== 'pile';
    el.orient.textContent = 'Orientation: ' + (C.landscape ? 'Landscape' : 'Portrait');
    /* v3.11.0: tell the user the photos are individually adjustable */
    el.note.textContent = (C.noteBase || '') + (C.type === 'pile' && !el.cCreate.hidden
      ? ' • Drag a photo to move it — scroll wheel resizes, Shift+drag rotates'
      : '');
  }

  async function open(list) {
    if (!list || !list.length) return;
    C.list = list.slice(0, 40);
    C.open = true;
    C.blob = null;
    C.pos = null; C.layout = null; C.order = null;
    if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
    el.root.hidden = false;
    el.cCreate.hidden = false; el.cCancel.hidden = false;
    el.cSaveDir.hidden = true; el.cDownload.hidden = true; el.cBack.hidden = true;
    C.noteBase = `${C.list.length} ${C.list.length === 1 ? 'photo used' : 'photos used'}${list.length > 40 ? ' (first 40)' : ''}`;
    updateUI();
    await loadImgs();
    renderPreview();
    scheduleColSave();
  }
  function close() {
    C.open = false;
    el.root.hidden = true;
    if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
    C.blob = null;
  }

  async function create() {
    el.busy.hidden = false;
    await new Promise((r) => setTimeout(r, 40));
    const [W, H] = dims();
    const c = renderCollage(W, H);
    /* if a transparent PNG is used, save as PNG — alpha is never lost */
    C.blob = await new Promise((r) => c.toBlob(r, C.alphaAny ? 'image/png' : 'image/jpeg', 0.9));
    el.busy.hidden = true;
    if (!C.blob) { toast('The collage could not be created — please try again', 'err'); return; }
    if (C.url) URL.revokeObjectURL(C.url);
    C.url = URL.createObjectURL(C.blob);
    el.canvas.width = c.width; el.canvas.height = c.height;
    el.canvas.getContext('2d').drawImage(c, 0, 0);
    el.cCreate.hidden = true; el.cCancel.hidden = true;
    el.cSaveDir.hidden = false; el.cDownload.hidden = false; el.cBack.hidden = false;
    el.note.textContent = `Collage ready (${W} \u00D7 ${H}px)`;
    saveCollageProject();
  }

  function wire() {
    q('.c-types').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ct]');
      if (!b) return;
      C.type = b.dataset.ct;
      updateUI();
      renderPreview();
      scheduleColSave();
    });
    el.fmt.addEventListener('change', () => { renderPreview(); scheduleColSave(); });
    el.bg.addEventListener('input', () => { C.bg = el.bg.value; renderPreview(); scheduleColSave(); });
    q('.presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-bg]');
      if (!b) return;
      C.bg = b.dataset.bg;
      el.bg.value = C.bg;
      renderPreview();
      scheduleColSave();
    });
    el.spacing.addEventListener('input', () => { C.spacing = +el.spacing.value; renderPreview(); scheduleColSave(); });
    el.shuffle.addEventListener('click', () => { C.seed = (Math.random() * 2147483646) | 0; C.pos = null; renderPreview(); scheduleColSave(); });
    el.border.addEventListener('change', () => { C.border = el.border.value; renderPreview(); scheduleColSave(); });
    el.orient.addEventListener('click', () => { C.landscape = !C.landscape; updateUI(); renderPreview(); scheduleColSave(); });
    el.bgPhoto.addEventListener('change', () => { C.bgPhoto = el.bgPhoto.checked; renderPreview(); scheduleColSave(); });
    el.cCreate.addEventListener('click', create);
    el.cCancel.addEventListener('click', close);
    q('#cClose').addEventListener('click', close);
    q('#cBackTop').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.root.hidden) close();
    });
    el.cBack.addEventListener('click', () => {
      if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
      C.blob = null;
      el.cCreate.hidden = false; el.cCancel.hidden = false;
      el.cSaveDir.hidden = true; el.cDownload.hidden = true; el.cBack.hidden = true;
      updateUI();
      renderPreview();
    });
    el.cDownload.addEventListener('click', () => {
      if (!C.blob) return;
      const a = document.createElement('a');
      a.href = C.url;
      a.download = `collage-${new Date().toISOString().slice(0, 10)}.jpg`;
      a.click();
      toast('Collage downloaded', 'ok', 3000);
    });
    el.cSaveDir.addEventListener('click', async () => {
      if (!C.blob) return;
      const dir = state.dirHandle;
      const nm = `collage-${Date.now().toString(36)}.${C.alphaAny ? 'png' : 'jpg'}`;
      if (dir && await P.saveBlobToDir(dir, nm, C.blob)) {
        toast(`Collage saved to folder: ${nm}`, 'ok', 4000);
        close();
        P.loadFolder(dir, true);
      } else {
        const a = document.createElement('a');
        a.href = C.url;
        a.download = nm;
        a.click();
        toast('No folder access — the collage was downloaded instead', 'ok', 4000);
        close();
      }
    });
  }

  /* ---------- v3.11.0: adjust individual photos in Picture Pile ----------
     drag = move • mouse wheel = resize • Shift+drag = rotate. The preview
     canvas is redrawn via requestAnimationFrame so dragging stays smooth. */
  function wireDrag() {
    let drag = null, rafPend = false;
    const canvasPt = (e) => {
      const r = el.canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (el.canvas.width / r.width),
               y: (e.clientY - r.top) * (el.canvas.height / r.height) };
    };
    const hitPhoto = (pt) => {
      if (!C.layout || !C.order || !C.open || C.type !== 'pile') return -1;
      for (let k = C.order.length - 1; k >= 0; k--) {
        const L = C.layout[C.order[k]]; if (!L) continue;
        const dx = pt.x - L.px, dy = pt.y - L.py;
        const cos = Math.cos(-L.rot), sin = Math.sin(-L.rot);
        const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
        if (Math.abs(lx) <= L.jw / 2 && Math.abs(ly) <= L.jh / 2) return C.order[k];
      }
      return -1;
    };
    const bringToFront = (i) => {
      if (!C.order) return;
      const k = C.order.indexOf(i);
      if (k >= 0) { C.order.splice(k, 1); C.order.push(i); }
    };
    const redraw = () => {
      if (rafPend) return;
      rafPend = true;
      requestAnimationFrame(() => { rafPend = false; renderPreview(); scheduleColSave(); });
    };
    el.canvas.addEventListener('pointerdown', (e) => {
      if (!C.open || C.type !== 'pile') return;
      if (el.cCreate.hidden) return; /* after "Create Collage" the result is final */
      const pt = canvasPt(e);
      const i = hitPhoto(pt);
      if (i < 0) return;
      e.preventDefault();
      bringToFront(i); /* Picasa behaviour: the photo you grab jumps on top */
      try { el.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      const L = C.layout[i];
      const start = (C.pos && C.pos[i])
        ? { x: C.pos[i].x, y: C.pos[i].y, rot: C.pos[i].rot, scale: C.pos[i].scale || 1 }
        : { x: L.px / el.canvas.width, y: L.py / el.canvas.height, rot: L.rot, scale: 1 };
      drag = { i, pt, start, mode: e.shiftKey ? 'rot' : 'move' };
      if (!C.pos) C.pos = [];
      el.canvas.style.cursor = 'grabbing';
    });
    el.canvas.addEventListener('pointermove', (e) => {
      if (!C.open || C.type !== 'pile') return;
      const pt = canvasPt(e);
      if (!drag) {
        el.canvas.style.cursor = (el.cCreate.hidden) ? 'default' : (hitPhoto(pt) >= 0 ? 'grab' : 'default');
        return;
      }
      const m = drag.start;
      if (drag.mode === 'rot') m.rot = m.rot + ((pt.x - drag.pt.x) / el.canvas.width) * 2;
      else {
        m.x = clamp(m.x + (pt.x - drag.pt.x) / el.canvas.width, -0.5, 1.5);
        m.y = clamp(m.y + (pt.y - drag.pt.y) / el.canvas.height, -0.5, 1.5);
      }
      C.pos[drag.i] = m;
      drag.pt = pt;
      redraw();
    });
    const endDrag = () => { if (drag) { drag = null; el.canvas.style.cursor = 'default'; scheduleColSave(); } };
    el.canvas.addEventListener('pointerup', endDrag);
    el.canvas.addEventListener('pointercancel', endDrag);
    el.canvas.addEventListener('wheel', (e) => {
      if (!C.open || C.type !== 'pile' || el.cCreate.hidden) return;
      const pt = canvasPt(e);
      const i = hitPhoto(pt);
      if (i < 0) return;
      e.preventDefault();
      if (!C.pos) C.pos = [];
      const L = C.layout[i];
      const cur = (C.pos[i])
        ? { x: C.pos[i].x, y: C.pos[i].y, rot: C.pos[i].rot, scale: C.pos[i].scale || 1 }
        : { x: L.px / el.canvas.width, y: L.py / el.canvas.height, rot: L.rot, scale: 1 };
      cur.scale = clamp(cur.scale * (e.deltaY < 0 ? 1.07 : 0.93), 0.25, 3);
      C.pos[i] = cur;
      redraw();
    }, { passive: false });
  }
  wire();
  wireDrag();

  window.PixsaCollage = { open, close, openRestored, isOpen: () => C.open };
})();
