/* SHIVAM PIXA — collage.js  (v3.17.0 "Picasa 3 replica" engine)
   Free-form Picasa-style picture pile + interactive HTML5-canvas renderer.

   v3.17.0 — full Picasa 3 replica pass:
   • the blue dashed box + lollipop handle are GONE — selection is now
     Picasa's iconic round wheel: a semi-transparent grey donut ring in the
     photo's center with one small knob on its perimeter. Drag the photo /
     inside the ring to move it, drag the knob to rotate AND resize at the
     same time (angle = rotation, distance = scale), wheel = resize,
     Shift+wheel = rotate. The wheel also appears faintly under the cursor
     on hover, exactly like Picasa.
   • right-click any photo for the Picasa context menu: Set as Background,
     Bring to Top / Forward / Backward / Bottom, Rotate Right/Left,
     View and Edit, Remove (back to the Clips tray). The sidebar
     "Selected Photo" buttons are gone.
   • the sidebar gained Picasa's two tabs — Settings | Clips (N). Clips
     shows the Photo Tray; click a clip (or Add More Photos…) to drop
     another photo onto the pile any time, natural aspect ratio kept.
   • Collage Type is back: Picture Pile / Mosaic / Frame Mosaic / Grid /
     Contact Sheet, with the Picasa 3 Page Format list (4:3, 16:9 HDTV,
     3:2 35mm, Letter, 4x6, Square, Current Screen Resolution), Landscape/
     Portrait icon toggle, Draw Shadows + Show Captions checkboxes and the
     2x2 footer: Desktop Background | Create Collage | Reset | Close.

   v3.16.0 — collages live in the library: Create Collage saves the result
   into a pinned "Collages" folder group (IndexedDB 'collages' store) and
   double-clicking it reopens the editor with photos + positions.

   Interactivity: click = select, drag = move (multi-select),
   wheel = resize, Shift+wheel = rotate, wheel knob = rotate+resize,
   pinch = scale+rotate on touch, ]/[ = front/back, Delete = remove.

   Rendering: one paint function renders BOTH the live preview and the
   final export — exportDims() renders at 4K (screen) or true 300-DPI
   print sizes, threaded through a scale factor. */

(() => {
  'use strict';
  const P = window.Pixsa;
  if (!P) return;
  const { state, toast, getFile, clamp, photoKey } = P;

  const q = (s) => document.querySelector(s);
  const el = {
    root: q('#collage'), canvas: q('#cCanvas'), overlay: q('#cOverlay'),
    busy: q('#cBusy'), note: q('#cNote'), count: q('#cCount'), toolInfo: q('#cToolInfo'),
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
    clips: q('#cClips'), clipCount: q('#cClipCount'), addPhotos: q('#cAddPhotos'), fileAdd: null,
    exportFmt: q('#cExportFmt'), resultBar: q('#cResultBar'), resultNote: q('#cResultNote'),
    menu: q('#cMenu'),
    cCreate: q('#cCreate'), cSaveDir: q('#cSaveDir'),
    cDownload: q('#cDownload'), cBack: q('#cBack')
  };

  const SLOTTED = ['grid', 'sheet', 'mosaic', 'frame'];
  const ALL_TYPES = ['pile'].concat(SLOTTED);
  const DEG = Math.PI / 180;

  const C = {
    open: false, list: [], imgs: [], type: 'pile', bg: '#f5f2ec', seed: 7,
    border: 'white', landscape: true, bgPhoto: false, bgIdx: 0,
    shadows: true, captions: false, spacing: 8,
    custW: 16, custH: 9,
    alphaAny: false, restored: false, final: false, hoverI: -1,
    /* per-photo manual transforms (Picture Pile):
       pos[i] = { x, y (0..1 canvas-normalized center), rot (radians), scale }
       layout = geometry of the last render (hit-testing), order = draw order */
    pos: null, layout: null, order: null, sel: new Set(),
    blob: null, url: null, noteBase: '',
    editId: null, editName: '', outW: 0, outH: 0   /* v3.16.0 re-edit link */
  };
  let swapTarget = -1;   /* slotted drag: cell currently hovered as swap partner */

  /* ================= small helpers ================= */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function rng() {
    let s = C.seed % 2147483647;
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
  /* border styles for slotted cells: none | white | polaroid — every photo is
     CLIPPED to its cell so a cover-crop can never spill over the neighbours */
  function drawCellImg(x, img, dx, dy, dw, dh) {
    x.save();
    x.beginPath(); x.rect(dx, dy, dw, dh); x.clip();
    drawCover(x, img, dx, dy, dw, dh);
    x.restore();
  }
  function drawBordered(x, img, dx, dy, dw, dh) {
    if (C.border === 'none') { drawCellImg(x, img, dx, dy, dw, dh); return; }
    const u = Math.min(dw, dh);
    const pad = C.border === 'polaroid' ? u * 0.055 : u * 0.035;
    const bot = C.border === 'polaroid' ? u * 0.17 : pad;
    x.fillStyle = '#ffffff';
    x.fillRect(dx, dy, dw, dh);
    drawCellImg(x, img, dx + pad, dy + pad, Math.max(4, dw - pad * 2), Math.max(4, dh - pad - bot));
  }
  /* blurred dominant-photo background: tiny downscale + smooth upscale
     (= strong gaussian-ish blur everywhere) + one ctx.filter pass where
     supported + a soft darkening so the photos read on top */
  function drawBlurredBg(x, img, W, H) {
    const tw = Math.max(16, Math.round(W / 28)), th = Math.max(16, Math.round(H / 28));
    const t = document.createElement('canvas'); t.width = tw; t.height = th;
    drawCover(t.getContext('2d'), img, 0, 0, tw, th);
    x.save();
    x.imageSmoothingQuality = 'high';
    try { x.filter = `blur(${Math.max(6, Math.round(Math.min(W, H) * 0.012))}px)`; } catch (e) { /* old browsers: downscale blur is enough */ }
    x.drawImage(t, 0, 0, W, H);
    x.restore();
    x.fillStyle = 'rgba(0,0,0,.22)';
    x.fillRect(0, 0, W, H);
  }

  /* ================= page geometry ================= */
  /* v3.17.0: old releases offered print sizes the Picasa list no longer has —
     saved projects normalize to the nearest format still on the list */
  const NORM_FMT = { a4: 'letter', '5x7': '4x6', '8x10': 'letter', '11x14': 'letter', '16x20': 'letter' };
  const fmtVal = () => {
    let v = el.fmt.value;
    if (NORM_FMT[v]) v = NORM_FMT[v];
    if (!el.fmt.querySelector(`option[value="${v}"]`)) v = '4x3';
    return v;
  };
  const custR = () => {
    const w = Math.max(1, C.custW || 16), h = Math.max(1, C.custH || 9);
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
    return (C.landscape !== (W >= H)) ? [H, W] : [W, H];
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
    if (C.landscape !== (W >= H)) { const t = W; W = H; H = t; }
    const mx = Math.max(W, H);
    if (mx > 6000) { const k = 6000 / mx; W = Math.round(W * k); H = Math.round(H * k); }
    return [W, H];
  }

  /* ================= LAYOUT: Picture Pile ================= */
  /* geometry for ONE photo — the random scatter values come from the photo's
     own index (a deterministic rng is advanced 4 steps per earlier photo),
     so drawing a single photo independently matches the full render */
  function pileGeom(i, W, H) {
    const n = C.imgs.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cw = W / cols, ch = H / rows;
    const rand = rng();
    for (let k = 0; k < i * 4; k++) rand();   /* advance to this photo's values */
    return {
      jw0: cw * (0.55 + rand() * 0.35),      /* leaves air between photos */
      px0: (i % cols) * cw + cw / 2 + (rand() - 0.5) * cw * 0.3,
      py0: Math.floor(i / cols) * ch + ch / 2 + (rand() - 0.5) * ch * 0.3,
      rot0: (rand() - 0.5) * 30 * DEG        /* -15deg .. +15deg */
    };
  }
  /* draw ONE pile photo (used by the full render AND the smooth-drag overlay).
     Returns the geometry so the caller can update the hit-test layout.
     v3.17.0: Draw Shadows checkbox + Show Captions (name under the photo,
     inside the Polaroid border when that border is active). */
  function drawPilePhoto(x, i, W, H) {
    const img = C.imgs[i];
    if (!img) return null;
    const g = pileGeom(i, W, H);
    const man = C.pos && C.pos[i];
    const scl = (man && man.scale) || 1;
    const b = {
      img, jw: g.jw0 * scl, jh: g.jw0 * (img.height / img.width) * scl,
      px: man ? man.x * W : g.px0, py: man ? man.y * H : g.py0,
      rot: man ? man.rot : g.rot0
    };
    const u = Math.min(b.jw, b.jh);
    const pad = C.border === 'polaroid' ? u * 0.05 : (C.border === 'white' ? u * 0.032 : 0);
    const bot = C.border === 'polaroid' ? u * 0.16 : pad;
    const capH = C.captions ? u * 0.085 : 0;
    x.save();
    x.translate(b.px, b.py);
    x.rotate(b.rot);
    if (C.shadows) {
      x.shadowColor = 'rgba(0,0,0,.38)';
      x.shadowBlur = Math.min(W, H) * 0.022;
      x.shadowOffsetY = Math.min(W, H) * 0.008;
    }
    if (C.border === 'none') {
      x.drawImage(b.img, -b.jw / 2, -b.jh / 2, b.jw, b.jh);
      if (C.captions) {
        x.shadowColor = 'transparent';
        x.fillStyle = '#ffffff';
        x.fillRect(-b.jw / 2, b.jh / 2 + u * 0.015, b.jw, capH);
        drawCaption(x, i, -b.jw / 2, b.jh / 2 + u * 0.015, b.jw, capH);
      }
    } else {
      x.fillStyle = '#ffffff';
      x.fillRect(-b.jw / 2 - pad, -b.jh / 2 - pad, b.jw + pad * 2, b.jh + pad + bot);
      x.shadowColor = 'transparent';
      x.drawImage(b.img, -b.jw / 2, -b.jh / 2, b.jw, b.jh);
      if (C.captions) {
        if (C.border === 'polaroid') {
          drawCaption(x, i, -b.jw / 2, b.jh / 2, b.jw, bot, '#4a4a4a');
        } else {
          x.fillStyle = '#ffffff';
          x.fillRect(-b.jw / 2 - pad, b.jh / 2 + pad + u * 0.012, b.jw + pad * 2, capH);
          drawCaption(x, i, -b.jw / 2 - pad, b.jh / 2 + pad + u * 0.012, b.jw + pad * 2, capH);
        }
      }
    }
    x.restore();
    return b;
  }
  function drawCaption(x, i, rx, ry, rw, rh, color) {
    const item = C.list && C.list[i];
    let name = (item && item.name) || '';
    if (!name) return;
    x.save();
    x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
    x.fillStyle = color || '#5a5a5a';
    x.font = `${Math.max(6, rh * 0.66).toFixed(1)}px 'Segoe UI', system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    let t = name;
    while (t.length > 3 && x.measureText(t).width > rw * 0.94) t = t.slice(0, -2);
    if (t !== name && t.length > 3) t = t.slice(0, -1) + '…';
    x.fillText(t, rx + rw / 2, ry + rh * 0.56, rw * 0.94);
    x.restore();
  }
  function paintPile(x, W, H, skip) {
    if (!C.order || C.order.length !== C.imgs.length) C.order = C.imgs.map((_, i) => i);
    const layout = [];
    for (const i of C.order) {
      if (skip && skip.has(i)) continue;   /* dragged photos are drawn on the overlay */
      const b = drawPilePhoto(x, i, W, H);
      if (b) layout[i] = { px: b.px, py: b.py, jw: b.jw, jh: b.jh, rot: b.rot, pile: true };
    }
    C.layout = layout;
  }

  /* ================= LAYOUT: Mosaic (featured + tessellation) =================
     1-2 photos are featured large; every remaining photo tessellates into
     rows whose cell widths follow the photo aspect ratios — the rows and
     columns always close up exactly (no gaps), each cell is smart
     center-cropped. Landscape canvases feature on the left, portrait on top. */
  function packRows(x, ox, oy, Rw, Rh, imgs, sp, layoutOut, off) {
    const m = imgs.length;
    if (!m || Rw <= 4 || Rh <= 4) return;
    sp = Math.min(sp, Rw / 4, Rh / 4);          /* spacing can never eat the region */
    const asp = imgs.map((im) => (im.width || 1) / (im.height || 1));
    const totalA = asp.reduce((a, b) => a + b, 0);
    /* R rows close up exactly when R^2 = totalA * Rh / Rw  (each row fills the
       width at its own height; row heights then sum to the region height) */
    const R = clamp(Math.round(Math.sqrt(totalA * Rh / Rw)), 1, m);
    /* partition into R rows balancing the aspect-sum of each row */
    const rows = [];
    let i = 0;
    for (let r = 0; r < R; r++) {
      const left = m - i, rowsLeft = R - r;
      const take = r === R - 1 ? left : Math.max(1, Math.min(left - (rowsLeft - 1), Math.round(left / rowsLeft)));
      const row = [];
      for (let k = 0; k < take && i < m; k++, i++) row.push(i);
      row.A = row.reduce((a, j) => a + asp[j], 0);
      row.h = (Rw - sp * (row.length - 1)) / row.A;  /* exact width fill */
      rows.push(row);
    }
    /* normalize total height to the region */
    const hSum = rows.reduce((a, row) => a + row.h, 0);
    const sy = (Rh - sp * (rows.length - 1)) / hSum;
    let y = oy;
    for (const row of rows) {
      const h = row.h * sy;
      const wSum = Rw - sp * (row.length - 1);
      let cx = ox;
      for (const j of row) {
        const w = wSum * (asp[j] / row.A);
        drawBordered(x, imgs[j], cx, y, w, h);
        layoutOut[off + j] = { x: cx, y, w, h };
        cx += w + sp;
      }
      y += h + sp;
    }
  }
  function paintMosaic(x, W, H, sc) {
    const n = C.imgs.length;
    const sp = Math.max(C.spacing, 2) * sc;
    C.layout = [];
    const land = W >= H;
    if (n === 1) {
      drawBordered(x, C.imgs[0], 0, 0, W, H);
      C.layout[0] = { x: 0, y: 0, w: W, h: H };
      return;
    }
    if (n === 2) {
      if (land) {
        const w2 = (W - sp) / 2;
        drawBordered(x, C.imgs[0], 0, 0, w2, H);
        drawBordered(x, C.imgs[1], w2 + sp, 0, w2, H);
        C.layout[0] = { x: 0, y: 0, w: w2, h: H };
        C.layout[1] = { x: w2 + sp, y: 0, w: w2, h: H };
      } else {
        const h2 = (H - sp) / 2;
        drawBordered(x, C.imgs[0], 0, 0, W, h2);
        drawBordered(x, C.imgs[1], 0, h2 + sp, W, h2);
        C.layout[0] = { x: 0, y: 0, w: W, h: h2 };
        C.layout[1] = { x: 0, y: h2 + sp, w: W, h: h2 };
      }
      return;
    }
    const f = n >= 6 ? 2 : 1;                 /* featured count: 1-2 */
    const fw = land ? Math.round(W * 0.5) : W;
    const fh = land ? H : Math.round(H * 0.52);
    if (f === 1) {
      drawBordered(x, C.imgs[0], 0, 0, fw, fh);
      C.layout[0] = { x: 0, y: 0, w: fw, h: fh };
    } else {
      /* two featured stacked (landscape) / side-by-side (portrait) */
      if (land) {
        const h2 = (fh - sp) / 2;
        drawBordered(x, C.imgs[0], 0, 0, fw, h2);
        drawBordered(x, C.imgs[1], 0, h2 + sp, fw, h2);
        C.layout[0] = { x: 0, y: 0, w: fw, h: h2 };
        C.layout[1] = { x: 0, y: h2 + sp, w: fw, h: h2 };
      } else {
        const w2 = (fw - sp) / 2;
        drawBordered(x, C.imgs[0], 0, 0, w2, fh);
        drawBordered(x, C.imgs[1], w2 + sp, 0, w2, fh);
        C.layout[0] = { x: 0, y: 0, w: w2, h: fh };
        C.layout[1] = { x: w2 + sp, y: 0, w: w2, h: fh };
      }
    }
    const tx = land ? fw + sp : 0;
    const ty = land ? 0 : fh + sp;
    const tw = land ? W - fw - sp : W;
    const th = land ? H : H - fh - sp;
    packRows(x, tx, ty, tw, th, C.imgs.slice(f), sp, C.layout, f);
  }

  /* ================= LAYOUT: Frame Mosaic =================
     One central photo framed by smaller tiles along the four edges.
     Strip thicknesses adapt (shrinking until the ring can hold every
     photo), then the ring photos are distributed over the strips by
     length weight: top -> right -> bottom -> left (clockwise). */
  function paintFrame(x, W, H, sc) {
    const n = C.imgs.length;
    const sp = Math.max(C.spacing, 4) * sc;
    C.layout = [];
    if (n <= 2) { paintMosaic(x, W, H, sc); return; }
    const m = n - 1;
    let kT, kB, kL, kR, tv, th;
    if (m < 4) {
      /* tiny rings: top + bottom strips only */
      kT = Math.ceil(m / 2); kB = m - kT; kL = 0; kR = 0;
      tv = Math.min(H * clamp(0.16 + 0.07 * m, 0.22, 0.42), (H - 2 * sp) / 2);
      th = 0;
    } else {
      /* strip thickness: start generous, shrink until the ring capacity
         can hold every photo; side strips only when they physically fit */
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
      /* distribute the m ring photos over the strips by length weight */
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
    /* center cell */
    const cx = kL > 0 ? th + sp : 0;
    const cy = kT > 0 ? tv + sp : 0;
    const cw2 = W - (kL > 0 ? 2 * (th + sp) : 0);
    const ch2 = H - (kT > 0 ? 2 * (tv + sp) : 0);
    if (cw2 > 4 && ch2 > 4) {
      drawBordered(x, C.imgs[0], cx, cy, cw2, ch2);
      C.layout[0] = { x: cx, y: cy, w: cw2, h: ch2 };
    }
    /* edge tiles, clockwise: top -> right -> bottom -> left */
    let idx = 1;
    if (kT > 0) {
      const w = (W - sp * (kT - 1)) / kT;
      for (let k = 0; k < kT && idx < n; k++, idx++) {
        drawBordered(x, C.imgs[idx], k * (w + sp), 0, w, tv);
        C.layout[idx] = { x: k * (w + sp), y: 0, w, h: tv };
      }
    }
    if (kR > 0) {
      const bandY = tv + sp, bandH = H - 2 * (tv + sp);
      const h = (bandH - sp * (kR - 1)) / kR;
      for (let k = 0; k < kR && idx < n; k++, idx++) {
        drawBordered(x, C.imgs[idx], W - th, bandY + k * (h + sp), th, h);
        C.layout[idx] = { x: W - th, y: bandY + k * (h + sp), w: th, h };
      }
    }
    if (kB > 0) {
      const w = (W - sp * (kB - 1)) / kB;
      for (let k = 0; k < kB && idx < n; k++, idx++) {
        drawBordered(x, C.imgs[idx], k * (w + sp), H - tv, w, tv);
        C.layout[idx] = { x: k * (w + sp), y: H - tv, w, h: tv };
      }
    }
    if (kL > 0) {
      const bandY = tv + sp, bandH = H - 2 * (tv + sp);
      const h = (bandH - sp * (kL - 1)) / kL;
      for (let k = 0; k < kL && idx < n; k++, idx++) {
        drawBordered(x, C.imgs[idx], 0, bandY + k * (h + sp), th, h);
        C.layout[idx] = { x: 0, y: bandY + k * (h + sp), w: th, h };
      }
    }
  }

  /* ================= LAYOUT: Grid / Contact Sheet ================= */
  function paintCells(x, W, H, sc, sheet) {
    const n = C.imgs.length;
    const sp = (sheet ? Math.max(C.spacing, 16) : C.spacing) * sc;
    const marg = (sheet ? Math.max(34, C.spacing + 20) : C.spacing + 6) * sc;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * (W / H))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cw = (W - marg * 2 - sp * (cols - 1)) / cols;
    const ch = (H - marg * 2 - sp * (rows - 1)) / rows;
    C.layout = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c2 = 0; c2 < cols && i < n; c2++, i++) {
        const px = marg + c2 * (cw + sp), py = marg + r * (ch + sp);
        if (sheet) {
          x.fillStyle = '#ffffff';
          x.fillRect(px, py, cw, ch);
          drawContain(x, C.imgs[i], px + cw * 0.045, py + cw * 0.045, cw * 0.91, ch - cw * 0.09);
        } else {
          drawBordered(x, C.imgs[i], px, py, cw, ch);
        }
        C.layout[i] = { x: px, y: py, w: cw, h: ch };
      }
    }
  }

  /* ================= master render ================= */
  function renderCollage(W, H, sc, skip) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(W)); c.height = Math.max(2, Math.round(H));
    W = c.width; H = c.height;
    const x = c.getContext('2d');
    x.fillStyle = C.bg;
    x.fillRect(0, 0, W, H);
    const n = C.imgs.length;
    if (!n) return c;
    const bi = Math.min(C.bgIdx || 0, n - 1);
    if (C.bgPhoto && C.imgs[bi]) drawBlurredBg(x, C.imgs[bi], W, H);
    /* v3.17.0: all five Picasa collage types are live again */
    if (C.type === 'mosaic') paintMosaic(x, W, H, sc);
    else if (C.type === 'frame') paintFrame(x, W, H, sc);
    else if (C.type === 'grid') paintCells(x, W, H, sc, false);
    else if (C.type === 'sheet') paintCells(x, W, H, sc, true);
    else paintPile(x, W, H, skip);
    return c;
  }

  function renderPreview() {
    const [W0, H0] = dims();
    const k = Math.min(1, 1500 / Math.max(W0, H0));
    const c = renderCollage(W0 * k, H0 * k, (W0 * k) / W0);
    el.canvas.width = c.width;
    el.canvas.height = c.height;
    el.canvas.getContext('2d').drawImage(c, 0, 0);
  }

  let rafPend = false;
  function scheduleRedraw(saveToo) {
    if (rafPend) return;
    rafPend = true;
    requestAnimationFrame(() => {
      rafPend = false;
      renderPreview();
      paintOverlay();
      if (saveToo) scheduleColSave();
    });
  }

  /* ================= selection overlay (never exported) =================
     v3.17.0: Picasa's iconic ROUND WHEEL replaces the old dashed box +
     lollipop handle. A semi-transparent grey donut ring sits in the exact
     center of the photo, with one small knob on its perimeter (fixed at the
     ring's NE point, screen-space — it never spins with the photo). The
     wheel shows strongly on the selected photo and faintly on the hovered
     one, exactly like Picasa 3. */
  function handleSize() { return Math.max(9, el.canvas.width * 0.011); }
  function wheelGeom(i) {
    const L = C.layout && C.layout[i];
    if (!L || !L.pile) return null;
    const R = clamp(Math.min(L.jw, L.jh) * 0.38, 20, Math.min(el.canvas.width, el.canvas.height) * 0.22);
    const ringW = Math.max(5, R * 0.17);
    const knobR = Math.max(5.5, R * 0.2);
    const ang = -Math.PI / 4;   /* knob rests at the ring's NE point */
    return {
      cx: L.px, cy: L.py, R, ringW, knobR, ang,
      kx: L.px + R * Math.cos(ang), ky: L.py + R * Math.sin(ang)
    };
  }
  function drawWheel(x, g, strong) {
    x.save();
    x.lineCap = 'round';
    /* donut ring */
    x.beginPath();
    x.arc(g.cx, g.cy, g.R, 0, Math.PI * 2);
    x.strokeStyle = strong ? 'rgba(96,104,112,.60)' : 'rgba(96,104,112,.26)';
    x.lineWidth = g.ringW;
    x.stroke();
    /* tiny hub dot in the exact center */
    x.beginPath(); x.arc(g.cx, g.cy, Math.max(2.4, g.R * 0.055), 0, Math.PI * 2);
    x.fillStyle = strong ? 'rgba(70,78,86,.6)' : 'rgba(70,78,86,.3)';
    x.fill();
    /* the small perimeter knob */
    x.beginPath(); x.arc(g.kx, g.ky, g.knobR, 0, Math.PI * 2);
    x.fillStyle = '#f4f5f6';
    x.fill();
    x.lineWidth = Math.max(1.4, g.knobR * 0.26);
    x.strokeStyle = 'rgba(90,98,106,.82)';
    x.stroke();
    x.restore();
  }
  function paintOverlay(keepBase) {
    const ov = el.overlay;
    if (ov.width !== el.canvas.width || ov.height !== el.canvas.height) {
      ov.width = el.canvas.width; ov.height = el.canvas.height;
    }
    const x = ov.getContext('2d');
    if (!keepBase) x.clearRect(0, 0, ov.width, ov.height);
    if (!C.open || !C.layout) return;
    const lw = Math.max(1.5, el.canvas.width * 0.0032);
    const hs = handleSize();
    const pile = C.type === 'pile';
    for (const i of C.sel) {
      const L = C.layout[i]; if (!L) continue;
      x.save();
      x.lineWidth = lw;
      /* v3.17.0: solid thin outline (the dashed border is retired) */
      x.strokeStyle = 'rgba(43,124,211,.85)';
      x.translate(L.px, L.py);
      x.rotate(L.rot);
      const m = hs * 0.9;
      if (pile) x.strokeRect(-L.jw / 2 - m, -L.jh / 2 - m, L.jw + m * 2, L.jh + m * 2);
      else x.strokeRect(L.x - lw, L.y - lw, L.w + lw * 2, L.h + lw * 2);
      x.restore();
      if (!pile) {
        x.fillStyle = '#2b7cd3';
        const d = Math.max(3, hs * 0.34);
        for (const [hx, hy] of [[L.x, L.y], [L.x + L.w, L.y], [L.x, L.y + L.h], [L.x + L.w, L.y + L.h]]) {
          x.fillRect(hx - d, hy - d, d * 2, d * 2);
        }
      }
    }
    /* the wheel: strong on the single selection, faint on the hovered photo */
    if (pile && !finalized()) {
      if (C.sel.size === 1) {
        const g = wheelGeom([...C.sel][0]);
        if (g) drawWheel(x, g, true);
      } else if (C.sel.size === 0 && C.hoverI >= 0 && !drag && C.layout[C.hoverI]) {
        const g = wheelGeom(C.hoverI);
        if (g) drawWheel(x, g, false);
      }
    }
    /* swap target highlight while dragging in slotted modes */
    if (swapTarget >= 0 && C.layout[swapTarget] && C.layout[swapTarget].w) {
      const L = C.layout[swapTarget];
      x.save();
      x.fillStyle = 'rgba(43,124,211,.20)';
      x.fillRect(L.x, L.y, L.w, L.h);
      x.lineWidth = lw * 1.6;
      x.strokeStyle = '#2b7cd3';
      x.strokeRect(L.x, L.y, L.w, L.h);
      x.restore();
    }
  }

  /* ================= hit testing ================= */
  function canvasPt(e) {
    const r = el.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (el.canvas.width / r.width),
             y: (e.clientY - r.top) * (el.canvas.height / r.height) };
  }
  function hitPhoto(pt) {
    if (!C.layout || !C.order || C.type !== 'pile') return -1;
    for (let k = C.order.length - 1; k >= 0; k--) {
      const L = C.layout[C.order[k]]; if (!L) continue;
      const dx = pt.x - L.px, dy = pt.y - L.py;
      const cos = Math.cos(-L.rot), sin = Math.sin(-L.rot);
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= L.jw / 2 && Math.abs(ly) <= L.jh / 2) return C.order[k];
    }
    return -1;
  }
  function hitCell(pt) {
    if (!C.layout) return -1;
    for (let i = 0; i < C.layout.length; i++) {
      const L = C.layout[i];
      if (!L || L.pile || L.w == null) continue;
      if (pt.x >= L.x && pt.x <= L.x + L.w && pt.y >= L.y && pt.y <= L.y + L.h) return i;
    }
    return -1;
  }
  function bringToFront(i) {
    if (!C.order) return;
    const k = C.order.indexOf(i);
    if (k >= 0) { C.order.splice(k, 1); C.order.push(i); }
  }
  function sendToBack(i) {
    if (!C.order) return;
    const k = C.order.indexOf(i);
    if (k >= 0) { C.order.splice(k, 1); C.order.unshift(i); }
  }
  function getPos(i) {
    C.pos = C.pos || [];
    const p = C.pos[i];
    if (p) return { x: p.x, y: p.y, rot: p.rot || 0, scale: p.scale || 1 };
    const L = C.layout[i];
    return L ? { x: L.px / el.canvas.width, y: L.py / el.canvas.height, rot: L.rot, scale: 1 }
             : { x: 0.5, y: 0.5, rot: 0, scale: 1 };
  }
  const finalized = () => C.final;   /* after "Create Collage" the result is final */

  /* ================= interactive transforms ================= */
  const ptrs = new Map();
  let drag = null;

  /* ---- v3.15.0 Picasa-smooth dragging ----
     While a gesture is active the collage is NOT re-rendered every frame.
     renderCollage() runs ONCE at gesture start WITHOUT the dragged photos
     (baseSnap); every pointermove then just recomposites that snapshot plus
     the moved photos onto the overlay canvas — a ~60fps operation instead of
     a full re-render (background + blurred photo + every photo). */
  let baseSnap = null;
  let dragSet = null;
  let wheelT = null;
  function buildBase() {
    dragSet = (drag.mode === 'move' || drag.mode === 'pinch') ? new Set(C.sel)
            : new Set([drag.i]);
    if (!dragSet.size) { baseSnap = null; dragSet = null; return; }
    baseSnap = renderCollage(el.canvas.width, el.canvas.height, 1, dragSet);
  }
  function dragPaint() {
    if (!baseSnap || !dragSet) return;
    const ov = el.overlay;
    if (ov.width !== el.canvas.width || ov.height !== el.canvas.height) {
      ov.width = el.canvas.width; ov.height = el.canvas.height;
    }
    const x = ov.getContext('2d');
    x.clearRect(0, 0, ov.width, ov.height);
    x.drawImage(baseSnap, 0, 0);
    for (const j of dragSet) {
      const b = drawPilePhoto(x, j, el.canvas.width, el.canvas.height);
      if (b) C.layout[j] = { px: b.px, py: b.py, jw: b.jw, jh: b.jh, rot: b.rot, pile: true };
    }
    paintOverlay(true);   /* outlines + handles on top (no clear) */
  }
  function endGesture() { baseSnap = null; dragSet = null; }

  function startPinch() {
    const [p1, p2] = [...ptrs.values()];
    let i = hitPhoto(p1);
    if (i < 0 && C.sel.size === 1) i = [...C.sel][0];
    if (i < 0) { drag = null; return; }
    if (!C.sel.has(i)) C.sel = new Set([i]);
    bringToFront(i);
    drag = {
      mode: 'pinch', i,
      d0: Math.max(8, dist(p1, p2)),
      ang0: Math.atan2(p2.y - p1.y, p2.x - p1.x),
      c0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      start: getPos(i)
    };
    buildBase();
    el.canvas.style.cursor = 'grabbing';
    paintOverlay();
  }
  function pinchUpdate() {
    const [p1, p2] = [...ptrs.values()];
    if (!p1 || !p2 || !drag) return;
    const d = Math.max(8, dist(p1, p2));
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const c = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const s = drag.start;
    C.pos = C.pos || [];
    C.pos[drag.i] = {
      x: clamp(s.x + (c.x - drag.c0.x) / el.canvas.width, -0.5, 1.5),
      y: clamp(s.y + (c.y - drag.c0.y) / el.canvas.height, -0.5, 1.5),
      rot: s.rot + (ang - drag.ang0),
      scale: clamp(s.scale * d / drag.d0, 0.2, 4)
    };
    dragPaint();
  }

  function wireInteractions() {
    const cv = el.canvas;
    /* v3.15.2 FIX — "drag to move is dead": pointermove/pointerup used to sit
       on the CANVAS only. One missed pointerup (a touch contact the browser
       cancelled elsewhere, a capture that silently failed, releasing the
       mouse over another element) left a GHOST pointer inside `ptrs`
       forever — the next pointerdown then looked like a 2-finger pinch,
       startPinch() bailed out, and every drag stayed dead (photos were still
       selectable, but nothing ever moved) until the page was reloaded.
       Now: move/up/cancel live on WINDOW (the whole gesture is always seen),
       and a mouse pointerdown flushes stale entries, so the trap can never
       re-arm. */
    const onMove = (e) => {
      if (!C.open || el.root.hidden) return;
      const pt = canvasPt(e);
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, pt);
      if (drag && drag.mode === 'pinch') { pinchUpdate(); return; }
      if (!drag) {
        const r = cv.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) {
          if (C.hoverI !== -1) { C.hoverI = -1; if (!finalized()) paintOverlay(); }
          return;
        }
        if (finalized()) { cv.style.cursor = 'default'; return; }
        const hit = C.type === 'pile' ? hitPhoto(pt) : (SLOTTED.includes(C.type) ? hitCell(pt) : -1);
        cv.style.cursor = hit >= 0 ? 'grab' : 'default';
        /* v3.17.0: the wheel faintly appears under the cursor (Picasa hover) */
        if (hit !== C.hoverI) { C.hoverI = hit; paintOverlay(); }
        return;
      }
      switch (drag.mode) {
        case 'move': {
          const dx = (pt.x - drag.pt.x) / el.canvas.width;
          const dy = (pt.y - drag.pt.y) / el.canvas.height;
          C.pos = C.pos || [];
          for (const j of C.sel) {
            const s = drag.snap[j]; if (!s) continue;
            C.pos[j] = { x: clamp(s.x + dx, -0.5, 1.5), y: clamp(s.y + dy, -0.5, 1.5), rot: s.rot, scale: s.scale };
          }
          drag.pt = pt;
          dragPaint();
          break;
        }
        case 'knob': {
          /* v3.17.0 Picasa wheel knob: the ANGLE around the captured wheel
             center sets the rotation, the DISTANCE sets the scale — both at
             once. The center is fixed at gesture start (see pointerdown). */
          const ang = Math.atan2(pt.y - drag.c.y, pt.x - drag.c.x);
          const d = dist(pt, drag.c);
          let rot = drag.start.rot + (ang - drag.a0);
          const snap90 = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
          if (Math.abs(rot - snap90) < 3 * DEG) rot = snap90;   /* magnetic 0/90/180/270 */
          C.pos = C.pos || [];
          C.pos[drag.i] = { x: drag.start.x, y: drag.start.y, rot, scale: clamp(drag.start.scale * d / drag.d0, 0.2, 4) };
          dragPaint();
          break;
        }
        case 'swap': {
          const over = hitCell(pt);
          if (over !== swapTarget) { swapTarget = over; paintOverlay(); }
          break;
        }
      }
    };
    const onUp = (e) => {
      if (!C.open) return;
      const known = e && ptrs.has(e.pointerId);
      if (e && !drag && !known) return;   /* an ordinary click elsewhere in the app */
      if (known) ptrs.delete(e.pointerId);
      if (drag && drag.mode === 'pinch' && ptrs.size >= 2) return;  /* still pinching */
      if (drag && drag.mode === 'swap') {
        if (swapTarget >= 0 && swapTarget !== drag.from) {
          const a = drag.from, b = swapTarget;
          [C.imgs[a], C.imgs[b]] = [C.imgs[b], C.imgs[a]];
          if (C.list && C.list[a] && C.list[b]) { const t = C.list[a]; C.list[a] = C.list[b]; C.list[b] = t; }
          C.sel = new Set([a]);
          scheduleRedraw(true);
        }
      } else if (drag) {
        scheduleColSave();
      }
      drag = null;
      swapTarget = -1;
      endGesture();
      clearTimeout(wheelT);
      el.canvas.style.cursor = 'default';
      scheduleRedraw(true);
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!C.open || finalized() || el.root.hidden) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();   /* no native text-selection / ghost image drag */
      if (e.pointerType === 'mouse') ptrs.clear();   /* a mouse is one pointer: flush ghosts */
      if (drag && drag.mode === 'wheel') { drag = null; endGesture(); clearTimeout(wheelT); }
      const pt = canvasPt(e);
      ptrs.set(e.pointerId, pt);
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      if (C.type === 'pile') {
        if (ptrs.size >= 2) { startPinch(); return; }
        /* v3.17.0: the wheel knob first — it sits on the perimeter of the
           wheel of the selected (or hovered) photo; grabbing it rotates AND
           resizes in a single gesture, exactly like Picasa 3 */
        const knobOwner = C.sel.size === 1 ? [...C.sel][0] : C.hoverI;
        if (knobOwner >= 0) {
          const g = wheelGeom(knobOwner);
          if (g && dist(pt, { x: g.kx, y: g.ky }) <= Math.max(14, g.knobR * 2.2)) {
            if (!C.sel.has(knobOwner)) C.sel = new Set([knobOwner]);
            bringToFront(knobOwner);
            const L = C.layout[knobOwner];
            drag = {
              mode: 'knob', i: knobOwner,
              /* v3.17.0 FIX: buildBase() re-renders the pile WITHOUT the
                 dragged photo, so C.layout[i] is a hole mid-gesture — the
                 wheel center is captured here once and stays fixed while
                 the knob turns (the photo rotates around its own center) */
              c: { x: L.px, y: L.py },
              a0: Math.atan2(pt.y - L.py, pt.x - L.px),
              d0: Math.max(12, dist(pt, { x: L.px, y: L.py })),
              start: getPos(knobOwner)
            };
            buildBase();
            cv.style.cursor = 'grabbing';
            paintOverlay();
            return;
          }
        }
        const i = hitPhoto(pt);
        if (i >= 0) {
          if (e.ctrlKey || e.metaKey) {
            if (C.sel.has(i)) C.sel.delete(i); else C.sel.add(i);
          } else if (!C.sel.has(i)) {
            C.sel = new Set([i]);
          }
          bringToFront(i);   /* Picasa: the photo you grab jumps on top */
          const snap = {};
          for (const j of C.sel) snap[j] = getPos(j);
          drag = { mode: 'move', pt, snap };
          buildBase();
          cv.style.cursor = 'grabbing';
        } else {
          C.sel.clear();
          C.hoverI = -1;
          drag = null;
        }
        paintOverlay();
      } else if (SLOTTED.includes(C.type)) {
        const i = hitCell(pt);
        if (i >= 0) {
          if (!C.sel.has(i)) C.sel = new Set([i]);
          drag = { mode: 'swap', from: i, pt };
          cv.style.cursor = 'grabbing';
        } else {
          C.sel.clear();
          C.hoverI = -1;
          drag = null;
        }
        paintOverlay();
      }
    });

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', () => {
      ptrs.clear();   /* alt-tab / window switch: every pointer is gone */
      drag = null;
      swapTarget = -1;
      endGesture();
      clearTimeout(wheelT);
      if (C.open) cv.style.cursor = 'default';
    });

    cv.addEventListener('wheel', (e) => {
      if (!C.open || finalized() || C.type !== 'pile') return;
      const pt = canvasPt(e);
      let i = hitPhoto(pt);
      if (i < 0 && C.sel.size === 1) i = [...C.sel][0];
      if (i < 0) return;
      e.preventDefault();
      if (!drag) { drag = { mode: 'wheel', i }; buildBase(); }
      const pos = getPos(i);
      if (e.shiftKey) pos.rot += (e.deltaY < 0 ? 1 : -1) * 5 * DEG;
      else pos.scale = clamp(pos.scale * (e.deltaY < 0 ? 1.07 : 0.93), 0.2, 4);
      C.pos = C.pos || [];
      C.pos[i] = pos;
      dragPaint();
      clearTimeout(wheelT);
      wheelT = setTimeout(() => {
        if (drag && drag.mode === 'wheel') {
          drag = null; endGesture();
          scheduleRedraw(true);
        }
      }, 350);
    }, { passive: false });

    /* v3.17.0: Picasa right-click menu on any collage photo */
    cv.addEventListener('contextmenu', (e) => {
      if (!C.open || el.root.hidden) return;
      e.preventDefault();
      el.menu.hidden = true;
      if (finalized()) return;
      const pt = canvasPt(e);
      const i = C.type === 'pile' ? hitPhoto(pt) : (SLOTTED.includes(C.type) ? hitCell(pt) : -1);
      if (i < 0) return;
      if (!C.sel.has(i)) C.sel = new Set([i]);
      paintOverlay();
      openMenu(e.clientX, e.clientY, i);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!el.menu.hidden && !e.target.closest('#cMenu')) el.menu.hidden = true;
    }, true);
    window.addEventListener('blur', () => { el.menu.hidden = true; });
  }

  /* ================= selection actions ================= */
  function firstSel() { return C.sel.size ? [...C.sel][0] : -1; }
  function selectAll() {
    C.sel = new Set(C.imgs.map((_, i) => i));
    paintOverlay();
  }
  function selectNone() { C.sel.clear(); paintOverlay(); }
  function removeSelected() {
    if (!C.sel.size || !C.imgs.length) return;
    if (C.sel.size >= C.imgs.length) { toast('Keep at least one photo in the collage', 'err'); return; }
    returnToClips();   /* v3.17.0: removed photos fall back into the Clips tray */
    const keep = [];
    for (let i = 0; i < C.imgs.length; i++) if (!C.sel.has(i)) keep.push(i);
    C.imgs = keep.map((i) => C.imgs[i]);
    C.list = keep.map((i) => C.list[i]);
    C.pos = C.pos ? keep.map((i) => (C.pos && C.pos[i]) || null) : null;
    if (C.order) {
      const remap = new Map(keep.map((old, nw) => [old, nw]));
      C.order = C.order.filter((i) => remap.has(i)).map((i) => remap.get(i));
    }
    C.bgIdx = remapIdx(C.bgIdx, keep);
    C.sel.clear();
    noteCount();
    scheduleRedraw(true);
  }
  function remapIdx(old, keep) {
    if (old == null) return 0;
    const nw = keep.indexOf(old);
    return nw >= 0 ? nw : 0;
  }
  function zOrder(dir) {
    if (C.type !== 'pile' || !C.sel.size) return;
    C.order = C.order && C.order.length === C.imgs.length ? C.order : C.imgs.map((_, i) => i);
    const front = C.order.filter((i) => C.sel.has(i));
    const rest = C.order.filter((i) => !C.sel.has(i));
    C.order = dir === 1 ? rest.concat(front) : front.concat(rest);
    scheduleRedraw(true);
  }
  function rotateSel(dir) {
    if (C.type !== 'pile' || !C.sel.size) return;
    C.pos = C.pos || [];
    for (const j of C.sel) {
      const p = getPos(j);
      p.rot = ((p.rot + dir * Math.PI / 2 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      C.pos[j] = p;
    }
    scheduleRedraw(true);
  }
  function scaleSel(mult) {
    if (C.type !== 'pile' || !C.sel.size) return;
    C.pos = C.pos || [];
    for (const j of C.sel) {
      const p = getPos(j);
      p.scale = clamp(p.scale * mult, 0.2, 4);
      C.pos[j] = p;
    }
    scheduleRedraw(true);
  }
  function shufflePics() {
    if (C.imgs.length < 2) return;
    for (let i = C.imgs.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const a = C.imgs[i]; C.imgs[i] = C.imgs[j]; C.imgs[j] = a;
      if (C.list && C.list.length === C.imgs.length) { const b = C.list[i]; C.list[i] = C.list[j]; C.list[j] = b; }
    }
    C.sel.clear();
    scheduleRedraw(true);
  }
  function scramble() {
    if (C.type === 'pile') {
      C.seed = (Math.random() * 2147483646) | 0;
      C.pos = null;
      C.order = null;
    } else {
      shufflePics();
      return;
    }
    C.sel.clear();
    scheduleRedraw(true);
  }
  function setAsBackground() {
    if (!C.imgs.length) return;
    const i = firstSel();
    C.bgIdx = i >= 0 ? i : 0;
    C.bgPhoto = true;
    el.bgPhoto.checked = true;
    scheduleRedraw(true);
  }
  function viewAndEdit() {
    const i = firstSel();
    if (i < 0) { toast('Select a photo first, then press View and Edit', 'err'); return; }
    const item = C.list[i];
    const k = item ? photoKey(item) : null;
    const idx = k != null ? state.photos.findIndex((p) => photoKey(p) === k) : -1;
    if (idx < 0) { toast('This photo is not in the library — View and Edit works with library photos', 'err', 4500); return; }
    close();
    if (window.PixsaEditor) window.PixsaEditor.open(idx);
  }

  /* ================= v3.17.0: Picasa right-click context menu ================= */
  function openMenu(cx, cy, i) {
    const m = el.menu;
    m.innerHTML = '';
    const pile = C.type === 'pile';
    const add = (label, cmd, dis) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.disabled = !!dis;
      b.addEventListener('click', () => { m.hidden = true; menuCmd(cmd, i); });
      m.appendChild(b);
    };
    const sep = () => { const s = document.createElement('div'); s.className = 'csep'; m.appendChild(s); };
    add('Set as Background', 'setbg');
    sep();
    add('Bring to Top', 'top', !pile);
    add('Bring Forward', 'fwd', !pile);
    add('Send Backward', 'back1', !pile);
    add('Send to Bottom', 'bottom', !pile);
    sep();
    add('Rotate Right (90\u00b0)', 'rotR', !pile);
    add('Rotate Left (-90\u00b0)', 'rotL', !pile);
    sep();
    add('View and Edit', 'view');
    add('Remove', 'remove');
    m.hidden = false;
    m.style.left = '0px'; m.style.top = '0px';
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(cx, window.innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(6, Math.min(cy, window.innerHeight - r.height - 8)) + 'px';
  }
  function menuCmd(cmd, i) {
    if (finalized()) return;
    C.sel = new Set([i]);
    switch (cmd) {
      case 'setbg': setAsBackground(); break;
      case 'top':
        C.order = C.order && C.order.length === C.imgs.length ? C.order : C.imgs.map((_, k) => k);
        bringToFront(i); scheduleRedraw(true); break;
      case 'fwd': zStep(i, 1); break;
      case 'back1': zStep(i, -1); break;
      case 'bottom':
        C.order = C.order && C.order.length === C.imgs.length ? C.order : C.imgs.map((_, k) => k);
        sendToBack(i); scheduleRedraw(true); break;
      case 'rotR': rotateSel(1); break;
      case 'rotL': rotateSel(-1); break;
      case 'view': viewAndEdit(); break;
      case 'remove': removeSelected(); break;
    }
  }
  /* one-step z-order: swap the photo with its neighbour in the draw order */
  function zStep(i, dir) {
    if (C.type !== 'pile') return;
    C.order = C.order && C.order.length === C.imgs.length ? C.order : C.imgs.map((_, k) => k);
    const k = C.order.indexOf(i), t = k + dir;
    if (k < 0 || t < 0 || t >= C.order.length) return;
    const tmp = C.order[k]; C.order[k] = C.order[t]; C.order[t] = tmp;
    scheduleRedraw(true);
  }
  /* removed photos drop back into the Clips tray (the Photo Tray) */
  function returnToClips() {
    const item = firstSel() >= 0 ? C.list[firstSel()] : null;
    if (!item || !P.state) return;
    const k = photoKey(item);
    const lp = (P.state.photos || []).find((p) => photoKey(p) === k);
    if (lp && !P.state.selArr.some((x) => photoKey(x) === k)) {
      P.state.selArr.push(lp);
      if (P.renderTray) P.renderTray();
    }
  }

  /* ================= v3.17.0: Clips tab — add photos any time ================= */
  const clipThumbs = new Map();
  function syncClips() {
    if (!el.clips) return;
    const tray = (P.state && P.state.selArr) || [];
    if (el.clipCount) el.clipCount.textContent = String(tray.length);
    if (!C.open || el.root.hidden) return;
    const box = el.clips;
    box.innerHTML = '';
    if (!tray.length) {
      const tip = document.createElement('div');
      tip.className = 'cliptip';
      tip.textContent = 'Select photos in the Library — they appear here as Clips. You can also add photos straight from your PC below.';
      box.appendChild(tip);
      return;
    }
    const inCol = new Set(C.list.map((x) => photoKey(x)));
    for (const p of tray) {
      const k = photoKey(p);
      const used = inCol.has(k);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'clip';
      b.title = used ? `${p.name} — already in the collage` : `Add ${p.name} to the collage`;
      const img = document.createElement('img');
      img.decoding = 'async'; img.alt = '';
      b.appendChild(img);
      if (used) { const t = document.createElement('span'); t.className = 'inuse'; t.textContent = 'in collage'; b.appendChild(t); }
      b.addEventListener('click', () => { if (!used) addClipPhoto(p); });
      box.appendChild(b);
      if (clipThumbs.has(k)) img.src = clipThumbs.get(k);
      else clipThumb(p, img, k);
    }
  }
  async function clipThumb(p, imgEl, k) {
    try {
      const file = await getFile(p);
      let bmp;
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { bmp = await createImageBitmap(file); }
      const c = document.createElement('canvas');
      const sc = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
      c.width = Math.max(1, Math.round(bmp.width * sc));
      c.height = Math.max(1, Math.round(bmp.height * sc));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      const url = c.toDataURL('image/jpeg', 0.78);
      clipThumbs.set(k, url);
      if (imgEl.isConnected) imgEl.src = url;
    } catch (e) { /* unreadable clip — leave blank */ }
  }
  /* place a freshly added photo in the middle, on top, selected */
  function appendAtTop() {
    const idx = C.imgs.length - 1;
    C.pos = C.pos || [];
    C.pos[idx] = { x: 0.5, y: 0.5, rot: 0, scale: 1 };
    if (C.order && C.order.length === C.imgs.length - 1) C.order.push(idx);
    else C.order = C.imgs.map((_, k) => k);
    C.sel = new Set([idx]);
    noteCount();
  }
  async function addClipPhoto(p) {
    if (C.list.some((x) => photoKey(x) === photoKey(p))) { toast('That photo is already in the collage', 'ok', 2500); return; }
    if (C.imgs.length >= 60) { toast('The collage is full (60 photos max)', 'err'); return; }
    el.busy.hidden = false;
    try {
      const file = await getFile(p);
      let bmp;
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { bmp = await createImageBitmap(file); }
      if (Math.max(bmp.width, bmp.height) > 1400) {
        const sc = 1400 / Math.max(bmp.width, bmp.height);
        const t = document.createElement('canvas');
        t.width = Math.round(bmp.width * sc); t.height = Math.round(bmp.height * sc);
        t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
        if (bmp.close) bmp.close();
        bmp = t;
      }
      C.imgs.push(bmp);
      C.list.push(p);
      if (/\.(png|webp|gif)$/i.test(p.name || '')) C.alphaAny = true;
      appendAtTop();
      syncClips();
      renderPreview(); paintOverlay(); scheduleColSave();
      toast(`${p.name || 'Photo'} added to the collage — drag it anywhere`, 'ok', 2600);
    } catch (e) { toast('That photo could not be added', 'err'); }
    el.busy.hidden = true;
  }
  async function addFileToCollage(f) {
    if (!f) return;
    if (!/^image\//.test(f.type || '') && !/\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(f.name || '')) return;
    if (C.imgs.length >= 60) { toast('The collage is full (60 photos max)', 'err'); return; }
    el.busy.hidden = false;
    try {
      let bmp;
      try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); }
      catch (e) { bmp = await createImageBitmap(f); }
      if (Math.max(bmp.width, bmp.height) > 1400) {
        const sc = 1400 / Math.max(bmp.width, bmp.height);
        const t = document.createElement('canvas');
        t.width = Math.round(bmp.width * sc); t.height = Math.round(bmp.height * sc);
        t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
        if (bmp.close) bmp.close();
        bmp = t;
      }
      C.imgs.push(bmp);
      C.list.push({ name: f.name || 'photo', size: f.size || 0, lastModified: f.lastModified || 0, handle: null, file: f });
      if (/\.(png|webp|gif)$/i.test(f.name || '') || f.type === 'image/png') C.alphaAny = true;
      appendAtTop();
      syncClips();
      renderPreview(); paintOverlay(); scheduleColSave();
      toast(`${f.name || 'Photo'} added to the collage — drag it anywhere`, 'ok', 2600);
    } catch (e) { toast('That photo could not be added', 'err'); }
    el.busy.hidden = true;
  }

  /* ================= power-cut safe project auto-save ================= */
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
  /* v3.16.0: one shared compressed-photos builder (power-cut save + collage record) */
  async function collectPhotoBlobs() {
    const photos = [];
    for (let i = 0; i < C.imgs.length && i < 40; i++) {
      const b = await imgToBlob(C.imgs[i]);
      if (b) photos.push({ name: (C.list[i] && C.list[i].name) || ('photo-' + (i + 1)), blob: b });
    }
    return photos;
  }
  async function saveCollageProject() {
    if (!C.open || !C.imgs.length) return;
    try {
      const photos = await collectPhotoBlobs();
      if (!photos.length) return;
      const previewBlob = await new Promise((r) => el.canvas.toBlob(r, C.alphaAny ? 'image/png' : 'image/jpeg', 0.9));
      const proj = {
        type: C.type, bg: C.bg, border: C.border,
        landscape: C.landscape, bgPhoto: C.bgPhoto, bgIdx: C.bgIdx, seed: C.seed, fmt: fmtVal(),
        custW: C.custW, custH: C.custH,
        shadows: C.shadows, captions: C.captions,
        exportFmt: el.exportFmt.value,
        pos: C.pos, photos, previewBlob, ts: Date.now(),
        editId: C.editId, editName: C.editName   /* v3.16.0: an interrupted re-edit reopens linked */
      };
      await P.idbSet('collage', 'current', proj);
      C.savedProj = true;
    } catch (e) { /* storage full — Create/Download still work */ }
  }
  /* ================= v3.16.0: finished collages live in the library =================
     Every Create Collage stores a full record (result + photos + positions) in
     the 'collages' store and drops the result into the library's pinned
     "Collages" folder — the Picasa way. Because the record keeps everything,
     double-clicking that collage in the grid reopens it here for changes. */
  async function saveCollage() {
    if (!C.blob) return;
    try {
      const photos = await collectPhotoBlobs();
      if (!photos.length) return;
      const id = C.editId || ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
      let name = C.editName;
      if (!name) {
        const d = new Date();
        const p2 = (n) => String(n).padStart(2, '0');
        name = `Collage ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}.jpg`;
      }
      const rec = {
        id, name, ts: Date.now(), blob: C.blob, w: C.outW || 0, h: C.outH || 0,
        photos, pos: C.pos, seed: C.seed, fmt: fmtVal(),
        type: C.type, custW: C.custW, custH: C.custH, bg: C.bg, border: C.border,
        landscape: C.landscape, bgPhoto: C.bgPhoto, bgIdx: C.bgIdx,
        shadows: C.shadows, captions: C.captions,
        exportFmt: el.exportFmt.value
      };
      await P.idbSet('collages', id, rec);
      if (P.addCollageItem) P.addCollageItem(rec);
      C.editId = id; C.editName = name;
      toast('Collage saved to the Collages folder', 'ok', 3500);
    } catch (e) { /* storage full — Download still works */ }
  }
  /* Picasa-style re-edit: open a finished collage from the library with its
     photos and positions exactly as they were left */
  async function editCollage(id) {
    try {
      const rec = await P.idbGet('collages', id);
      if (!rec || !rec.photos || !rec.photos.length || !rec.blob) { toast('This collage could not be opened', 'err'); return; }
      await openRestored(Object.assign({}, rec, { editId: id, previewBlob: rec.blob }));
    } catch (e) { toast('This collage could not be opened', 'err'); }
  }
  async function openRestored(proj) {
    if (!proj || !proj.photos || !proj.photos.length) { toast('The collage project is incomplete', 'err'); return; }
    C.open = true; C.blob = null; C.restored = true;
    /* v3.16.0: opened for RE-EDIT from the Collages folder? stay linked */
    C.editId = proj.editId || null;
    C.editName = C.editId ? (proj.name || '') : '';
    C.list = proj.photos.map((ph) => ({ name: ph.name || 'photo', size: 0, lastModified: 0, handle: null, file: null }));
    C.type = ALL_TYPES.includes(proj.type) ? proj.type : 'pile';
    C.shadows = proj.shadows !== false;
    C.captions = !!proj.captions;
    C.bg = proj.bg || '#f5f2ec';
    C.border = proj.border || 'white';
    C.landscape = proj.landscape !== false;
    C.bgPhoto = !!proj.bgPhoto;
    C.bgIdx = proj.bgIdx || 0;
    C.seed = proj.seed || 7;
    C.pos = Array.isArray(proj.pos) ? proj.pos : null;
    C.layout = null; C.order = null; C.sel = new Set();
    C.hoverI = -1; C.final = false;
    C.alphaAny = proj.photos.some((ph) => /\.(png|webp|gif)$/i.test(ph.name || '')) ||
                 proj.photos.some((ph) => ph.blob && ph.blob.type === 'image/png');
    C.custW = (proj.custW && isFinite(proj.custW)) ? proj.custW : 16;
    C.custH = (proj.custH && isFinite(proj.custH)) ? proj.custH : 9;
    el.root.hidden = false;
    el.fmt.value = NORM_FMT[proj.fmt] || proj.fmt || '4x3';
    if (el.fmt.selectedIndex < 0) el.fmt.value = '4x3';
    el.custRow.hidden = fmtVal() !== 'custom';
    el.custW.value = C.custW; el.custH.value = C.custH;
    if (proj.exportFmt) el.exportFmt.value = proj.exportFmt;
    el.resultBar.hidden = true;
    updateUI();
    el.note.textContent = C.editId
      ? `Editing "${C.editName || 'collage'}" — press Create Collage to update it`
      : `Auto-saved collage reopened (${proj.photos.length} photos)`;
    C.noteBase = el.note.textContent;
    noteCount();
    updateUI();
    el.busy.hidden = false;
    const out = [];
    for (const ph of proj.photos) {
      try { out.push(await createImageBitmap(ph.blob)); } catch (e) { /* skip */ }
    }
    C.imgs = out;
    el.busy.hidden = true;
    renderPreview();
    paintOverlay();
    if (proj.previewBlob) {
      C.blob = proj.previewBlob;
      if (C.url) URL.revokeObjectURL(C.url);
      C.url = URL.createObjectURL(C.blob);
    }
    toast(C.editId ? 'Collage opened for editing' : 'Previous collage restored', 'ok', 3000);
  }

  /* ================= open / close / create ================= */
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

  function noteCount() {
    el.count.textContent = C.imgs.length
      ? `${C.imgs.length} photo${C.imgs.length !== 1 ? 's' : ''} in the collage`
      : '';
  }

  function updateUI() {
    el.orientL.classList.toggle('on', C.landscape);
    el.orientP.classList.toggle('on', !C.landscape);
    for (const b of el.borders.querySelectorAll('button')) b.classList.toggle('on', b.dataset.b === C.border);
    el.type.value = ALL_TYPES.includes(C.type) ? C.type : 'pile';
    el.shadows.checked = C.shadows;
    el.captions.checked = C.captions;
    el.bgPhoto.checked = C.bgPhoto;
    el.bgSolid.checked = !C.bgPhoto;
    el.bg.value = C.bg;
    el.cDesktop.disabled = el.cCreate.disabled = C.final;
    el.toolInfo.textContent = 'Drag to move \u2022 drag the wheel knob to rotate + resize \u2022 wheel resizes \u2022 Shift+wheel rotates \u2022 right-click for more';
    noteCount();
    if (C.noteBase && !C.final) {
      el.note.textContent = C.noteBase +
        ' \u2022 Drag the wheel knob to rotate + resize \u2014 wheel resizes, Shift+wheel rotates, right-click for more';
    }
  }

  async function open(list) {
    if (!list || !list.length) return;
    C.list = list.slice(0, 60);
    C.open = true;
    C.blob = null;
    C.restored = false;
    C.type = 'pile';
    C.pos = null; C.layout = null; C.order = null; C.sel = new Set();
    C.editId = null; C.editName = '';   /* v3.16.0: a fresh collage is a new record */
    C.bgIdx = 0;
    C.hoverI = -1; C.final = false;
    endGesture(); clearTimeout(wheelT);
    if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
    el.root.hidden = false;
    el.resultBar.hidden = true;
    el.custRow.hidden = fmtVal() !== 'custom';
    updateUI();
    await loadImgs();
    noteCount();
    syncClips();
    renderPreview();
    paintOverlay();
    scheduleColSave();
  }
  function close() {
    C.open = false;
    el.root.hidden = true;
    C.sel.clear();
    C.editId = null; C.editName = '';
    C.hoverI = -1; C.final = false;
    el.resultBar.hidden = true;
    el.menu.hidden = true;
    endGesture(); clearTimeout(wheelT);
    if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
    C.blob = null;
  }

  async function create() {
    el.busy.hidden = false;
    await new Promise((r) => setTimeout(r, 40));
    try {
      const [W0] = dims();
      const [W, H] = exportDims();
      C.outW = W; C.outH = H;
      const c = renderCollage(W, H, W / W0);
      const want = el.exportFmt.value;
      const type = want === 'png' || (want === 'auto' && C.alphaAny) ? 'image/png' : 'image/jpeg';
      C.blob = await new Promise((r) => c.toBlob(r, type, 0.92));
      if (!C.blob) { toast('The collage could not be created — please try again', 'err'); return; }
      if (C.url) URL.revokeObjectURL(C.url);
      C.url = URL.createObjectURL(C.blob);
      renderPreview();
      paintOverlay();
      C.final = true;
      el.resultBar.hidden = false;
      el.resultNote.textContent = `Collage ready — ${W} \u00D7 ${H}px (${C.blob.type === 'image/png' ? 'PNG' : 'JPEG'}) — saved to the Collages folder`;
      el.note.textContent = 'Collage created — download it, save it to a folder, or go back to edit.';
      el.cDesktop.disabled = el.cCreate.disabled = true;
      saveCollage();
    } finally {
      el.busy.hidden = true;
    }
  }

  function wire() {
    /* v3.17.0: hidden file input for "Add More Photos…" */
    el.fileAdd = document.createElement('input');
    el.fileAdd.type = 'file';
    el.fileAdd.multiple = true;
    el.fileAdd.accept = 'image/*';
    el.fileAdd.hidden = true;
    el.paneClips.appendChild(el.fileAdd);

    el.type.addEventListener('change', () => {
      /* v3.17.0: all five Picasa types are live again */
      C.type = ALL_TYPES.includes(el.type.value) ? el.type.value : 'pile';
      C.sel.clear();
      C.hoverI = -1;
      updateUI();
      scheduleRedraw(true);
      scheduleColSave();
    });
    el.fmt.addEventListener('change', () => {
      el.custRow.hidden = fmtVal() !== 'custom';
      scheduleRedraw(true);   /* the stage snaps to the new ratio at once */
      scheduleColSave();
    });
    el.custApply.addEventListener('click', () => {
      const w = parseFloat(el.custW.value), h = parseFloat(el.custH.value);
      if (!(w > 0) || !(h > 0)) { toast('Ratio needs two numbers bigger than 0', 'err'); return; }
      C.custW = clamp(w, 0.2, 60); C.custH = clamp(h, 0.2, 60);
      scheduleRedraw(true);
      scheduleColSave();
    });
    el.orientL.addEventListener('click', () => {
      if (!C.landscape) { C.landscape = true; updateUI(); scheduleRedraw(true); scheduleColSave(); }
    });
    el.orientP.addEventListener('click', () => {
      if (C.landscape) { C.landscape = false; updateUI(); scheduleRedraw(true); scheduleColSave(); }
    });
    el.borders.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-b]');
      if (!b) return;
      C.border = b.dataset.b;
      updateUI();
      scheduleRedraw(true);
      scheduleColSave();
    });
    el.bg.addEventListener('input', () => {
      C.bg = el.bg.value;
      C.bgPhoto = false; el.bgSolid.checked = true; el.bgPhoto.checked = false;
      scheduleRedraw(true);
    });
    el.bgSolid.addEventListener('change', () => {
      if (el.bgSolid.checked) { C.bgPhoto = false; el.bgPhoto.checked = false; scheduleRedraw(true); }
    });
    el.bgPhoto.addEventListener('change', () => {
      C.bgPhoto = el.bgPhoto.checked;
      el.bgSolid.checked = !C.bgPhoto;
      if (C.bgPhoto && !C.imgs.length) {
        toast('Add photos first — then one can become the background', 'err');
        C.bgPhoto = false; el.bgPhoto.checked = false; el.bgSolid.checked = true;
        return;
      }
      scheduleRedraw(true);
    });
    el.eyedrop.addEventListener('click', () => {
      if (!window.EyeDropper) { toast('The eyedropper needs Chrome or Edge', 'err', 4000); return; }
      new window.EyeDropper().open().then((r) => {
        C.bg = r.sRGBHex; el.bg.value = C.bg;
        C.bgPhoto = false; el.bgSolid.checked = true; el.bgPhoto.checked = false;
        scheduleRedraw(true);
      }).catch(() => { /* user pressed Escape */ });
    });
    q('.c-side .presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-bg]');
      if (!b) return;
      C.bg = b.dataset.bg;
      el.bg.value = C.bg;
      C.bgPhoto = false; el.bgSolid.checked = true; el.bgPhoto.checked = false;
      scheduleRedraw(true);
    });
    el.shadows.addEventListener('change', () => { C.shadows = el.shadows.checked; scheduleRedraw(true); scheduleColSave(); });
    el.captions.addEventListener('change', () => { C.captions = el.captions.checked; scheduleRedraw(true); scheduleColSave(); });
    el.exportFmt.addEventListener('change', () => scheduleColSave());

    /* canvas toolbar: Select All | Select None | Remove | Set as Background */
    q('#cSelAll').addEventListener('click', selectAll);
    q('#cSelNone').addEventListener('click', selectNone);
    q('#cRemove').addEventListener('click', removeSelected);
    q('#cSetBg').addEventListener('click', setAsBackground);

    /* bottom bar, centered below the stage */
    q('#cScramble').addEventListener('click', scramble);
    q('#cShufflePics').addEventListener('click', shufflePics);
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
      if (!C.imgs.length) { toast('Add photos first', 'err'); return; }
      el.busy.hidden = false;
      try {
        const [W0] = dims();
        const [W, H] = exportDims();
        const c = renderCollage(W, H, W / W0);
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
      C.pos = null; C.order = null; C.sel.clear(); C.hoverI = -1;
      scheduleRedraw(true);
      toast('Back to the automatic Picasa layout', 'ok', 2500);
    });
    el.cClose2.addEventListener('click', close);

    /* Clips: photos from the tray + files straight from the PC */
    el.addPhotos.addEventListener('click', () => { el.fileAdd.click(); });
    el.fileAdd.addEventListener('change', async () => {
      const files = [...el.fileAdd.files];
      el.fileAdd.value = '';
      for (const f of files) await addFileToCollage(f);
    });

    el.cCreate.addEventListener('click', create);
    q('#cClose').addEventListener('click', close);
    el.cBack.addEventListener('click', () => {
      if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
      C.blob = null;
      C.final = false;
      el.resultBar.hidden = true;
      updateUI();
      renderPreview();
      paintOverlay();
    });
    el.cDownload.addEventListener('click', () => {
      if (!C.blob) return;
      const ext = C.blob.type === 'image/png' ? 'png' : 'jpg';
      const a = document.createElement('a');
      a.href = C.url;
      a.download = `collage-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      toast(`Collage downloaded (${ext.toUpperCase()})`, 'ok', 3000);
    });
    el.cSaveDir.addEventListener('click', async () => {
      if (!C.blob) return;
      const dir = state.dirHandle;
      const ext = C.blob.type === 'image/png' ? 'png' : 'jpg';
      const nm = `collage-${Date.now().toString(36)}.${ext}`;
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

    /* keyboard: Delete removes, arrows nudge, ]/[ z-order, Escape clears */
    document.addEventListener('keydown', (e) => {
      if (!C.open || el.root.hidden) return;
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (C.sel.size) { C.sel.clear(); paintOverlay(); } else close();
        return;
      }
      if (finalized()) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      if (e.key === ']') { zOrder(1); return; }
      if (e.key === '[') { zOrder(-1); return; }
      if (C.type !== 'pile' || !C.sel.size) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        C.pos = C.pos || [];
        for (const j of C.sel) {
          const p = getPos(j);
          p.x = clamp(p.x + mv[0], -0.5, 1.5);
          p.y = clamp(p.y + mv[1], -0.5, 1.5);
          C.pos[j] = p;
        }
        scheduleRedraw(true);
      }
    });
  }

  wire();
  wireInteractions();

  window.PixsaCollage = { open, close, openRestored, editCollage, isOpen: () => C.open, syncClips };
})();
