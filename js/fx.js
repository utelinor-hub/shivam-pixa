/* SHIVAM PIXSA — fx.js
   Non-destructive render engine: original photo + ops list + tuning adjustments
   -> kisi bhi resolution par render (preview chhota, Save full-res). */
(() => {
  'use strict';

  const EFFECTS = [
    { id: 'bw', name: 'B&W' },
    { id: 'sepia', name: 'Sepia' },
    { id: 'warmify', name: 'Warmify' },
    { id: 'faded', name: 'Faded' },
    { id: 'punch', name: 'Punch' },
    { id: 'boost', name: 'Boost' },
    { id: 'filmgrain', name: 'Film Grain' },
    { id: 'glow', name: 'Glow' },
    { id: 'softfocus', name: 'Soft Focus' },
    { id: 'orton', name: 'Orton' },
    { id: 'crossprocess', name: 'Cross Process' },
    { id: 'vignette', name: 'Vignette' }
  ];

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function px(ctx, w, h, fn) {
    const im = ctx.getImageData(0, 0, w, h);
    fn(im.data, w, h);
    ctx.putImageData(im, 0, 0);
  }

  const lo256 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  /* ---------- effect passes ---------- */
  function effectPass(ctx, w, h, id) {
    switch (id) {
      case 'bw':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            d[i] = d[i + 1] = d[i + 2] = v;
          }
        });
        break;
      case 'sepia':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            d[i] = lo256(r * 0.393 + g * 0.769 + b * 0.189);
            d[i + 1] = lo256(r * 0.349 + g * 0.686 + b * 0.168);
            d[i + 2] = lo256(r * 0.272 + g * 0.534 + b * 0.131);
          }
        });
        break;
      case 'warmify':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = lo256(d[i] * 1.14 + 6);
            d[i + 1] = lo256(d[i + 1] * 1.02);
            d[i + 2] = lo256(d[i + 2] * 0.84);
          }
        });
        break;
      case 'faded':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = lo256(36 + d[i] * 0.85);
            d[i + 1] = lo256(34 + d[i + 1] * 0.85);
            d[i + 2] = lo256(32 + d[i + 2] * 0.86);
          }
        });
        break;
      case 'punch':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            for (let k = 0; k < 3; k++) {
              const v = (d[i + k] - l) * 1.32 + l;
              d[i + k] = lo256((v - 128) * 1.13 + 128);
            }
          }
        });
        break;
      case 'boost':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            for (let k = 0; k < 3; k++) d[i + k] = lo256((d[i + k] - l) * 1.5 + l);
          }
        });
        break;
      case 'filmgrain':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const n = (Math.random() - 0.5) * 26;
            d[i] = lo256(d[i] + n);
            d[i + 1] = lo256(d[i + 1] + n);
            d[i + 2] = lo256(d[i + 2] + n);
          }
        });
        break;
      case 'crossprocess':
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = lo256((d[i] * 1.22 + 10 - 128) * 1.06 + 128);
            d[i + 1] = lo256(d[i + 1] * 1.04);
            d[i + 2] = lo256(d[i + 2] * 0.86 + 8);
          }
        });
        break;
      case 'glow':
      case 'orton': {
        const t = mkCanvas(w, h);
        const tx = t.getContext('2d');
        tx.filter = `blur(${Math.max(3, Math.min(w, h) / (id === 'orton' ? 60 : 90))}px) brightness(${id === 'orton' ? 1.12 : 1.1})`;
        tx.drawImage(ctx.canvas, 0, 0);
        tx.filter = 'none';
        ctx.globalAlpha = id === 'orton' ? 0.55 : 0.42;
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(t, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (id === 'orton') {
          px(ctx, w, h, (d) => {
            for (let i = 0; i < d.length; i += 4) {
              d[i] = lo256((d[i] - 128) * 1.1 + 132);
              d[i + 1] = lo256((d[i + 1] - 128) * 1.1 + 132);
              d[i + 2] = lo256((d[i + 2] - 128) * 1.1 + 132);
            }
          });
        }
        break;
      }
      case 'softfocus': {
        const t = mkCanvas(w, h);
        const tx = t.getContext('2d');
        tx.filter = `blur(${Math.max(3, Math.min(w, h) / 70)}px)`;
        tx.drawImage(ctx.canvas, 0, 0);
        tx.filter = 'none';
        ctx.globalAlpha = 0.6;
        ctx.globalCompositeOperation = 'lighten';
        ctx.drawImage(t, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'vignette': {
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        break;
      }
    }
  }

  /* ---------- brush passes (redeye / retouch) ---------- */
  function redeyePt(ctx, w, h, nx, ny, nr) {
    const cx = nx * w, cy = ny * h, rad = Math.max(2, nr * Math.min(w, h));
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
    if (x1 <= x0 || y1 <= y0) return;
    const im = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const d = im.data, iw = x1 - x0 + 1, ih = y1 - y0 + 1;
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const dx = x0 + x - cx, dy = y0 + y - cy;
        if (dx * dx + dy * dy > rad * rad) continue;
        const i = (y * iw + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (r > 55 && r > g * 1.3 && r > b * 1.3) {
          const v = 0.28 * (g + b);
          d[i] = v; d[i + 1] = g * 0.8; d[i + 2] = b * 0.8;
        }
      }
    }
    ctx.putImageData(im, x0, y0);
  }

  function retouchPt(ctx, w, h, nx, ny, nr) {
    const cx = nx * w, cy = ny * h, rad = Math.max(3, nr * Math.min(w, h));
    const pad = rad * 2;
    const sx = Math.max(0, Math.floor(cx - pad)), sy = Math.max(0, Math.floor(cy - pad));
    const sw = Math.min(w - sx, Math.ceil(pad * 2)), sh = Math.min(h - sy, Math.ceil(pad * 2));
    if (sw <= 1 || sh <= 1) return;
    const t = mkCanvas(sw, sh);
    const tx = t.getContext('2d');
    tx.filter = `blur(${Math.max(2, rad / 2.2)}px)`;
    tx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    tx.filter = 'none';
    tx.globalCompositeOperation = 'destination-in';
    const g = tx.createRadialGradient(cx - sx, cy - sy, rad * 0.2, cx - sx, cy - sy, rad);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    tx.fillStyle = g;
    tx.fillRect(0, 0, sw, sh);
    tx.globalCompositeOperation = 'source-over';
    ctx.drawImage(t, sx, sy);
  }

  /* ---------- auto levels / white balance ---------- */
  function computeLevels(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
      n++;
    }
    const cut = n * 0.006;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    if (hi - lo < 12) { lo = 0; hi = 255; }
    return { lo, hi };
  }

  function computeWB(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 64) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    const avg = (r + g + b) / 3;
    const gain = (v) => Math.max(0.72, Math.min(1.42, avg / Math.max(8, v)));
    return { gr: +gain(r).toFixed(4), gg: +gain(g).toFixed(4), gb: +gain(b).toFixed(4) };
  }

  /* ---------- tuning ---------- */
  const adjHas = (a) => a && ((a.high | 0) || (a.shad | 0) || (a.temp | 0) || (a.tint | 0));
  const filterStr = (a) => {
    if (!a) return 'none';
    const br = 1 + (a.fill | 0) / 140;
    const sa = 1 + (a.sat | 0) / 100;
    return `brightness(${br.toFixed(4)}) saturate(${sa.toFixed(4)})`;
  };

  function adjPass(ctx, w, h, adj) {
    if (!adjHas(adj)) return;
    const hi = (adj.high | 0) / 100, sh = (adj.shad | 0) / 100;
    const tp = (adj.temp | 0) / 250, tn = (adj.tint | 0) / 300;
    px(ctx, w, h, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        if (tp) { r = r * (1 + tp); b = b * (1 - tp); }
        if (tn) { g = g * (1 - tn); r = r * (1 + tn * 0.18); }
        if (hi || sh) {
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          if (hi && l > 128) {
            const k = 1 - ((l - 128) / 127) * hi * 0.85;
            r *= k; g *= k; b *= k;
          }
          if (sh && l < 128) {
            const add = ((128 - l) / 128) * sh * 82;
            r += add; g += add; b += add;
          }
        }
        d[i] = lo256(r); d[i + 1] = lo256(g); d[i + 2] = lo256(b);
      }
    });
  }

  /* ---------- main renderer ---------- */
  function renderStack(src, ops, adj, maxSide) {
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    let sc = 1;
    if (maxSide && Math.max(sw, sh) > maxSide) sc = maxSide / Math.max(sw, sh);

    let acc = mkCanvas(sw * sc, sh * sc);
    let cx = acc.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, acc.width, acc.height);

    for (const op of (ops || [])) {
      switch (op.type) {
        case 'rot': {
          const nc = mkCanvas(acc.height, acc.width);
          const nx = nc.getContext('2d');
          nx.translate(nc.width / 2, nc.height / 2);
          nx.rotate((op.deg * Math.PI) / 180);
          nx.drawImage(acc, -acc.width / 2, -acc.height / 2);
          acc = nc; cx = nx;
          break;
        }
        case 'straighten': {
          const w = acc.width, h = acc.height;
          const rad = (op.deg * Math.PI) / 180;
          const cs = Math.cos(rad), sn = Math.abs(Math.sin(rad));
          const k = Math.max((w * cs + h * sn) / w, (w * sn + h * cs) / h);
          const nc = mkCanvas(w, h);
          const nx = nc.getContext('2d');
          nx.translate(w / 2, h / 2);
          nx.rotate(rad);
          nx.scale(k, k);
          nx.drawImage(acc, -w / 2, -h / 2);
          acc = nc; cx = nx;
          break;
        }
        case 'crop': {
          const cw = Math.min(op.w * acc.width, acc.width), ch = Math.min(op.h * acc.height, acc.height);
          const ox = Math.max(0, Math.min(op.x * acc.width, acc.width - cw));
          const oy = Math.max(0, Math.min(op.y * acc.height, acc.height - ch));
          const nc = mkCanvas(cw, ch);
          nc.getContext('2d').drawImage(acc, ox, oy, cw, ch, 0, 0, cw, ch);
          acc = nc; cx = acc.getContext('2d');
          break;
        }
        case 'effect':
          effectPass(cx, acc.width, acc.height, op.id);
          break;
        case 'autocontrast': {
          const lo = op.lo, hi2 = op.hi, f = 255 / Math.max(1, hi2 - lo);
          px(cx, acc.width, acc.height, (d) => {
            for (let i = 0; i < d.length; i += 4) {
              d[i] = lo256((d[i] - lo) * f);
              d[i + 1] = lo256((d[i + 1] - lo) * f);
              d[i + 2] = lo256((d[i + 2] - lo) * f);
            }
          });
          break;
        }
        case 'autocolor':
          px(cx, acc.width, acc.height, (d) => {
            for (let i = 0; i < d.length; i += 4) {
              d[i] = lo256(d[i] * op.gr);
              d[i + 1] = lo256(d[i + 1] * op.gg);
              d[i + 2] = lo256(d[i + 2] * op.gb);
            }
          });
          break;
        case 'redeye':
          for (const p of op.pts) redeyePt(cx, acc.width, acc.height, p.x, p.y, p.r);
          break;
        case 'retouch':
          for (const p of op.pts) retouchPt(cx, acc.width, acc.height, p.x, p.y, p.r);
          break;
        case 'text': {
          cx.font = `600 ${Math.max(6, (op.size / 100) * acc.height)}px ${op.font || '"Segoe UI", sans-serif'}`;
          cx.textBaseline = 'middle';
          cx.shadowColor = 'rgba(0,0,0,.55)';
          cx.shadowBlur = acc.height * 0.006;
          cx.fillStyle = op.color || '#ffffff';
          cx.fillText(op.text, op.x * acc.width, op.y * acc.height);
          cx.shadowBlur = 0;
          break;
        }
      }
    }

    let out = acc;
    if (adj && (adjHas(adj) || (adj.fill | 0) || (adj.sat | 0))) {
      out = mkCanvas(acc.width, acc.height);
      const ox = out.getContext('2d');
      ox.filter = filterStr(adj);
      ox.drawImage(acc, 0, 0);
      ox.filter = 'none';
      adjPass(ox, out.width, out.height, adj);
    }

    if (maxSide && Math.max(out.width, out.height) > maxSide) {
      const s2 = maxSide / Math.max(out.width, out.height);
      const nc = mkCanvas(out.width * s2, out.height * s2);
      const nx = nc.getContext('2d');
      nx.imageSmoothingQuality = 'high';
      nx.drawImage(out, 0, 0, nc.width, nc.height);
      return nc;
    }
    return out;
  }

  window.PixsaFX = { EFFECTS, renderStack, computeLevels, computeWB, redeyePt, retouchPt, mkCanvas };
})();
