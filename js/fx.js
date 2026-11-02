/* SHIVAM PIXA — fx.js
   Non-destructive render engine: original photo + ops list + tuning adjustments
   -> renders at any resolution (small preview, full-res on Save). */
(() => {
  'use strict';

  const EFFECTS = [
    /* Page 1 — Classic fixes (Picasa Effects 1) */
    { id: 'sharpen', name: 'Sharpen', page: 1 },
    { id: 'sepia', name: 'Sepia', page: 1 },
    { id: 'bw', name: 'B&W', page: 1 },
    { id: 'warmify', name: 'Warmify', page: 1 },
    { id: 'filmgrain', name: 'Film Grain', page: 1 },
    { id: 'tint', name: 'Tint', page: 1 },
    { id: 'softfocus', name: 'Soft Focus', page: 1 },
    { id: 'glow', name: 'Glow', page: 1 },
    { id: 'fbw', name: 'Filtered B&W', page: 1 },
    { id: 'focalbw', name: 'Focal B&W', page: 1 },
    { id: 'gradtint', name: 'Graduated Tint', page: 1 },
    { id: 'crossprocess', name: 'Cross Process', page: 1 },
    /* Page 2 — Fun & retro (Picasa Effects 2) */
    { id: 'lomo', name: 'Lomo-ish', page: 2 },
    { id: 'holga', name: 'Holga', page: 2 },
    { id: 'hdrish', name: 'HDR-ish', page: 2 },
    { id: 'orton', name: 'Orton-ish', page: 2 },
    { id: 'infrared', name: 'Infrared', page: 2 },
    { id: 'sixty', name: '1960s', page: 2 },
    { id: 'cinema', name: 'CinemaScope', page: 2 },
    { id: 'invert', name: 'Invert', page: 2 },
    { id: 'heatmap', name: 'Heat Map', page: 2 },
    { id: 'posterize', name: 'Posterize', page: 2 },
    { id: 'duotone', name: 'Duo-Tone', page: 2 },
    { id: 'punch', name: 'Punch', page: 2 },
    /* Page 3 — Creative (Picasa Effects 3) */
    { id: 'vignette', name: 'Vignette', page: 3 },
    { id: 'pixelate', name: 'Pixelate', page: 3 },
    { id: 'focalzoom', name: 'Focal Zoom', page: 3 },
    { id: 'sketch', name: 'Pencil Sketch', page: 3 },
    { id: 'neon', name: 'Neon', page: 3 },
    { id: 'comic', name: 'Comic Book', page: 3 },
    { id: 'stamp', name: 'Stamp', page: 3 },
    { id: 'boost', name: 'Boost', page: 3 },
    { id: 'faded', name: 'Faded', page: 3 },
    { id: 'border', name: 'Border', page: 3 },
    { id: 'dropshadow', name: 'Drop Shadow', page: 3 },
    { id: 'matte', name: 'Museum Matte', page: 3 }
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

  /* ---------- edge detection (neon / comic) ---------- */
  function sobelEdges(ctx, w, h) {
    const sd = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < sd.length; i += 4, j++) {
      g[j] = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
    }
    const out = new Uint8ClampedArray(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const j = y * w + x;
        const gx =
          -g[j - w - 1] - 2 * g[j - 1] - g[j + w - 1] +
          g[j - w + 1] + 2 * g[j + 1] + g[j + w + 1];
        const gy =
          -g[j - w - 1] - 2 * g[j - w] - g[j - w + 1] +
          g[j + w - 1] + 2 * g[j + w] + g[j + w + 1];
        out[j] = Math.min(255, Math.hypot(gx, gy));
      }
    }
    return out;
  }

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

      /* ---------- v2.2 — full Picasa effects audit ---------- */
      case 'sharpen': {
        const s = ctx.getImageData(0, 0, w, h).data;
        const out = ctx.createImageData(w, h);
        const o = out.data;
        const K = [0, -0.62, 0, -0.62, 3.48, -0.62, 0, -0.62, 0];
        for (let y = 0; y < h; y++) {
          for (let x2 = 0; x2 < w; x2++) {
            const di = (y * w + x2) * 4;
            if (y === 0 || y === h - 1 || x2 === 0 || x2 === w - 1) {
              o[di] = s[di]; o[di + 1] = s[di + 1]; o[di + 2] = s[di + 2]; o[di + 3] = 255;
              continue;
            }
            for (let c = 0; c < 3; c++) {
              let v = 0, ki = 0;
              for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++, ki++) {
                  v += s[((y + ky) * w + (x2 + kx)) * 4 + c] * K[ki];
                }
              }
              o[di + c] = lo256(v);
            }
            o[di + 3] = 255;
          }
        }
        ctx.putImageData(out, 0, 0);
        break;
      }
      case 'tint': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const t = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
            d[i] = lo256(d[i] * 0.55 + (40 + t * 110) * 0.45);
            d[i + 1] = lo256(d[i + 1] * 0.55 + (90 + t * 90) * 0.45);
            d[i + 2] = lo256(d[i + 2] * 0.55 + (150 + t * 60) * 0.45);
          }
        });
        break;
      }
      case 'fbw': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const v = lo256(0.6 * d[i] + 0.36 * d[i + 1] + 0.04 * d[i + 2]);
            d[i] = d[i + 1] = d[i + 2] = v;
          }
        });
        break;
      }
      case 'focalbw': {
        px(ctx, w, h, (d, ww, hh) => {
          const cx2 = ww / 2, cy2 = hh / 2;
          const R = Math.min(ww, hh) * 0.42, F = Math.min(ww, hh) * 0.2;
          for (let y = 0; y < hh; y++) {
            for (let x2 = 0; x2 < ww; x2++) {
              const i = (y * ww + x2) * 4;
              const dist = Math.hypot(x2 - cx2, y - cy2);
              let k = (dist - R) / F;
              k = k < 0 ? 0 : k > 1 ? 1 : k;
              if (k > 0) {
                const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                d[i] = lo256(d[i] * (1 - k) + g * k);
                d[i + 1] = lo256(d[i + 1] * (1 - k) + g * k);
                d[i + 2] = lo256(d[i + 2] * (1 - k) + g * k);
              }
            }
          }
        });
        break;
      }
      case 'gradtint': {
        px(ctx, w, h, (d, ww, hh) => {
          const band = hh * 0.6;
          for (let y = 0; y < hh && y <= band; y++) {
            const t = (1 - y / band) * 0.34;
            for (let x2 = 0; x2 < ww; x2++) {
              const i = (y * ww + x2) * 4;
              d[i] = lo256(d[i] * (1 - t) + 96 * t);
              d[i + 1] = lo256(d[i + 1] * (1 - t) + 145 * t);
              d[i + 2] = lo256(d[i + 2] * (1 - t) + 215 * t);
            }
          }
        });
        break;
      }
      case 'infrared': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const g = d[i + 1], b = d[i + 2];
            d[i] = lo256(255 - b * 0.92);
            d[i + 1] = lo256(g * 1.02 + 14);
            d[i + 2] = lo256(b * 0.6 + 26);
          }
        });
        break;
      }
      case 'lomo': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            for (let k = 0; k < 3; k++) {
              let v = (d[i + k] - 128) * 1.32 + 122;
              v = (v - l) * 1.62 + l;
              d[i + k] = lo256(v);
            }
          }
        });
        const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
        g2.addColorStop(0, 'rgba(0,0,0,0)');
        g2.addColorStop(1, 'rgba(0,0,0,0.62)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'holga': {
        const t = mkCanvas(w, h);
        const tx = t.getContext('2d');
        tx.filter = `blur(${Math.max(2, Math.min(w, h) / 110)}px)`;
        tx.drawImage(ctx.canvas, 0, 0);
        tx.filter = 'none';
        ctx.globalAlpha = 0.4;
        ctx.drawImage(t, 0, 0);
        ctx.globalAlpha = 1;
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = lo256(d[i] * 1.08 + 8);
            d[i + 2] = lo256(d[i + 2] * 0.88);
          }
        });
        const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.74);
        g2.addColorStop(0, 'rgba(0,0,0,0)');
        g2.addColorStop(1, 'rgba(20,10,0,0.5)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'hdrish': {
        const t = mkCanvas(w, h);
        const tx = t.getContext('2d');
        tx.filter = `blur(${Math.max(2, Math.min(w, h) / 130)}px)`;
        tx.drawImage(ctx.canvas, 0, 0);
        tx.filter = 'none';
        const td = tx.getImageData(0, 0, w, h).data;
        const im = ctx.getImageData(0, 0, w, h);
        const d = im.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          for (let k = 0; k < 3; k++) {
            const v = d[i + k] + (d[i + k] - td[i + k]) * 1.75;
            d[i + k] = lo256((v - l) * 1.28 + l);
          }
        }
        ctx.putImageData(im, 0, 0);
        break;
      }
      case 'cinema': {
        const bar = Math.round(h * 0.115);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, bar);
        ctx.fillRect(0, h - bar, w, bar);
        break;
      }
      case 'sixty': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = lo256((d[i] - 128) * 0.86 + 146);
            d[i + 1] = lo256((d[i + 1] - 128) * 0.86 + 130);
            d[i + 2] = lo256((d[i + 2] - 128) * 0.84 + 122);
          }
        });
        const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.8);
        g2.addColorStop(0, 'rgba(0,0,0,0)');
        g2.addColorStop(1, 'rgba(60,30,10,0.32)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'invert': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
          }
        });
        break;
      }
      case 'heatmap': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const t = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
            d[i] = lo256(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3))));
            d[i + 1] = lo256(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2))));
            d[i + 2] = lo256(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1))));
          }
        });
        break;
      }
      case 'posterize': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.round(d[i] / 51) * 51;
            d[i + 1] = Math.round(d[i + 1] / 51) * 51;
            d[i + 2] = Math.round(d[i + 2] / 51) * 51;
          }
        });
        break;
      }
      case 'duotone': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const t = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
            d[i] = lo256(24 + 222 * t);
            d[i + 1] = lo256(38 + 188 * t);
            d[i + 2] = lo256(74 + 106 * t);
          }
        });
        break;
      }
      case 'pixelate': {
        const block = Math.max(4, Math.round(Math.min(w, h) / 46));
        const bw2 = Math.max(1, Math.ceil(w / block)), bh2 = Math.max(1, Math.ceil(h / block));
        const t = mkCanvas(bw2, bh2);
        t.getContext('2d').drawImage(ctx.canvas, 0, 0, bw2, bh2);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(t, 0, 0, bw2, bh2, 0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        break;
      }
      case 'focalzoom': {
        const t = mkCanvas(w, h);
        t.getContext('2d').drawImage(ctx.canvas, 0, 0);
        const cx2 = w / 2, cy2 = h / 2;
        for (let i2 = 1; i2 <= 12; i2++) {
          const s2 = 1 + (i2 / 12) * 0.24;
          ctx.globalAlpha = 0.085;
          ctx.drawImage(t, cx2 - w * s2 / 2, cy2 - h * s2 / 2, w * s2, h * s2);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'sketch': {
        const sd = ctx.getImageData(0, 0, w, h).data;
        const gray = new Uint8ClampedArray(w * h);
        for (let i2 = 0, j = 0; i2 < sd.length; i2 += 4, j++) {
          gray[j] = (0.299 * sd[i2] + 0.587 * sd[i2 + 1] + 0.114 * sd[i2 + 2]) | 0;
        }
        const t = mkCanvas(w, h);
        const t0 = t.getContext('2d');
        const ti = t0.createImageData(w, h);
        for (let j = 0; j < gray.length; j++) {
          const k4 = j * 4;
          const v = 255 - gray[j];
          ti.data[k4] = ti.data[k4 + 1] = ti.data[k4 + 2] = v;
          ti.data[k4 + 3] = 255;
        }
        t0.putImageData(ti, 0, 0);
        const t2 = mkCanvas(w, h);
        const t2x = t2.getContext('2d');
        t2x.filter = `blur(${Math.max(3, Math.min(w, h) / 90)}px)`;
        t2x.drawImage(t, 0, 0);
        t2x.filter = 'none';
        const bd = t2x.getImageData(0, 0, w, h).data;
        const out = ctx.createImageData(w, h);
        const o = out.data;
        for (let j = 0; j < gray.length; j++) {
          const k4 = j * 4;
          const v = Math.min(255, (gray[j] * 255) / Math.max(1, 256 - bd[k4]));
          o[k4] = o[k4 + 1] = o[k4 + 2] = v;
          o[k4 + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        break;
      }
      case 'neon': {
        const ed2 = sobelEdges(ctx, w, h);
        const im = ctx.createImageData(w, h);
        const o = im.data;
        for (let j = 0; j < ed2.length; j++) {
          const v = ed2[j] / 255;
          const k4 = j * 4;
          o[k4] = lo256(30 + v * 60);
          o[k4 + 1] = lo256(120 + v * 135);
          o[k4 + 2] = lo256(180 + v * 75);
          o[k4 + 3] = 255;
        }
        ctx.fillStyle = '#04060c';
        ctx.fillRect(0, 0, w, h);
        const t = mkCanvas(w, h);
        t.getContext('2d').putImageData(im, 0, 0);
        ctx.drawImage(t, 0, 0);
        const t2 = mkCanvas(w, h);
        const t2x = t2.getContext('2d');
        t2x.filter = `blur(${Math.max(3, Math.min(w, h) / 80)}px)`;
        t2x.drawImage(t, 0, 0);
        t2x.filter = 'none';
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.85;
        ctx.drawImage(t2, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'comic': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            for (let k = 0; k < 3; k++) {
              const v = (d[i + k] - l) * 1.35 + l;
              d[i + k] = Math.round(lo256(v) / 64) * 64;
            }
          }
        });
        const ed2 = sobelEdges(ctx, w, h);
        const im = ctx.getImageData(0, 0, w, h);
        const d = im.data;
        for (let j = 0; j < ed2.length; j++) {
          if (ed2[j] > 96) {
            const k4 = j * 4;
            d[k4] = d[k4 + 1] = d[k4 + 2] = lo256(d[k4] * 0.15);
          }
        }
        ctx.putImageData(im, 0, 0);
        break;
      }
      case 'stamp': {
        px(ctx, w, h, (d) => {
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const n = (Math.random() - 0.5) * 22;
            const v = lo256((l - 128) * 1.9 + 128 + n);
            d[i] = v;
            d[i + 1] = lo256(v * 0.16);
            d[i + 2] = lo256(v * 0.14);
          }
        });
        const bw3 = Math.min(w, h) * 0.035;
        ctx.strokeStyle = 'rgba(180,30,30,.75)';
        ctx.lineWidth = bw3;
        ctx.strokeRect(bw3 / 2 + 4, bw3 / 2 + 4, w - bw3 - 8, h - bw3 - 8);
        break;
      }
      case 'border': {
        const t = Math.min(w, h) * 0.035;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, t);
        ctx.fillRect(0, h - t, w, t);
        ctx.fillRect(0, 0, t, h);
        ctx.fillRect(w - t, 0, t, h);
        ctx.strokeStyle = 'rgba(0,0,0,.28)';
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.004);
        ctx.strokeRect(t, t, w - t * 2, h - t * 2);
        break;
      }
      case 'dropshadow': {
        const t = mkCanvas(w, h);
        t.getContext('2d').drawImage(ctx.canvas, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        const m = Math.min(w, h) * 0.045;
        const dw2 = w - m * 2.4, dh2 = h - m * 2.4;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.45)';
        ctx.shadowBlur = m * 0.9;
        ctx.shadowOffsetY = m * 0.18;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(m * 0.7, m * 0.55, dw2, dh2);
        ctx.restore();
        ctx.drawImage(t, m * 0.7, m * 0.55, dw2, dh2);
        break;
      }
      case 'matte': {
        const t = mkCanvas(w, h);
        t.getContext('2d').drawImage(ctx.canvas, 0, 0);
        ctx.fillStyle = '#f6f2e8';
        ctx.fillRect(0, 0, w, h);
        const m = Math.min(w, h) * 0.11;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.35)';
        ctx.shadowBlur = m * 0.5;
        ctx.fillStyle = '#f6f2e8';
        ctx.fillRect(m, m, w - m * 2, h - m * 2);
        ctx.restore();
        ctx.drawImage(t, m, m, w - m * 2, h - m * 2);
        ctx.strokeStyle = 'rgba(0,0,0,.18)';
        ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.003);
        ctx.strokeRect(m, m, w - m * 2, h - m * 2);
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

  /* ---------- main renderer ----------
     stickers: optional Map(sid -> ImageBitmap/canvas) — for 'sticker' ops */
  function renderStack(src, ops, adj, maxSide, stickers) {
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
          cx.save();
          cx.globalAlpha = op.alpha == null ? 1 : Math.max(0.05, Math.min(1, op.alpha));
          cx.translate(op.x * acc.width, op.y * acc.height);
          if (op.rot) cx.rotate((op.rot * Math.PI) / 180);
          const fs = Math.max(6, (op.size / 100) * acc.height);
          cx.font = `${op.italic ? 'italic ' : ''}${op.bold ? '700' : '400'} ${fs}px ${op.font || '"Segoe UI", sans-serif'}`;
          cx.textBaseline = 'middle';
          cx.textAlign = op.align || 'center';
          if (op.shadow) {
            cx.shadowColor = 'rgba(0,0,0,.55)';
            cx.shadowBlur = acc.height * 0.008;
            cx.shadowOffsetY = acc.height * 0.003;
          }
          cx.fillStyle = op.color || '#ffffff';
          const lines = String(op.text || '').split('\n');
          const lh = fs * 1.22;
          const y0 = -((lines.length - 1) * lh) / 2;
          lines.forEach((ln, li) => {
            if (op.strokeW > 0) {
              cx.lineWidth = Math.max(1, op.strokeW * fs * 0.09);
              cx.strokeStyle = op.stroke || '#000000';
              cx.lineJoin = 'round';
              cx.strokeText(ln, 0, y0 + li * lh);
            }
            cx.fillText(ln, 0, y0 + li * lh);
          });
          cx.restore();
          break;
        }
        case 'sticker': {
          const bmp = stickers ? stickers.get(op.sid) : null;
          if (!bmp) break;
          const dh = Math.max(8, (op.scale || 0.3) * acc.height);
          const dw = dh * ((bmp.width || bmp.naturalWidth) / (bmp.height || bmp.naturalHeight));
          cx.save();
          cx.globalAlpha = op.alpha == null ? 1 : Math.max(0.05, Math.min(1, op.alpha));
          cx.translate(op.x * acc.width, op.y * acc.height);
          if (op.rot) cx.rotate((op.rot * Math.PI) / 180);
          cx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
          cx.restore();
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

  /* ---------- alpha detect (transparent PNG save ke liye) ---------- */
  function hasAlpha(cv) {
    try {
      const mn = Math.min(cv.width, cv.height);
      if (!mn) return false;
      const sc = Math.min(1, 260 / mn);
      const t = mkCanvas(Math.max(1, cv.width * sc), Math.max(1, cv.height * sc));
      const tx = t.getContext('2d');
      tx.drawImage(cv, 0, 0, t.width, t.height);
      const d = tx.getImageData(0, 0, t.width, t.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) {}
    return false;
  }

  window.PixsaFX = { EFFECTS, renderStack, computeLevels, computeWB, redeyePt, retouchPt, mkCanvas, hasAlpha };
})();
