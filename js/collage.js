/* SHIVAM PIXSA — collage.js
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
              border: 'white', landscape: true, bgPhoto: false };

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
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const rows = Math.max(1, Math.ceil(n / cols));
      const cw = W / cols, ch = H / rows;
      const bor = Math.min(W, H) * 0.012;
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols && i < n; col++, i++) {
          const img = C.imgs[i];
          const jw = cw * (0.98 + rand() * 0.3);
          const jh = jw * (img.height / img.width);
          if (jh > ch * 1.45) { }
          const px = col * cw + cw / 2 + (rand() - 0.5) * cw * 0.3;
          const py = r * ch + ch / 2 + (rand() - 0.5) * ch * 0.3;
          const rot = (rand() - 0.5) * 0.3;
          x.save();
          x.translate(px, py);
          x.rotate(rot);
          x.shadowColor = 'rgba(0,0,0,.38)';
          x.shadowBlur = Math.min(W, H) * 0.02;
          x.shadowOffsetY = Math.min(W, H) * 0.008;
          x.fillStyle = '#ffffff';
          x.fillRect(-jw / 2 - bor, -jh / 2 - bor, jw + bor * 2, jh + bor * 2);
          x.shadowColor = 'transparent';
          x.drawImage(img, -jw / 2, -jh / 2, jw, jh);
          x.restore();
        }
      }
    } else if (C.type === 'mosaic') {
      /* brick-pattern mosaic: har row photos ke aspect se fill hoti hai */
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
      /* frame mosaic: center me featured photo, charo taraf border grid */
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
  }

  async function open(list) {
    if (!list || !list.length) return;
    C.list = list.slice(0, 40);
    C.open = true;
    C.blob = null;
    if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
    el.root.hidden = false;
    el.cCreate.hidden = false; el.cCancel.hidden = false;
    el.cSaveDir.hidden = true; el.cDownload.hidden = true; el.cBack.hidden = true;
    el.note.textContent = `${C.list.length} ${C.list.length === 1 ? 'photo use hogi' : 'photos use hongi'}${list.length > 40 ? ' (pehli 40)' : ''}. Zyada photos chahiye to pehle Photo Tray me select karo.`;
    updateUI();
    await loadImgs();
    renderPreview();
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
    C.blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    el.busy.hidden = true;
    if (!C.blob) { toast('Collage ban nahi paya — dobara try karo', 'err'); return; }
    if (C.url) URL.revokeObjectURL(C.url);
    C.url = URL.createObjectURL(C.blob);
    el.canvas.width = c.width; el.canvas.height = c.height;
    el.canvas.getContext('2d').drawImage(c, 0, 0);
    el.cCreate.hidden = true; el.cCancel.hidden = true;
    el.cSaveDir.hidden = false; el.cDownload.hidden = false; el.cBack.hidden = false;
    el.note.textContent = `Collage ready hai (${W} \u00D7 ${H}px). Save karo ya download karo.`;
  }

  function wire() {
    q('.c-types').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ct]');
      if (!b) return;
      C.type = b.dataset.ct;
      updateUI();
      renderPreview();
    });
    el.fmt.addEventListener('change', renderPreview);
    el.bg.addEventListener('input', () => { C.bg = el.bg.value; renderPreview(); });
    q('.presets').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-bg]');
      if (!b) return;
      C.bg = b.dataset.bg;
      el.bg.value = C.bg;
      renderPreview();
    });
    el.spacing.addEventListener('input', () => { C.spacing = +el.spacing.value; renderPreview(); });
    el.shuffle.addEventListener('click', () => { C.seed = (Math.random() * 2147483646) | 0; renderPreview(); });
    el.border.addEventListener('change', () => { C.border = el.border.value; renderPreview(); });
    el.orient.addEventListener('click', () => { C.landscape = !C.landscape; updateUI(); renderPreview(); });
    el.bgPhoto.addEventListener('change', () => { C.bgPhoto = el.bgPhoto.checked; renderPreview(); });
    el.cCreate.addEventListener('click', create);
    el.cCancel.addEventListener('click', close);
    q('#cClose').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.root.hidden) close();
    });
    el.cBack.addEventListener('click', () => {
      if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
      C.blob = null;
      el.cCreate.hidden = false; el.cCancel.hidden = false;
      el.cSaveDir.hidden = true; el.cDownload.hidden = true; el.cBack.hidden = true;
      renderPreview();
    });
    el.cDownload.addEventListener('click', () => {
      if (!C.blob) return;
      const a = document.createElement('a');
      a.href = C.url;
      a.download = `collage-${new Date().toISOString().slice(0, 10)}.jpg`;
      a.click();
      toast('Collage download ho gaya', 'ok', 3000);
    });
    el.cSaveDir.addEventListener('click', async () => {
      if (!C.blob) return;
      const dir = state.dirHandle;
      const nm = `collage-${Date.now().toString(36)}.jpg`;
      if (dir && await P.saveBlobToDir(dir, nm, C.blob)) {
        toast(`Collage folder me save hua: ${nm}`, 'ok', 4000);
        close();
        P.loadFolder(dir, true);
      } else {
        const a = document.createElement('a');
        a.href = C.url;
        a.download = nm;
        a.click();
        toast('Folder access nahi tha — collage download kar diya', 'ok', 4000);
        close();
      }
    });
  }
  wire();

  window.PixsaCollage = { open, close, isOpen: () => C.open };
})();
