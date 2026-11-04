/* SHIVAM PIXA — bgstudio.js (v3.22.0)
   Background Studio — professional product backdrops, rendered on-device.

   Why it exists: marketplace product photos need a professional background,
   but real AI image generation is paid / cloud-only / rate-limited. Every
   backdrop here is generated procedurally from seeded noise on the user's
   own device — so the supply is UNLIMITED (not 200–300 a day), instant,
   100% offline, and free forever. All textures are sampled in 0..1 space,
   so the 128 px thumbnail and the 1600 px final show the exact same pattern.

   1. 15 Studio backdrops — Pure White (marketplace standard), Studio Sweep,
      Ivory / Blush / Sage pastel sweeps, Black Luxe + Royal Blue, Marble,
      Walnut, Linen, Concrete textures, Podium display scene, Gold Festive
      bokeh, Rose Silk, Two-Tone Pastel. "Shuffle Pattern" reseeds the
      current one → a fresh variation every tap.
   2. AI Scene (Beta, optional) — one free keyless cloud endpoint
      (Pollinations) for real AI-generated scenes. Clearly labelled as
      needing internet; the offline studio never depends on it. Failures
      degrade gracefully with a clear message.
   3. Product placement — the product (or the whole photo) is auto-centred
      with an 8% margin, user Size 55–130% and Position nudge, plus a soft
      blurred drop shadow (only when the photo actually has transparency).
   4. Output sizes — Original, 1:1 1600 (Amazon/Flipkart/Meesho), 1:1 2000,
      4:5 1080×1350 (Instagram), 3:4 1200×1600, 9:16 story. The committed
      result REPLACES the canvas size, so export gives exactly those pixels.
   5. QA — zoomable preview (Fit / 100% / wheel zoom / drag pan) and a
      hold-to-compare Before button. Non-destructive: committed as an
      undoable 'cutout' op (same sticker pipeline as v3.21.0).

   Exposes window.PixsaBGStudio = { open, close, isOpen } and works on top
   of the editor (window.PixsaEditor.cutoutSource / commitCutout). */
(() => {
  'use strict';
  const FX = window.PixsaFX;
  if (!FX) return;
  const q = (s) => document.querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  /* two rAFs give the spinner one painted frame; the timeout is a safety
     net for throttled pages (background tab / occluded window), where rAF
     never fires and the busy overlay would otherwise hang forever */
  const raf2 = () => new Promise((r) => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(() => requestAnimationFrame(fin));
    setTimeout(fin, 130);
  });
  const MAXPX = 24e6;

  /* ================= seeded RNG + resolution-independent noise ========== */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNoise(R, cells) {
    const N = 64, g = new Float32Array((N + 1) * (N + 1));
    for (let i = 0; i < g.length; i++) g[i] = R();
    const p = Math.max(1, cells);
    const sm = (t) => t * t * (3 - 2 * t);
    return (u, v) => {
      let x = u * p, y = v * p;
      x = ((x % N) + N) % N; y = ((y % N) + N) % N;
      const xi = x | 0, yi = y | 0, xf = x - xi, yf = y - yi;
      const a = g[yi * (N + 1) + xi], b = g[yi * (N + 1) + xi + 1];
      const c = g[(yi + 1) * (N + 1) + xi], d = g[(yi + 1) * (N + 1) + xi + 1];
      const sx = sm(xf), sy = sm(yf);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  function fbm3(R, cells) {
    const n1 = makeNoise(R, cells), n2 = makeNoise(R, cells * 2.13), n3 = makeNoise(R, cells * 4.31);
    return (u, v) => n1(u, v) * 0.55 + n2(u, v) * 0.3 + n3(u, v) * 0.15;
  }
  const mix = (a, b, t) => a + (b - a) * t;
  const mixc = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
  const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const vgrad = (cx, w, h, c1, c2) => {
    const g = cx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgb(c1)); g.addColorStop(1, rgb(c2));
    cx.fillStyle = g; cx.fillRect(0, 0, w, h);
  };
  const rglight = (cx, w, h, gx, gy, r0, inner, outer) => {
    const g = cx.createRadialGradient(gx * w, gy * h, 0, gx * w, gy * h, Math.max(w, h) * r0);
    g.addColorStop(0, rgb(inner)); g.addColorStop(1, rgb(outer));
    cx.fillStyle = g; cx.fillRect(0, 0, w, h);
  };
  function pixelLayer(cx, w, h, fn) {
    const img = cx.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const c = fn(u, v);
        const p = (y * w + x) * 4;
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
  }

  /* ================= the studio backdrops =============================== */
  const sweepFn = (wall, floor, glow) => (cx, w, h) => {
    vgrad(cx, w, h, wall, floor);
    rglight(cx, w, h, 0.5, 0.4, 0.62, glow, wall);
    const g = cx.createLinearGradient(0, h * 0.66, 0, h);
    g.addColorStop(0, 'rgba(90,88,80,0)'); g.addColorStop(1, 'rgba(90,88,80,0.26)');
    cx.fillStyle = g; cx.fillRect(0, 0, w, h);
  };
  const BACKDROPS = [
    { id: 'white', name: 'Pure White', hint: 'Amazon / Flipkart / Meesho standard', fn(cx, w, h) { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, h); } },
    { id: 'sweep', name: 'Studio Sweep', hint: 'Classic grey infinity cove', fn: sweepFn([246, 246, 244], [210, 209, 203], [255, 255, 255]) },
    { id: 'ivory', name: 'Ivory Soft', hint: 'Warm cream sweep', fn: sweepFn([250, 244, 232], [219, 203, 176], [255, 252, 244]) },
    { id: 'blush', name: 'Blush Studio', hint: 'Soft pink — cosmetics', fn: sweepFn([251, 236, 236], [230, 198, 198], [255, 246, 246]) },
    { id: 'sage', name: 'Sage Calm', hint: 'Green pastel sweep', fn: sweepFn([238, 244, 235], [188, 208, 182], [250, 253, 248]) },
    { id: 'noir', name: 'Black Luxe', hint: 'Spotlight on black — gold jewelry', fn(cx, w, h) {
        cx.fillStyle = '#0b0b0d'; cx.fillRect(0, 0, w, h);
        rglight(cx, w, h, 0.5, 0.42, 0.52, [62, 62, 70], [11, 11, 13]);
      } },
    { id: 'royal', name: 'Royal Blue', hint: 'Deep blue with sheen', fn(cx, w, h) {
        vgrad(cx, w, h, [47, 76, 128], [15, 25, 46]);
        rglight(cx, w, h, 0.5, 0.32, 0.6, [96, 128, 186], [47, 76, 128]);
      } },
    { id: 'marble', name: 'White Marble', hint: 'Veined marble slab', fn(cx, w, h, R) {
        const f = fbm3(R, 3.1), v1 = makeNoise(R, 5.5);
        pixelLayer(cx, w, h, (u, v) => {
          const warp = f(u * 0.9, v * 0.9);
          const s = Math.sin((u * 1.7 + warp * 0.85 + v * 0.4) * Math.PI * 3.2);
          let c = mixc([247, 246, 243], [227, 225, 220], f(u * 2.3, v * 2.3) * 0.85);
          const vein = Math.pow(1 - Math.abs(s), 16) * (0.4 + 0.45 * v1(u, v));
          return mixc(c, [118, 118, 125], clamp(vein, 0, 1));
        });
      } },
    { id: 'walnut', name: 'Walnut Wood', hint: 'Planked wood table', fn(cx, w, h, R) {
        const g1 = makeNoise(R, 2.4), g2 = makeNoise(R, 8.5);
        pixelLayer(cx, w, h, (u, v) => {
          const planks = 4, pv = v * planks, row = Math.min(planks - 1, pv | 0);
          const fr = pv - row;
          const base = row % 2 ? [117, 78, 47] : [128, 87, 53];
          const grain = g1(u * 1.1, v * 20) * 0.6 + g2(u * 1.6, v * 34) * 0.4;
          let c = mixc(base, [88, 56, 32], grain * 0.55);
          c = mixc(c, [70, 44, 25], Math.pow(Math.abs(Math.sin(u * 34 + grain * 5)), 8) * 0.22);
          const seam = Math.min(fr, 1 - fr);
          if (seam < 0.022) c = mixc(c, [56, 34, 18], 1 - seam / 0.022);
          return c;
        });
      } },
    { id: 'linen', name: 'Linen Natural', hint: 'Woven fabric texture', fn(cx, w, h, R) {
        const f = fbm3(R, 6), th = 150;
        pixelLayer(cx, w, h, (u, v) => {
          const weave = Math.sin(u * Math.PI * th) * Math.sin(v * Math.PI * th);
          let c = mixc([233, 223, 204], [215, 202, 180], f(u, v) * 0.8);
          const k = 1 + weave * 0.045;
          return [c[0] * k, c[1] * k, c[2] * k];
        });
      } },
    { id: 'concrete', name: 'Concrete Slate', hint: 'Fine grey stone', fn(cx, w, h, R) {
        const f = fbm3(R, 4.5);
        pixelLayer(cx, w, h, (u, v) => {
          let c = mixc([179, 181, 184], [146, 149, 154], f(u, v));
          const d = Math.hypot(u - 0.5, (v - 0.5) * 0.9);
          const vg = clamp((d - 0.42) * 1.4, 0, 0.25);
          return mixc(c, [112, 115, 120], vg);
        });
      } },
    { id: 'podium', name: 'Podium Display', hint: 'Cylinder pedestal scene', fn(cx, w, h, R) {
        const tones = [[235, 226, 218], [228, 232, 222], [232, 224, 230], [224, 228, 230]];
        const wall = tones[(R() * tones.length) | 0];
        vgrad(cx, w, h, mixc(wall, [255, 255, 255], 0.4), wall);
        rglight(cx, w, h, 0.5, 0.4, 0.5, mixc(wall, [255, 255, 255], 0.55), wall);
        const fl = cx.createLinearGradient(0, h * 0.74, 0, h);
        fl.addColorStop(0, rgb(mixc(wall, [255, 255, 255], 0.12)));
        fl.addColorStop(1, rgb(mixc(wall, [140, 132, 124], 0.42)));
        cx.fillStyle = fl; cx.fillRect(0, h * 0.74, w, h * 0.26);
        const prx = w * 0.5, ptw = w * 0.30, pty = h * 0.40, pbh = h * 0.38;
        cx.save();
        cx.filter = `blur(${Math.max(2, w * 0.012)}px)`;
        cx.fillStyle = 'rgba(60,55,50,0.30)';
        cx.beginPath();
        cx.ellipse(prx + w * 0.004, pty + pbh + h * 0.012, ptw * 0.62, h * 0.026, 0, 0, Math.PI * 2);
        cx.fill();
        cx.restore();
        const body = cx.createLinearGradient(prx - ptw / 2, 0, prx + ptw / 2, 0);
        body.addColorStop(0, rgb(mixc(wall, [120, 112, 104], 0.5)));
        body.addColorStop(0.18, rgb(mixc(wall, [255, 255, 255], 0.5)));
        body.addColorStop(0.55, rgb(mixc(wall, [255, 255, 255], 0.28)));
        body.addColorStop(1, rgb(mixc(wall, [110, 102, 95], 0.55)));
        cx.fillStyle = body;
        cx.fillRect(prx - ptw / 2, pty, ptw, pbh);
        cx.fillStyle = rgb(mixc(wall, [255, 255, 255], 0.62));
        cx.beginPath();
        cx.ellipse(prx, pty, ptw / 2, h * 0.032, 0, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle = 'rgba(255,255,255,0.35)';
        cx.beginPath();
        cx.ellipse(prx, pty + pbh, ptw / 2, h * 0.02, 0, 0, Math.PI * 2);
        cx.fill();
      } },
    { id: 'festive', name: 'Gold Festive', hint: 'Golden bokeh — jewelry', fn(cx, w, h, R) {
        cx.fillStyle = '#1a120b'; cx.fillRect(0, 0, w, h);
        rglight(cx, w, h, 0.5, 0.44, 0.55, [84, 58, 28], [26, 18, 11]);
        for (let i = 0; i < 46; i++) {
          const bx = R() * w, by = R() * h, br = (0.015 + R() * 0.055) * Math.min(w, h);
          const warm = R();
          const col = [225 + warm * 30, 172 + warm * 45, 62 + warm * 55];
          const g = cx.createRadialGradient(bx, by, 0, bx, by, br);
          g.addColorStop(0, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${0.10 + R() * 0.20})`);
          g.addColorStop(0.7, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},0.05)`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          cx.fillStyle = g;
          cx.beginPath(); cx.arc(bx, by, br, 0, Math.PI * 2); cx.fill();
        }
        for (let i = 0; i < 60; i++) {
          cx.fillStyle = `rgba(255,232,170,${0.25 + R() * 0.5})`;
          cx.fillRect(R() * w, R() * h, 1.2, 1.2);
        }
      } },
    { id: 'silk', name: 'Rose Silk', hint: 'Flowing fabric waves', fn(cx, w, h, R) {
        const f = fbm3(R, 2.6);
        pixelLayer(cx, w, h, (u, v) => {
          const s1 = Math.sin((v * 2.6 + u * 1.1 + f(u, v) * 1.6) * Math.PI * 2);
          const s2 = Math.sin((v * 4.4 - u * 0.6 + f(u * 1.4, v) * 1.2) * Math.PI * 2);
          const shade = clamp(0.5 + 0.34 * s1 + 0.16 * s2, 0, 1);
          return mixc([209, 146, 158], [244, 216, 222], shade);
        });
      } },
    { id: 'duo', name: 'Two-Tone Pastel', hint: 'Soft diagonal blend', fn(cx, w, h, R) {
        const pairs = [
          [[199, 231, 214], [206, 199, 236]],
          [[250, 224, 208], [248, 214, 229]],
          [[214, 232, 248], [232, 221, 245]],
          [[248, 238, 202], [204, 230, 219]]
        ];
        const pr = pairs[(R() * pairs.length) | 0];
        const g = cx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, rgb(pr[0])); g.addColorStop(1, rgb(pr[1]));
        cx.fillStyle = g; cx.fillRect(0, 0, w, h);
        rglight(cx, w, h, 0.3, 0.24, 0.5, [255, 255, 255], pr[0]);
        cx.fillStyle = 'rgba(255,255,255,0.14)'; cx.fillRect(0, 0, w, h);
      } }
  ];
  const BYID = {};
  BACKDROPS.forEach((b, i) => { BYID[b.id] = b; b.thumbSeed = 9871 + i * 7919; });

  /* ================= state ============================================== */
  const S = {
    open: false, src: null, prodCv: null, bw: 0, bh: 0, hasAlpha: false,
    backdrop: 'sweep', seeds: {}, aiImg: null, aiPrompt: null,
    scale: 100, vshift: 0, shadow: true, shadowA: 0.3,
    view: { sc: 1, x: 0, y: 0 }, busy: false, holding: false, drag: null
  };
  const el = {};
  const stat = (t) => { if (el.bsStat) el.bsStat.textContent = t || ''; };
  const currentName = () => (S.aiImg ? 'AI Scene' : (BYID[S.backdrop] ? BYID[S.backdrop].name : 'Backdrop'));

  /* ================= product prep (auto-centre) ========================= */
  function prepProduct() {
    const W = S.src.width, H = S.src.height;
    const d = S.src.getContext('2d').getImageData(0, 0, W, H).data;
    let hasAlpha = false, minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const a = d[(row + x) * 4 + 3];
        if (a < 250) hasAlpha = true;
        if (a > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    S.hasAlpha = hasAlpha;
    let bx, by, bw, bh;
    if (!hasAlpha || maxX < 0) { bx = 0; by = 0; bw = W; bh = H; }
    else {
      minX = Math.max(0, minX - 2); minY = Math.max(0, minY - 2);
      maxX = Math.min(W - 1, maxX + 2); maxY = Math.min(H - 1, maxY + 2);
      bx = minX; by = minY; bw = maxX - minX + 1; bh = maxY - minY + 1;
    }
    const pc = FX.mkCanvas(bw, bh);
    pc.getContext('2d').drawImage(S.src, bx, by, bw, bh, 0, 0, bw, bh);
    S.prodCv = pc; S.bw = bw; S.bh = bh;
    el.bsShadowRow.style.opacity = hasAlpha ? '1' : '.45';
    el.bsShadowTR.style.opacity = hasAlpha ? '1' : '.45';
    el.bsShadow.disabled = !hasAlpha;
  }

  /* ================= backdrops / composition ============================ */
  function drawAiCover(cx, w, h) {
    const iw = S.aiImg.width, ih = S.aiImg.height;
    const k = Math.max(w / iw, h / ih);
    const dw = iw * k, dh = ih * k;
    cx.drawImage(S.aiImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  function drawBackdrop(cx, w, h) {
    if (S.aiImg) { drawAiCover(cx, w, h); return; }
    const b = BYID[S.backdrop] || BACKDROPS[1];
    b.fn(cx, w, h, mulberry32(S.seeds[S.backdrop] || 1));
  }
  function outDims() {
    switch (el.bsOut.value) {
      case 'sq1600': return [1600, 1600];
      case 'sq2000': return [2000, 2000];
      case 'post45': return [1080, 1350];
      case 'cat34': return [1200, 1600];
      case 'story916': return [1080, 1920];
      default: return [S.src.width, S.src.height];
    }
  }
  function compose(tw, th) {
    const out = FX.mkCanvas(tw, th);
    const ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high';
    drawBackdrop(ox, tw, th);
    if (S.prodCv) {
      const fit = Math.min(tw * 0.84 / S.bw, th * 0.84 / S.bh) * (S.scale / 100);
      const pw = S.bw * fit, ph = S.bh * fit;
      const px = (tw - pw) / 2;
      const py = (th - ph) / 2 + (S.vshift / 100) * ((th - ph) / 2);
      if (S.shadow && S.hasAlpha && !S.holding) {
        const sil = FX.mkCanvas(S.bw, S.bh);
        const sx = sil.getContext('2d');
        sx.drawImage(S.prodCv, 0, 0);
        sx.globalCompositeOperation = 'source-in';
        sx.fillStyle = '#000';
        sx.fillRect(0, 0, S.bw, S.bh);
        ox.save();
        ox.filter = `blur(${Math.max(3, Math.round(Math.min(tw, th) * 0.012))}px)`;
        ox.globalAlpha = S.shadowA;
        ox.drawImage(sil, px + tw * 0.005, py + th * 0.014, pw, ph);
        ox.restore();
      }
      ox.drawImage(S.prodCv, px, py, pw, ph);
    }
    return out;
  }

  /* ================= preview + view ===================================== */
  function renderPreview() {
    const [tw, th] = outDims();
    el.bsCv.width = tw; el.bsCv.height = th;
    const cx = el.bsCv.getContext('2d');
    cx.clearRect(0, 0, tw, th);
    if (S.holding) {
      cx.fillStyle = '#26282c'; cx.fillRect(0, 0, tw, th);
      const k = Math.min(tw / S.src.width, th / S.src.height);
      const w = S.src.width * k, h = S.src.height * k;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(S.src, (tw - w) / 2, (th - h) / 2, w, h);
    } else {
      cx.drawImage(compose(tw, th), 0, 0);
      stat(`${currentName()} \u2022 ${tw} \u00d7 ${th} \u2022 ${S.aiImg ? 'AI scene (internet)' : 'offline \u2014 unlimited'}`);
    }
  }
  let schedT = null;
  function renderSoon() {
    clearTimeout(schedT);
    schedT = setTimeout(() => refresh(true), 150);
  }
  async function refresh(withBusy) {
    if (!S.open || S.busy) return;
    if (withBusy) { S.busy = true; el.bsBusy.hidden = false; await raf2(); }
    try { renderPreview(); } finally {
      if (withBusy) { el.bsBusy.hidden = true; S.busy = false; }
    }
  }
  function applyView() {
    el.bsWrap.style.transform = `translate(${S.view.x}px, ${S.view.y}px) scale(${S.view.sc})`;
  }
  function fitView() {
    const r = el.bsStage.getBoundingClientRect();
    const [tw, th] = outDims();
    const sc = Math.min((r.width - 48) / tw, (r.height - 48) / th, 1);
    S.view.sc = Math.max(0.02, sc);
    S.view.x = (r.width - tw * S.view.sc) / 2;
    S.view.y = (r.height - th * S.view.sc) / 2;
    applyView();
  }
  function zoom100() {
    const r = el.bsStage.getBoundingClientRect();
    const [tw, th] = outDims();
    S.view.sc = 1;
    S.view.x = (r.width - tw) / 2;
    S.view.y = (r.height - th) / 2;
    applyView();
  }

  /* ================= AI Scene (Beta — optional, online) ================= */
  async function genAI(prompt) {
    if (S.busy || !S.open) return;
    prompt = (prompt || '').trim();
    if (!prompt) { stat('Describe the background first — or tap a preset above'); return; }
    if (!navigator.onLine) { stat('AI Scene needs internet — you are offline. Studio backdrops always work.'); return; }
    S.busy = true; el.bsBusy.hidden = false;
    stat('Generating the AI scene\u2026 (5\u201320 s, needs internet)');
    const seed = (Math.random() * 1e9) | 0;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=1280&nologo=true&model=flux&seed=${seed}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    try {
      const res = await fetch(url, { signal: ctl.signal, mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      S.aiImg = bmp; S.aiPrompt = prompt;
      el.bsPrompt.value = prompt;
      document.querySelectorAll('.bs-chips button').forEach((c) =>
        c.classList.toggle('on', c.dataset.ai === prompt));
      document.querySelectorAll('.bs-thumb').forEach((b) => b.classList.remove('on'));
      S.busy = false; el.bsBusy.hidden = true;
      await refresh(true);
    } catch (err) {
      stat('AI Scene failed — check internet and try again. Studio backdrops always work offline.');
    } finally {
      clearTimeout(timer);
      el.bsBusy.hidden = true; S.busy = false;
    }
  }
  function selectBackdrop(id) {
    S.aiImg = null; S.aiPrompt = null;
    document.querySelectorAll('.bs-chips button').forEach((c) => c.classList.remove('on'));
    S.backdrop = id;
    document.querySelectorAll('.bs-thumb').forEach((b) =>
      b.classList.toggle('on', b.dataset.bg === id));
    renderSoon();
  }
  function shuffle() {
    if (S.aiImg && S.aiPrompt) { genAI(S.aiPrompt); return; }
    S.seeds[S.backdrop] = (Math.random() * 1e9) | 0;
    const tb = document.querySelector(`.bs-thumb[data-bg="${S.backdrop}"] canvas`);
    const b = BYID[S.backdrop];
    if (tb && b) {
      tb.width = 128; tb.height = 128;
      b.fn(tb.getContext('2d'), 128, 128, mulberry32(S.seeds[S.backdrop]));
    }
    renderSoon();
  }

  /* ================= thumbnails ========================================= */
  function paintThumb(cv, b, seed) {
    cv.width = 128; cv.height = 128;
    const cx = cv.getContext('2d');
    try { b.fn(cx, 128, 128, mulberry32(seed)); } catch (e) {
      cx.fillStyle = '#ddd'; cx.fillRect(0, 0, 128, 128);
    }
  }
  function buildGrid() {
    el.bsGrid.innerHTML = '';
    for (const b of BACKDROPS) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'bs-thumb'; btn.dataset.bg = b.id;
      btn.title = `${b.name}${b.hint ? ' — ' + b.hint : ''}`;
      const cv = document.createElement('canvas');
      paintThumb(cv, b, b.thumbSeed);
      const sp = document.createElement('span');
      sp.textContent = b.name;
      btn.appendChild(cv); btn.appendChild(sp);
      btn.addEventListener('click', () => selectBackdrop(b.id));
      el.bsGrid.appendChild(btn);
    }
  }

  /* ================= open / close / apply =============================== */
  async function open() {
    const ed = window.PixsaEditor;
    if (!ed || !ed.isOpen() || S.open) return;
    S.open = true;
    el.root.hidden = false;
    el.bsBusy.hidden = false;
    stat('Preparing the photo\u2026');
    await raf2();
    let src = null;
    try { src = ed.cutoutSource(); } catch (e) { src = null; }
    if (!src || !src.width) { el.bsBusy.hidden = true; close(); return; }
    if (src.width * src.height > MAXPX) {
      const k = Math.sqrt(MAXPX / (src.width * src.height));
      const sc2 = FX.mkCanvas(src.width * k, src.height * k);
      const c2 = sc2.getContext('2d');
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(src, 0, 0, sc2.width, sc2.height);
      src = sc2;
    }
    S.src = src;
    S.seeds = {};
    BACKDROPS.forEach((b, i) => { S.seeds[b.id] = ((Math.random() * 1e9) | 0) || (9871 + i * 7919); });
    S.aiImg = null; S.aiPrompt = null;
    S.scale = 100; S.vshift = 0; S.shadow = true; S.shadowA = 0.3;
    el.bsSize.value = 100; el.bsSizeV.textContent = '100';
    el.bsShift.value = 0; el.bsShiftV.textContent = '0';
    el.bsShadow.checked = true;
    el.bsShadowA.value = 30; el.bsShadowAV.textContent = '30';
    el.bsOut.value = 'orig';
    S.holding = false; S.drag = null;
    try { prepProduct(); } catch (e) { el.bsBusy.hidden = true; close(); return; }
    document.querySelectorAll('.bs-chips button').forEach((c) => c.classList.remove('on'));
    S.backdrop = 'sweep';
    document.querySelectorAll('.bs-thumb').forEach((b) =>
      b.classList.toggle('on', b.dataset.bg === 'sweep'));
    await refresh(true);
    fitView();
  }
  function close() {
    S.open = false;
    el.root.hidden = true;
    S.src = null; S.prodCv = null; S.aiImg = null; S.aiPrompt = null;
    S.drag = null; S.holding = false;
    clearTimeout(schedT);
  }
  async function apply() {
    if (!S.open || S.busy) return;
    S.busy = true; el.bsBusy.hidden = false;
    stat('Rendering the final background\u2026');
    await raf2();
    try {
      const [tw, th] = outDims();
      const cv = compose(tw, th);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) { stat('Could not create the result — try again'); return; }
      const ok = await window.PixsaEditor.commitCutout(blob);
      if (ok) close();
      else stat('The photo changed — reopen Background Studio');
    } finally {
      el.bsBusy.hidden = true; S.busy = false;
    }
  }

  /* ================= wiring ============================================= */
  function init() {
    el.root = q('#bgstudio');
    if (!el.root || el.root.dataset.wired) return;
    el.root.dataset.wired = '1';
    el.bsStage = q('#bsStage'); el.bsWrap = q('#bsWrap');
    el.bsCv = q('#bsCv'); el.bsBusy = q('#bsBusy'); el.bsStat = q('#bsStat');
    el.bsGrid = q('#bsGrid'); el.bsPrompt = q('#bsPrompt');
    el.bsShadowRow = q('#bsShadowRow'); el.bsShadowTR = q('#bsShadowTR');
    el.bsOut = q('#bsOut');
    el.bsSize = q('#bsSize'); el.bsSizeV = q('#bsSizeV');
    el.bsShift = q('#bsShift'); el.bsShiftV = q('#bsShiftV');
    el.bsShadow = q('#bsShadow');
    el.bsShadowA = q('#bsShadowA'); el.bsShadowAV = q('#bsShadowAV');

    buildGrid();

    q('#bsClose').addEventListener('click', close);
    q('#bsCancel').addEventListener('click', close);
    q('#bsApply').addEventListener('click', apply);
    q('#bsShuffle').addEventListener('click', shuffle);
    q('#bsGen').addEventListener('click', () => genAI(el.bsPrompt.value));
    el.bsPrompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); genAI(el.bsPrompt.value); }
    });
    document.querySelectorAll('.bs-chips button').forEach((c) =>
      c.addEventListener('click', () => { el.bsPrompt.value = c.dataset.ai; genAI(c.dataset.ai); }));

    const bindRange = (id, valId, fn) => {
      const r = q('#' + id), v = q('#' + valId);
      r.addEventListener('input', () => { v.textContent = r.value; fn(+r.value); });
    };
    bindRange('bsSize', 'bsSizeV', (x) => { S.scale = x; renderSoon(); });
    bindRange('bsShift', 'bsShiftV', (x) => { S.vshift = x; renderSoon(); });
    bindRange('bsShadowA', 'bsShadowAV', (x) => { S.shadowA = x / 100; renderSoon(); });
    q('#bsShadow').addEventListener('change', (e) => { S.shadow = e.target.checked; renderSoon(); });
    el.bsOut.addEventListener('change', async () => { await refresh(true); fitView(); });

    const hold = q('#bsHold');
    hold.addEventListener('pointerdown', (e) => { e.preventDefault(); S.holding = true; renderPreview(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      hold.addEventListener(ev, () => { if (S.holding) { S.holding = false; refresh(false); } }));

    /* stage: drag = pan */
    const stage = el.bsStage;
    stage.addEventListener('pointerdown', (e) => {
      if (!S.open || S.holding) return;
      S.drag = { sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!S.drag) return;
      S.view.x = S.drag.vx + (e.clientX - S.drag.sx);
      S.view.y = S.drag.vy + (e.clientY - S.drag.sy);
      applyView();
    });
    const up = () => { S.drag = null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    /* wheel zoom towards the cursor */
    stage.addEventListener('wheel', (e) => {
      if (!S.open) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const ns = clamp(S.view.sc * Math.pow(1.0018, -e.deltaY), 0.04, 10);
      S.view.x = mx - (mx - S.view.x) * (ns / S.view.sc);
      S.view.y = my - (my - S.view.y) * (ns / S.view.sc);
      S.view.sc = ns;
      applyView();
    }, { passive: false });

    q('#bsFit').addEventListener('click', fitView);
    q('#bs100').addEventListener('click', zoom100);

    /* Esc closes only the studio (the editor stays open behind it) */
    document.addEventListener('keydown', (e) => {
      if (!S.open) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }, true);

    /* if the editor closes behind us, follow */
    setInterval(() => { if (S.open && !(window.PixsaEditor && window.PixsaEditor.isOpen())) close(); }, 500);
  }

  init();

  window.PixsaBGStudio = {
    open,
    close,
    isOpen: () => S.open
  };
})();
