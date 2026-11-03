/* SHIVAM PIXA — collage.js  (v3.15.0 "Picasa Picture Collage" engine)
   Free-form Picasa-style picture pile + interactive HTML5-canvas renderer.

   v3.16.0 — collages live in the library: Create Collage saves the result
   into a pinned "Collages" folder group (IndexedDB 'collages' store) and
   double-clicking it reopens the editor with photos + positions for changes,
   exactly like editing a collage again in Picasa.

   v3.15.2 FIX — drag-to-move could die completely on some machines: one
   missed pointerup left a ghost pointer in the pointer map, every later
   press looked like a 2-finger pinch and bailed out. Pointer move/up now
   live on the window (whole gesture always seen) and a mouse press flushes
   stale pointers, so dragging can never get stuck again.

   v3.15.0: the Layout modes were removed (Picasa-style: everything is one
   free pile — place any photo anywhere). Page Format gained a Custom ratio.
   Dragging is Picasa-smooth now: while a photo is being dragged/rotated/
   resized the full collage is NOT re-rendered every frame — a static base
   snapshot is composited on the overlay canvas and only the moved photos
   are redrawn. The rotate / resize handles are clamped inside the canvas
   so they stay reachable when a photo sits on the page edge.

   Interactivity: click = select, drag = move (multi-select),
   wheel = resize, Shift+wheel = rotate, rotation + scale handles, pinch =
   scale+rotate on touch, ]/[ = front/back, Delete = remove.

   Rendering: one paint function renders BOTH the live preview and the
   final export — exportDims() renders at 3840x2160 (screen) or true
   300-DPI print sizes, threaded through a scale factor. */

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
    bg: q('#cBg'),
    shuffle: q('#cShuffle'), border: q('#cBorder'), orient: q('#cOrient'), bgPhoto: q('#cBgPhoto'),
    exportFmt: q('#cExportFmt'),
    cCreate: q('#cCreate'), cCancel: q('#cCancel'), cSaveDir: q('#cSaveDir'),
    cDownload: q('#cDownload'), cBack: q('#cBack'),
    selRow: q('#cSelRow'),
    bFwd: q('#cFwd'), bBack1: q('#cBack1'), bRotL: q('#cRotL'), bRotR: q('#cRotR'),
    bBigger: q('#cBigger'), bSmaller: q('#cSmaller')
  };

  const SLOTTED = ['grid', 'sheet', 'mosaic', 'frame'];
  const DEG = Math.PI / 180;

  const C = {
    open: false, list: [], imgs: [], type: 'pile', bg: '#f5f2ec', seed: 7,
    border: 'white', landscape: true, bgPhoto: false, bgIdx: 0,
    custW: 16, custH: 9,
    alphaAny: false, restored: false,
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
  const custR = () => {
    const w = Math.max(1, C.custW || 16), h = Math.max(1, C.custH || 9);
    return clamp(w / h, 0.2, 5);
  };
  function nativeDims(fmt) {
    switch (fmt) {
      case '16x9': return [1920, 1080];
      case 'sq': return [1400, 1400];
      case '4x6': return [1200, 1800];
      case '5x7': return [1500, 2100];
      case '8x10': return [1600, 2000];
      case '11x14': return [1760, 2240];
      case '16x20': return [2000, 2500];
      case 'a4': return [1191, 1684];
      case 'letter': return [1700, 2200];
      case 'custom': {
        const r = custR();
        return r >= 1 ? [Math.round(1600 * r), 1600] : [1600, Math.round(1600 / r)];
      }
      default: return [1600, 1200]; /* 4x3 */
    }
  }
  function dims() {
    const [W, H] = nativeDims(el.fmt.value);
    return (C.landscape !== (W >= H)) ? [H, W] : [W, H];
  }
  /* hi-res export: screen formats at 3840-wide class, print formats at true
     300 DPI (4x6 = 1800x1200 ... A4 = 2480x3508, Letter = 2550x3300) */
  function exportDims() {
    let W, H;
    switch (el.fmt.value) {
      case '16x9': W = 3840; H = 2160; break;
      case '4x3': W = 3200; H = 2400; break;
      case 'sq': W = 3000; H = 3000; break;
      case '4x6': W = 1800; H = 1200; break;
      case '5x7': W = 2100; H = 1500; break;
      case '8x10': W = 2400; H = 3000; break;
      case '11x14': W = 3300; H = 4200; break;
      case '16x20': W = 4800; H = 6000; break;
      case 'a4': W = 2480; H = 3508; break;
      case 'letter': W = 2550; H = 3300; break;
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
     Returns the geometry so the caller can update the hit-test layout. */
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
    x.save();
    x.translate(b.px, b.py);
    x.rotate(b.rot);
    x.shadowColor = 'rgba(0,0,0,.38)';
    x.shadowBlur = Math.min(W, H) * 0.022;
    x.shadowOffsetY = Math.min(W, H) * 0.008;
    if (C.border === 'none') {
      x.drawImage(b.img, -b.jw / 2, -b.jh / 2, b.jw, b.jh);
    } else {
      const u = Math.min(b.jw, b.jh);
      const pad = C.border === 'polaroid' ? u * 0.05 : u * 0.032;
      const bot = C.border === 'polaroid' ? u * 0.16 : pad;
      x.fillStyle = '#ffffff';
      x.fillRect(-b.jw / 2 - pad, -b.jh / 2 - pad, b.jw + pad * 2, b.jh + pad + bot);
      x.shadowColor = 'transparent';
      x.drawImage(b.img, -b.jw / 2, -b.jh / 2, b.jw, b.jh);
    }
    x.restore();
    return b;
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
    if (C.type === 'pile') {
      paintPile(x, W, H, skip);
    } else {
      paintPile(x, W, H, skip);   /* v3.15.0: one free-form Picasa pile */
    }
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

  /* ================= selection overlay (never exported) ================= */
  function handleSize() { return Math.max(9, el.canvas.width * 0.011); }
  function handlePositions(i) {
    const L = C.layout && C.layout[i];
    if (!L || !L.pile) return null;
    const hs = handleSize(), m = hs * 0.9;
    const hy = -L.jh / 2 - m - hs * 3.2;
    const cos = Math.cos(L.rot), sin = Math.sin(L.rot);
    const sx = L.jw / 2 + m, sy2 = L.jh / 2 + m;
    /* v3.15.0: clamp both handles inside the canvas — on a photo that sits
       against the page edge the rotate lollipop used to be drawn (and hit)
       OFF the canvas, so only resizing seemed possible */
    const pad = hs + 6;
    const cl = (p) => ({
      x: clamp(p.x, pad, el.canvas.width - pad),
      y: clamp(p.y, pad, el.canvas.height - pad)
    });
    return {
      rot: cl({ x: L.px - hy * sin, y: L.py + hy * cos }),
      scale: cl({ x: L.px + sx * cos - sy2 * sin, y: L.py + sx * sin + sy2 * cos })
    };
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
      x.strokeStyle = '#2b7cd3';
      x.setLineDash([lw * 3, lw * 2.4]);
      /* dashed outline drawn WITH the photo's rotation */
      x.translate(L.px, L.py);
      x.rotate(L.rot);
      const m = hs * 0.9;
      if (pile) x.strokeRect(-L.jw / 2 - m, -L.jh / 2 - m, L.jw + m * 2, L.jh + m * 2);
      else x.strokeRect(L.x - lw, L.y - lw, L.w + lw * 2, L.h + lw * 2);
      x.restore();
      x.setLineDash([]);
      if (pile && C.sel.size === 1) {
        /* handles drawn in canvas space, at the SAME clamped positions the
           pointerdown hit-test uses — draw == grab zone, always on-canvas */
        const HP = handlePositions(i);
        if (HP) {
          const a = L.jh / 2 + hs * 0.9;
          const ex = L.px + a * Math.sin(L.rot), ey = L.py - a * Math.cos(L.rot);
          x.beginPath(); x.moveTo(ex, ey); x.lineTo(HP.rot.x, HP.rot.y); x.stroke();
          x.beginPath(); x.arc(HP.rot.x, HP.rot.y, hs, 0, Math.PI * 2);
          x.fillStyle = '#ffffff'; x.fill(); x.stroke();
          x.fillStyle = '#2b7cd3';
          x.fillRect(HP.scale.x - hs / 2, HP.scale.y - hs / 2, hs, hs);
          x.strokeStyle = '#ffffff'; x.lineWidth = lw;
          x.strokeRect(HP.scale.x - hs / 2, HP.scale.y - hs / 2, hs, hs);
        }
      } else if (!pile) {
        x.fillStyle = '#2b7cd3';
        const d = Math.max(3, hs * 0.34);
        for (const [hx, hy] of [[L.x, L.y], [L.x + L.w, L.y], [L.x, L.y + L.h], [L.x + L.w, L.y + L.h]]) {
          x.fillRect(hx - d, hy - d, d * 2, d * 2);
        }
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
  const finalized = () => el.cCreate.hidden;   /* after "Create Collage" the result is final */

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
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) return;
        if (finalized()) { cv.style.cursor = 'default'; return; }
        const hit = C.type === 'pile' ? hitPhoto(pt) : (SLOTTED.includes(C.type) ? hitCell(pt) : -1);
        cv.style.cursor = hit >= 0 ? 'grab' : 'default';
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
        case 'rot': {
          const L = C.layout[drag.i];
          const a = Math.atan2(pt.y - L.py, pt.x - L.px);
          let rot = drag.start.rot + (a - drag.a0);
          const snap90 = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
          if (Math.abs(rot - snap90) < 4 * DEG) rot = snap90;   /* magnetic 0/90/180/270 */
          C.pos = C.pos || [];
          C.pos[drag.i] = { x: drag.start.x, y: drag.start.y, rot, scale: drag.start.scale };
          dragPaint();
          break;
        }
        case 'scale': {
          const L = C.layout[drag.i];
          const d = dist(pt, { x: L.px, y: L.py });
          C.pos = C.pos || [];
          C.pos[drag.i] = { x: drag.start.x, y: drag.start.y, rot: drag.start.rot,
                            scale: clamp(drag.start.scale * d / drag.d0, 0.2, 4) };
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
        /* handles first (single selection) */
        if (C.sel.size === 1) {
          const i = [...C.sel][0];
          const HP = handlePositions(i);
          if (HP) {
            if (dist(pt, HP.rot) <= handleSize() * 1.7) {
              const L = C.layout[i];
              drag = { mode: 'rot', i, a0: Math.atan2(pt.y - L.py, pt.x - L.px), start: getPos(i) };
              buildBase();
              cv.style.cursor = 'grabbing';
              return;
            }
            if (dist(pt, HP.scale) <= handleSize() * 1.7) {
              const L = C.layout[i];
              drag = { mode: 'scale', i, d0: Math.max(6, dist(pt, { x: L.px, y: L.py })), start: getPos(i) };
              buildBase();
              cv.style.cursor = 'grabbing';
              return;
            }
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
        type: 'pile', bg: C.bg, border: C.border,
        landscape: C.landscape, bgPhoto: C.bgPhoto, bgIdx: C.bgIdx, seed: C.seed, fmt: el.fmt.value,
        custW: C.custW, custH: C.custH,
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
        photos, pos: C.pos, seed: C.seed, fmt: el.fmt.value,
        custW: C.custW, custH: C.custH, bg: C.bg, border: C.border,
        landscape: C.landscape, bgPhoto: C.bgPhoto, bgIdx: C.bgIdx,
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
    C.type = 'pile';   /* v3.15.0: one free-form Picasa pile */
    C.bg = proj.bg || '#f5f2ec';
    C.border = proj.border || 'white';
    C.landscape = proj.landscape !== false;
    C.bgPhoto = !!proj.bgPhoto;
    C.bgIdx = proj.bgIdx || 0;
    C.seed = proj.seed || 7;
    C.pos = Array.isArray(proj.pos) ? proj.pos : null;
    C.layout = null; C.order = null; C.sel = new Set();
    C.alphaAny = proj.photos.some((ph) => /\.(png|webp|gif)$/i.test(ph.name || '')) ||
                 proj.photos.some((ph) => ph.blob && ph.blob.type === 'image/png');
    C.custW = (proj.custW && isFinite(proj.custW)) ? proj.custW : 16;
    C.custH = (proj.custH && isFinite(proj.custH)) ? proj.custH : 9;
    el.root.hidden = false;
    el.fmt.value = proj.fmt || '4x3';
    el.custRow.hidden = el.fmt.value !== 'custom';
    el.custW.value = C.custW; el.custH.value = C.custH;
    if (proj.exportFmt) el.exportFmt.value = proj.exportFmt;
    el.bg.value = C.bg; el.border.value = C.border;
    el.bgPhoto.checked = C.bgPhoto;
    el.cCreate.hidden = false; el.cCancel.hidden = false;
    el.cSaveDir.hidden = true; el.cDownload.hidden = !proj.previewBlob; el.cBack.hidden = true;
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
    el.orient.textContent = 'Orientation: ' + (C.landscape ? 'Landscape' : 'Portrait');
    for (const b of [el.bFwd, el.bBack1, el.bRotL, el.bRotR, el.bBigger, el.bSmaller]) b.disabled = false;
    el.toolInfo.textContent = 'Click to select \u2022 drag to move \u2022 wheel resizes \u2022 Shift+wheel rotates \u2022 ] front \u2022 [ back';
    noteCount();
    if (C.noteBase) {
      el.note.textContent = C.noteBase +
        ' \u2022 Drag to move \u2014 wheel resizes, Shift+wheel rotates, handles appear when selected';
    }
  }

  async function open(list) {
    if (!list || !list.length) return;
    C.list = list.slice(0, 40);
    C.open = true;
    C.blob = null;
    C.restored = false;
    C.type = 'pile';
    C.pos = null; C.layout = null; C.order = null; C.sel = new Set();
    C.editId = null; C.editName = '';   /* v3.16.0: a fresh collage is a new record */
    C.bgIdx = 0;
    endGesture(); clearTimeout(wheelT);
    if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
    el.root.hidden = false;
    el.custRow.hidden = el.fmt.value !== 'custom';
    el.cCreate.hidden = false; el.cCancel.hidden = false;
    el.cSaveDir.hidden = true; el.cDownload.hidden = true; el.cBack.hidden = true;
    C.noteBase = `${C.list.length} ${C.list.length === 1 ? 'photo used' : 'photos used'}${list.length > 40 ? ' (first 40)' : ''}`;
    updateUI();
    await loadImgs();
    noteCount();
    renderPreview();
    paintOverlay();
    scheduleColSave();
  }
  function close() {
    C.open = false;
    el.root.hidden = true;
    C.sel.clear();
    C.editId = null; C.editName = '';
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
      el.cCreate.hidden = true; el.cCancel.hidden = true;
      el.cSaveDir.hidden = false; el.cDownload.hidden = false; el.cBack.hidden = false;
      el.note.textContent = `Collage ready — ${W} \u00D7 ${H}px (${C.blob.type === 'image/png' ? 'PNG' : 'JPEG'}) — saved to the Collages folder`;
      saveCollage();
    } finally {
      el.busy.hidden = true;
    }
  }

  function wire() {
    el.fmt.addEventListener('change', () => {
      el.custRow.hidden = el.fmt.value !== 'custom';
      scheduleRedraw(true);
    });
    el.custApply.addEventListener('click', () => {
      const w = parseFloat(el.custW.value), h = parseFloat(el.custH.value);
      if (!(w > 0) || !(h > 0)) { toast('Ratio needs two numbers bigger than 0', 'err'); return; }
      C.custW = clamp(w, 0.2, 60); C.custH = clamp(h, 0.2, 60);
      scheduleRedraw(true);
      scheduleColSave();
    });
    el.bg.addEventListener('input', () => { C.bg = el.bg.value; scheduleRedraw(true); });
    q('.presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-bg]');
      if (!b) return;
      C.bg = b.dataset.bg;
      el.bg.value = C.bg;
      scheduleRedraw(true);
    });
    el.shuffle.addEventListener('click', scramble);
    el.border.addEventListener('change', () => { C.border = el.border.value; scheduleRedraw(true); });
    el.orient.addEventListener('click', () => { C.landscape = !C.landscape; updateUI(); scheduleRedraw(true); });
    el.bgPhoto.addEventListener('change', () => { C.bgPhoto = el.bgPhoto.checked; scheduleRedraw(true); });
    el.exportFmt.addEventListener('change', () => scheduleColSave());

    /* top photo toolbar */
    q('#cSelAll').addEventListener('click', selectAll);
    q('#cSelNone').addEventListener('click', selectNone);
    q('#cRemove').addEventListener('click', removeSelected);
    q('#cSetBg').addEventListener('click', setAsBackground);

    /* selected-photo controls */
    el.bFwd.addEventListener('click', () => zOrder(1));
    el.bBack1.addEventListener('click', () => zOrder(-1));
    el.bRotL.addEventListener('click', () => rotateSel(-1));
    el.bRotR.addEventListener('click', () => rotateSel(1));
    el.bBigger.addEventListener('click', () => scaleSel(1.12));
    el.bSmaller.addEventListener('click', () => scaleSel(1 / 1.12));

    /* bottom Picasa bar */
    q('#cScramble').addEventListener('click', scramble);
    q('#cShufflePics').addEventListener('click', shufflePics);
    q('#cViewEdit').addEventListener('click', viewAndEdit);

    el.cCreate.addEventListener('click', create);
    el.cCancel.addEventListener('click', close);
    q('#cClose').addEventListener('click', close);
    q('#cBackTop').addEventListener('click', close);
    el.cBack.addEventListener('click', () => {
      if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
      C.blob = null;
      el.cCreate.hidden = false; el.cCancel.hidden = false;
      el.cSaveDir.hidden = true; el.cDownload.hidden = true; el.cBack.hidden = true;
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

  window.PixsaCollage = { open, close, openRestored, editCollage, isOpen: () => C.open };
})();
