/* SHIVAM PIXSA — collage.js
   Picasa-style collage maker: Picture Pile | Picture Grid | Contact Sheet | Multiple Exposure */
(() => {
  'use strict';
  const P = window.Pixsa;
  if (!P) return;
  const { state, toast, getFile, clamp } = P;

  const q = (s) => document.querySelector(s);
  const el = {
    root: q('#collage'), canvas: q('#cCanvas'), busy: q('#cBusy'), note: q('#cNote'),
    fmt: q('#cFormat'), bg: q('#cBg'), spacingRow: q('#cSpacingRow'), spacing: q('#cSpacing'),
    shuffle: q('#cShuffle'),
    cCreate: q('#cCreate'), cCancel: q('#cCancel'), cSaveDir: q('#cSaveDir'),
    cDownload: q('#cDownload'), cBack: q('#cBack')
  };

  const C = { open: false, list: [], imgs: [], type: 'pile', bg: '#f5f2ec', spacing: 10, seed: 7, blob: null, url: null };

  function dims() {
    switch (el.fmt.value) {
      case '16x9': return [1920, 1080];
      case 'sq': return [1400, 1400];
      case 'a4p': return [1191, 1684];
      default: return [1600, 1200];
    }
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

  function renderCollage(W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = C.bg;
    x.fillRect(0, 0, W, H);
    const n = C.imgs.length;
    if (!n) return c;
    const rand = rng();

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
            drawCover(x, img, px, py, cw, ch);
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
    q('.c-types [data-ct="pile"]').classList.toggle('on', C.type === 'pile');
    q('.c-types [data-ct="grid"]').classList.toggle('on', C.type === 'grid');
    q('.c-types [data-ct="sheet"]').classList.toggle('on', C.type === 'sheet');
    q('.c-types [data-ct="mex"]').classList.toggle('on', C.type === 'mex');
    el.spacingRow.hidden = !(C.type === 'grid' || C.type === 'sheet');
    el.shuffle.hidden = C.type !== 'pile';
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
