/* SHIVAM PIXA — cutout.js (v3.21.0)
   Cutout — professional Remove-Background engine for product photos.

   How it stays professional (nothing of the product is ever cut blindly):
   1. Border-connected background detection — background colour clusters are
      sampled from the photo EDGES and only the region connected to the
      border is removed. Shiny highlights / gaps INSIDE the product never
      match the border-connected rule, so they are never cut.
   2. Enclosed-hole cutting (optional) — fully enclosed regions that match
      the background exactly (see-through holes of rings / bangles).
   3. Edge quality — soft anti-aliased alpha (feather) + colour de-fringing
      that un-mixes the old background out of the edge pixels (no halo).
   4. Keep / Remove fix brush with undo — the final 5% is always under the
      user's control, exactly like professional tools.
   5. Zoomable checkerboard QA preview with a hold-to-compare Before button,
      and non-destructive Apply (a 'cutout' op — always undoable).

   Output: Transparent PNG / Pure White (#FFFFFF, marketplace standard) /
   custom colour, with an optional soft drop shadow under the product.

   Exposes window.PixsaCutout = { open, close, isOpen } and works only on
   top of the editor (window.PixsaEditor.cutoutSource / commitCutout). */
(() => {
  'use strict';
  const FX = window.PixsaFX;
  if (!FX) return;
  const q = (s) => document.querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  /* safety cap — photos above this pixel count are processed scaled down */
  const MAXPX = 24e6;

  const S = {
    open: false, W: 0, H: 0,
    src: null,            /* original full-res canvas (editor base) */
    d: null,              /* its ImageData bytes */
    clusters: [],         /* background colour clusters from the edges */
    rgbaCv: null,         /* transparent-mode RGBA result canvas */
    outCv: null,          /* final preview/apply canvas (bg mode applied) */
    view: { sc: 1, x: 0, y: 0 },
    tool: 'pan', brush: 40,
    strokes: [],
    opts: { tol: 30, feather: 2, fringe: 70, holes: false, despeck: true, bg: 'transparent', color: '#f2f2f2', shadow: false },
    busy: false, holding: false, drag: null
  };

  const el = {};
  const stat = (t) => { if (el.coStat) el.coStat.textContent = t || ''; };

  /* ================= background colour clusters (edge sampling) ========= */
  function buildBorderClusters(d, W, H) {
    const band = Math.max(2, Math.round(Math.min(W, H) * 0.02));
    const step = Math.max(1, Math.round(Math.min(W, H) / 300));
    const pts = [];
    for (let y = 0; y < H; y += step)
      for (let x = 0; x < W; x += step)
        if (x < band || y < band || x >= W - band || y >= H - band) {
          const i = (y * W + x) * 4;
          pts.push([d[i], d[i + 1], d[i + 2]]);
        }
    if (!pts.length) return [{ r: 255, g: 255, b: 255 }];
    pts.sort((p, r) => (p[0] + p[1] + p[2]) - (r[0] + r[1] + r[2]));
    let centers = [0, 0.5, 1].map((t) => {
      const p = pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))];
      return { r: p[0], g: p[1], b: p[2] };
    });
    for (let it = 0; it < 8; it++) {
      const sum = centers.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const dr = p[0] - centers[c].r, dg = p[1] - centers[c].g, db = p[2] - centers[c].b;
          const dd = dr * dr + dg * dg + db * db;
          if (dd < bd) { bd = dd; bi = c; }
        }
        const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      }
      centers = centers.map((c, ci) => (sum[ci][3]
        ? { r: sum[ci][0] / sum[ci][3], g: sum[ci][1] / sum[ci][3], b: sum[ci][2] / sum[ci][3] }
        : c));
    }
    const out = [];
    for (const c of centers) {
      let dup = false;
      for (const o of out)
        if (Math.abs(o.r - c.r) + Math.abs(o.g - c.g) + Math.abs(o.b - c.b) < 60) { dup = true; break; }
      if (!dup) out.push({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) });
    }
    return out;
  }

  function bgDist2(d, p, clusters) {
    let m = Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const k = clusters[c];
      const dr = d[p] - k.r, dg = d[p + 1] - k.g, db = d[p + 2] - k.b;
      const v = 2 * dr * dr + 4 * dg * dg + 3 * db * db; /* luma-weighted */
      if (v < m) m = v;
    }
    return m;
  }
  function nearestCluster(d, p, clusters) {
    let best = clusters[0], m = Infinity;
    for (const k of clusters) {
      const dr = d[p] - k.r, dg = d[p + 1] - k.g, db = d[p + 2] - k.b;
      const v = dr * dr + dg * dg + db * db;
      if (v < m) { m = v; best = k; }
    }
    return best;
  }

  /* ================= separable box blur (running sum, 2 passes) ========= */
  function boxBlur(a, W, H, r) {
    if (r <= 0) return;
    const tmp = new Float32Array(a.length);
    const win = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = sum / win;
        const xa = Math.min(W - 1, Math.max(0, x - r));
        const xb = Math.min(W - 1, Math.max(0, x + r + 1));
        sum += a[row + xb] - a[row + xa];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum / win;
        const ya = Math.min(H - 1, Math.max(0, y - r));
        const yb = Math.min(H - 1, Math.max(0, y + r + 1));
        sum += tmp[yb * W + x] - tmp[ya * W + x];
      }
    }
  }

  /* ================= brush strokes -> keep / force-remove masks ========= */
  function strokeMasks(n) {
    const keep = new Uint8Array(n), force = new Uint8Array(n);
    for (const st of S.strokes) {
      const tgt = st.mode === 'keep' ? keep : force;
      const r = st.size / 2, r2 = r * r;
      const pts = st.pts.length === 1 ? [st.pts[0], st.pts[0]] : st.pts;
      for (let pi = 1; pi < pts.length; pi++) {
        const x0 = pts[pi - 1][0], y0 = pts[pi - 1][1], x1 = pts[pi][0], y1 = pts[pi][1];
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 3)));
        for (let s = 0; s <= steps; s++) {
          const cx = x0 + (x1 - x0) * s / steps, cy = y0 + (y1 - y0) * s / steps;
          const xA = Math.max(0, Math.floor(cx - r)), xB = Math.min(S.W - 1, Math.ceil(cx + r));
          const yA = Math.max(0, Math.floor(cy - r)), yB = Math.min(S.H - 1, Math.ceil(cy + r));
          for (let y = yA; y <= yB; y++) {
            const dy = y - cy;
            for (let x = xA; x <= xB; x++) {
              const dx = x - cx;
              if (dx * dx + dy * dy <= r2) tgt[y * S.W + x] = 1;
            }
          }
        }
      }
    }
    return { keep, force };
  }

  /* ================= the main compute pipeline ========================== */
  async function compute() {
    if (!S.d || S.busy) { S.pend = true; return; }
    S.busy = true;
    el.coBusy.hidden = false;
    await raf2();

    const W = S.W, H = S.H, n = W * H, d = S.d;
    const tol = S.opts.tol, thr = 3 * tol * tol;
    const { keep, force } = strokeMasks(n);

    /* pass 1 — background candidates (edge clusters + brush) */
    const cand = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (keep[i]) continue;
      if (force[i] || bgDist2(d, p, S.clusters) <= thr) cand[i] = 1;
    }

    /* pass 2 — only the background CONNECTED to the photo border goes.
       This is the "proper product analysis": anything inside the product
       that merely resembles the background stays untouched. */
    const bg = new Uint8Array(n);
    const stack = new Int32Array(n);
    let sp = 0;
    const push = (idx) => { if (!bg[idx] && cand[idx]) { bg[idx] = 1; stack[sp++] = idx; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % W, y = (idx / W) | 0;
      if (x > 0) push(idx - 1);
      if (x < W - 1) push(idx + 1);
      if (y > 0) push(idx - W);
      if (y < H - 1) push(idx + W);
    }

    /* BFS helper over the foreground — 8-CONNECTED on purpose: a thin
       diagonal chain/necklace touches its neighbours only corner-wise, so
       4-connectivity would shred it into "dust specks" and despeckle would
       erase it pixel by pixel (the classic cheap-cutout failure). */
    const seen = new Uint8Array(n);
    const stack2 = new Int32Array(n), comp = new Int32Array(n);
    const flood = (i0, isFg) => {
      let sp2 = 0, cN = 0, touches = false, allCand = true;
      stack2[sp2++] = i0; seen[i0] = 1;
      while (sp2 > 0) {
        const idx = stack2[--sp2]; comp[cN++] = idx;
        const x = idx % W, y = (idx / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
        if (!cand[idx]) allCand = false;
        const x0 = x > 0 ? x - 1 : x, x1 = x < W - 1 ? x + 1 : x;
        const y0 = y > 0 ? y - 1 : y, y1 = y < H - 1 ? y + 1 : y;
        for (let yy = y0; yy <= y1; yy++) {
          const rowB = yy * W;
          for (let xx = x0; xx <= x1; xx++) {
            const nIdx = rowB + xx;
            if (nIdx !== idx && !seen[nIdx] && isFg(nIdx)) { seen[nIdx] = 1; stack2[sp2++] = nIdx; }
          }
        }
      }
      return { cN, touches, allCand };
    };

    /* pass 3 — optional: enclosed see-through holes (rings / bangles).
       Flood the remaining CANDIDATE pixels (border-connected ones were
       already removed in pass 2) — every region still standing is fully
       enclosed by the product, so it can only be a see-through hole.
       A tiny floor skips single-pixel JPEG noise pinholes. */
    if (S.opts.holes) {
      seen.fill(0);
      const holeMin = 12;
      for (let i0 = 0; i0 < n; i0++) {
        if (seen[i0] || bg[i0] || !cand[i0]) continue;
        const r = flood(i0, (idx) => !bg[idx] && !!cand[idx]);
        if (r.cN >= holeMin) for (let j = 0; j < r.cN; j++) bg[comp[j]] = 1;
      }
    }

    /* pass 4 — despeckle: tiny disconnected dust islands become background */
    if (S.opts.despeck) {
      seen.fill(0);
      const minArea = Math.max(24, Math.round(n * 0.00002));
      for (let i0 = 0; i0 < n; i0++) {
        if (seen[i0] || bg[i0]) continue;
        const r = flood(i0, (idx) => !bg[idx]);
        if (r.cN < minArea && !r.touches) for (let j = 0; j < r.cN; j++) bg[comp[j]] = 1;
      }
    }

    /* pass 5 — soft anti-aliased edge band */
    const a = new Float32Array(n);
    let fgCount = 0;
    for (let i = 0; i < n; i++) { a[i] = bg[i] ? 0 : 1; if (!bg[i]) fgCount++; }
    const thrS = thr * 1.15, band = thr * 0.35;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!a[idx] || keep[idx]) continue;
        const edge = (x > 0 && bg[idx - 1]) || (x < W - 1 && bg[idx + 1]) ||
                     (y > 0 && bg[idx - W]) || (y < H - 1 && bg[idx + W]);
        if (!edge) continue;
        const v = bgDist2(d, idx * 4, S.clusters);
        if (v < thrS) a[idx] = 1 - clamp((thrS - v) / (thrS - band || 1), 0, 1);
      }
    }
    if (S.opts.feather > 0) boxBlur(a, W, H, S.opts.feather | 0);

    /* pass 6 — de-fringe (un-mix the old background out of edge pixels) */
    const rgbaCv = FX.mkCanvas(W, H);
    const rx = rgbaCv.getContext('2d');
    const out = rx.createImageData(W, H);
    const od = out.data;
    const fr = S.opts.fringe / 100;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const al = a[i];
      od[p + 3] = Math.round(al * 255);
      if (al <= 0.004) continue;
      let R = d[p], G = d[p + 1], B = d[p + 2];
      if (al < 0.985 && fr > 0) {
        const k = nearestCluster(d, p, S.clusters), ia = 1 - al;
        R += (c255((R - ia * k.r) / al) - R) * fr;
        G += (c255((G - ia * k.g) / al) - G) * fr;
        B += (c255((B - ia * k.b) / al) - B) * fr;
      }
      od[p] = R; od[p + 1] = G; od[p + 2] = B;
    }
    rx.putImageData(out, 0, 0);
    S.rgbaCv = rgbaCv;

    composeOut();
    drawPreview();

    el.coBusy.hidden = true;
    S.busy = false;
    const frac = fgCount / n;
    if (frac < 0.01) stat('Almost everything was removed — lower the Tolerance');
    else if (frac > 0.995) stat('No background detected yet — raise the Tolerance');
    else stat(`${Math.round((1 - frac) * 100)}% background removed \u2022 ${S.clusters.length} colour${S.clusters.length !== 1 ? 's' : ''} detected`);

    if (S.pend) { S.pend = false; setTimeout(compute, 30); }
  }

  /* compose the final canvas for the chosen background mode */
  function composeOut() {
    const W = S.W, H = S.H;
    const cv = FX.mkCanvas(W, H);
    const cx = cv.getContext('2d');
    const useC = S.opts.bg !== 'transparent';
    if (useC) {
      cx.fillStyle = S.opts.bg === 'white' ? '#ffffff' : S.opts.color;
      cx.fillRect(0, 0, W, H);
      if (S.opts.shadow) {
        const sil = FX.mkCanvas(W, H);
        const sx = sil.getContext('2d');
        const id = sx.createImageData(W, H);
        const rd = S.rgbaCv.getContext('2d').getImageData(0, 0, W, H).data;
        for (let i = 0, p = 3; i < W * H; i++, p += 4) id.data[p] = rd[p];
        sx.putImageData(id, 0, 0);
        const off = Math.max(3, Math.round(H * 0.006));
        cx.save();
        cx.filter = `blur(${Math.max(2, Math.round(off * 0.9))}px)`;
        cx.globalAlpha = 0.32;
        cx.drawImage(sil, 0, off);
        cx.restore();
      }
    }
    cx.drawImage(S.rgbaCv, 0, 0);
    S.outCv = cv;
  }

  function drawPreview() {
    const cv = el.coCv;
    if (cv.width !== S.W) cv.width = S.W;
    if (cv.height !== S.H) cv.height = S.H;
    const cx = cv.getContext('2d');
    cx.clearRect(0, 0, cv.width, cv.height);
    if (S.holding && S.src) cx.drawImage(S.src, 0, 0);
    else if (S.outCv) cx.drawImage(S.outCv, 0, 0);
  }

  /* ================= view (zoom / pan) ================================== */
  function applyView() {
    el.coWrap.style.transform = `translate(${S.view.x}px, ${S.view.y}px) scale(${S.view.sc})`;
  }
  function fitView() {
    const r = el.coStage.getBoundingClientRect();
    const sc = Math.min((r.width - 48) / S.W, (r.height - 48) / S.H, 1);
    S.view.sc = Math.max(0.02, sc);
    S.view.x = (r.width - S.W * S.view.sc) / 2;
    S.view.y = (r.height - S.H * S.view.sc) / 2;
    applyView();
  }
  function zoom100() {
    const r = el.coStage.getBoundingClientRect();
    S.view.sc = 1;
    S.view.x = (r.width - S.W) / 2;
    S.view.y = (r.height - S.H) / 2;
    applyView();
  }

  /* ================= tools / brush overlay ============================== */
  function setTool(t) {
    S.tool = t;
    [['coKeep', 'keep'], ['coRemove', 'remove'], ['coPan', 'pan']]
      .forEach(([id, m]) => el[id].classList.toggle('on', m === t));
    el.coStage.classList.remove('pan', 'keep', 'remove', 'grabbing');
    el.coStage.classList.add(t);
  }
  function imgPt(e) {
    const r = el.coStage.getBoundingClientRect();
    return [(e.clientX - r.left - S.view.x) / S.view.sc, (e.clientY - r.top - S.view.y) / S.view.sc];
  }
  function redrawOverlay() {
    const cv = el.coOvl;
    cv.width = S.W; cv.height = S.H;
    const cx = cv.getContext('2d');
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    for (const st of S.strokes) {
      const col = st.mode === 'keep' ? 'rgba(34,165,89,.5)' : 'rgba(224,68,52,.5)';
      cx.strokeStyle = col; cx.fillStyle = col; cx.lineWidth = st.size;
      if (st.pts.length < 2) {
        cx.beginPath(); cx.arc(st.pts[0][0], st.pts[0][1], st.size / 2, 0, Math.PI * 2); cx.fill();
        continue;
      }
      cx.beginPath(); cx.moveTo(st.pts[0][0], st.pts[0][1]);
      for (let i = 1; i < st.pts.length; i++) cx.lineTo(st.pts[i][0], st.pts[i][1]);
      cx.stroke();
    }
  }
  function seg(a, b, size, mode) {
    const cx = el.coOvl.getContext('2d');
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.strokeStyle = mode === 'keep' ? 'rgba(34,165,89,.5)' : 'rgba(224,68,52,.5)';
    cx.lineWidth = size;
    cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.stroke();
  }

  /* ================= scheduling ========================================= */
  let schedT = null;
  function schedRecompute() {
    clearTimeout(schedT);
    schedT = setTimeout(() => compute(), 230);
  }

  /* ================= open / close / apply =============================== */
  async function open() {
    const ed = window.PixsaEditor;
    if (!ed || !ed.isOpen() || S.open) return;
    S.open = true;
    el.root.hidden = false;
    el.coBusy.hidden = false;
    stat('Preparing the photo\u2026');
    await raf2();
    let src = null;
    try { src = ed.cutoutSource(); } catch (e) { src = null; }
    if (!src || !src.width) {
      el.coBusy.hidden = true;
      close();
      return;
    }
    /* safety cap for gigantic photos */
    if (src.width * src.height > MAXPX) {
      const k = Math.sqrt(MAXPX / (src.width * src.height));
      const sc2 = FX.mkCanvas(src.width * k, src.height * k);
      const c2 = sc2.getContext('2d');
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(src, 0, 0, sc2.width, sc2.height);
      src = sc2;
    }
    S.src = src;
    S.W = src.width; S.H = src.height;
    try {
      S.d = src.getContext('2d').getImageData(0, 0, S.W, S.H).data;
    } catch (e) {
      el.coBusy.hidden = true;
      close();
      return;
    }
    S.strokes = [];
    S.clusters = [];
    S.rgbaCv = null; S.outCv = null;
    S.holding = false;
    el.coOvl.width = S.W; el.coOvl.height = S.H;
    el.coUndo.disabled = true;
    setTool('pan');
    fitView();
    runAuto();
  }
  async function runAuto() {
    el.coBusy.hidden = false;
    stat('Analysing the background\u2026');
    await raf2();
    S.clusters = buildBorderClusters(S.d, S.W, S.H);
    await compute();
  }
  function close() {
    S.open = false;
    el.root.hidden = true;
    S.src = null; S.d = null; S.rgbaCv = null; S.outCv = null;
    S.strokes = []; S.drag = null; S.holding = false;
    clearTimeout(schedT);
  }
  async function apply() {
    if (!S.outCv || !window.PixsaEditor) return;
    el.coBusy.hidden = false;
    stat('Applying\u2026');
    await raf2();
    let blob = null;
    try { blob = await new Promise((r) => S.outCv.toBlob(r, 'image/png')); } catch (e) {}
    el.coBusy.hidden = true;
    if (!blob) { stat('Could not create the result — try again'); return; }
    const ok = await window.PixsaEditor.commitCutout(blob);
    if (ok) close();
    else stat('The photo changed — reopen the Cutout tool');
  }

  /* ================= wiring ============================================= */
  function init() {
    el.root = q('#cutout');
    if (!el.root || el.root.dataset.wired) return;
    el.root.dataset.wired = '1';
    el.coStage = q('#coStage'); el.coWrap = q('#coWrap');
    el.coCv = q('#coCv'); el.coOvl = q('#coOvl'); el.coBusy = q('#coBusy');
    el.coStat = q('#coStat'); el.coUndo = q('#coUndo');
    el.coKeep = q('#coKeep'); el.coRemove = q('#coRemove'); el.coPan = q('#coPan');

    q('#coClose').addEventListener('click', close);
    q('#coCancel').addEventListener('click', close);
    q('#coApply').addEventListener('click', apply);
    q('#coAuto').addEventListener('click', () => { if (!S.busy) runAuto(); });
    el.coKeep.addEventListener('click', () => setTool('keep'));
    el.coRemove.addEventListener('click', () => setTool('remove'));
    el.coPan.addEventListener('click', () => setTool('pan'));
    el.coUndo.addEventListener('click', () => { S.strokes.pop(); redrawOverlay(); el.coUndo.disabled = !S.strokes.length; schedRecompute(); });
    q('#coClear').addEventListener('click', () => { S.strokes = []; redrawOverlay(); el.coUndo.disabled = true; schedRecompute(); });
    q('#coFit').addEventListener('click', fitView);
    q('#co100').addEventListener('click', zoom100);

    const bindRange = (id, valId, fn) => {
      const r = q('#' + id), v = q('#' + valId);
      r.addEventListener('input', () => { v.textContent = r.value; fn(+r.value); });
    };
    bindRange('coTol', 'coTolV', (x) => { S.opts.tol = x; schedRecompute(); });
    bindRange('coFeather', 'coFeatherV', (x) => { S.opts.feather = x; schedRecompute(); });
    bindRange('coFringe', 'coFringeV', (x) => { S.opts.fringe = x; schedRecompute(); });
    bindRange('coBrush', 'coBrushV', (x) => { S.brush = x; });
    q('#coHoles').addEventListener('change', (e) => { S.opts.holes = e.target.checked; schedRecompute(); });
    q('#coDespeck').addEventListener('change', (e) => { S.opts.despeck = e.target.checked; schedRecompute(); });
    q('#coColor').addEventListener('input', (e) => { S.opts.color = e.target.value; if (S.opts.bg === 'color') schedRecompute(); });
    q('#coShadow').addEventListener('change', (e) => { S.opts.shadow = e.target.checked; schedRecompute(); });
    document.querySelectorAll('input[name="coBg"]').forEach((r) =>
      r.addEventListener('change', () => {
        S.opts.bg = document.querySelector('input[name="coBg"]:checked').value;
        q('#coShadowRow').style.opacity = S.opts.bg === 'transparent' ? '.45' : '1';
        schedRecompute();
      }));

    /* Before / After hold */
    const hold = q('#coHold');
    hold.addEventListener('pointerdown', (e) => { e.preventDefault(); S.holding = true; drawPreview(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      hold.addEventListener(ev, () => { if (S.holding) { S.holding = false; drawPreview(); } }));

    /* stage pointer: pan + brush */
    const stage = el.coStage;
    stage.addEventListener('pointerdown', (e) => {
      if (!S.open || S.busy || S.holding) return;
      if (e.button === 1 || S.tool === 'pan') {
        S.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y };
        stage.setPointerCapture(e.pointerId);
        stage.classList.add('grabbing');
        e.preventDefault();
        return;
      }
      if (e.button !== 0 || (S.tool !== 'keep' && S.tool !== 'remove')) return;
      const p = imgPt(e);
      S.drag = { kind: 'brush', mode: S.tool, pts: [p], size: Math.max(2, S.brush / S.view.sc), last: p };
      seg(p, p, S.drag.size, S.tool);
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!S.drag) return;
      if (S.drag.kind === 'pan') {
        S.view.x = S.drag.vx + (e.clientX - S.drag.sx);
        S.view.y = S.drag.vy + (e.clientY - S.drag.sy);
        applyView();
        return;
      }
      const p = imgPt(e);
      seg(S.drag.last, p, S.drag.size, S.drag.mode);
      S.drag.last = p;
      S.drag.pts.push(p);
    });
    const up = () => {
      if (!S.drag) return;
      if (S.drag.kind === 'brush') {
        S.strokes.push({ mode: S.drag.mode, pts: S.drag.pts, size: S.drag.size });
        el.coUndo.disabled = false;
        schedRecompute();
      } else stage.classList.remove('grabbing');
      S.drag = null;
    };
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

    /* Esc closes only the cutout (the editor stays open behind it) */
    document.addEventListener('keydown', (e) => {
      if (!S.open) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }, true);

    /* if the editor closes behind us, follow */
    setInterval(() => { if (S.open && !(window.PixsaEditor && window.PixsaEditor.isOpen())) close(); }, 500);
  }

  init();

  window.PixsaCutout = {
    open,
    close,
    isOpen: () => S.open
  };
})();
