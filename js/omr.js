/*
 * Optical mark recognition for sheets produced by sheet.js.
 *
 * Pipeline: grayscale → adaptive threshold → locate the 4 corner squares →
 * perspective transform (frame mm → pixels) → read the layout code → measure
 * how dark the inside of every bubble is → choose marks with a per-page
 * threshold.
 */
(function (g) {
  'use strict';
  const L = g.Layout;

  function toGray(imageData) {
    const { width: w, height: h, data } = imageData;
    const out = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      out[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    }
    return { w, h, data: out };
  }

  function rotate180(gray) {
    const out = new Uint8ClampedArray(gray.data.length);
    for (let i = 0, n = out.length; i < n; i++) out[i] = gray.data[n - 1 - i];
    return { w: gray.w, h: gray.h, data: out };
  }

  // ---------- perspective transform ----------

  function solve(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = s / A[r][r];
    }
    return x;
  }

  /** Homography mapping src[i] → dst[i] (4 point pairs). */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h && [...h, 1];
  }

  function apply(H, x, y) {
    const d = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
  }

  // ---------- corner squares ----------

  function adaptiveBinary(gray) {
    const { w, h, data } = gray;
    const W = w + 1;
    const ii = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += data[y * w + x];
        ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + row;
      }
    }
    const R = Math.max(8, Math.round(Math.min(w, h) * 0.06));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
        const sum = ii[y1 * W + x1] - ii[y0 * W + x1] - ii[y1 * W + x0] + ii[y0 * W + x0];
        const mean = sum / ((y1 - y0) * (x1 - x0));
        const p = data[y * w + x];
        if (p < mean * 0.72 && p < 200) bin[y * w + x] = 1;
      }
    }
    return bin;
  }

  function findSquareIn(gray, bin, labels, rx0, ry0, rx1, ry1, cornerX, cornerY) {
    const { w, data } = gray;
    const minSide = w * 0.015, maxSide = w * 0.09;
    const stack = [];
    let best = null;
    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        const i0 = y * w + x;
        if (!bin[i0] || labels[i0]) continue;
        labels[i0] = 1;
        stack.push(i0);
        let n = 0, sx = 0, sy = 0, sg = 0, minx = x, maxx = x, miny = y, maxy = y;
        while (stack.length) {
          const i = stack.pop();
          const px = i % w, py = (i - px) / w;
          n++; sx += px; sy += py; sg += data[i];
          if (px < minx) minx = px; if (px > maxx) maxx = px;
          if (py < miny) miny = py; if (py > maxy) maxy = py;
          if (px > rx0 && bin[i - 1] && !labels[i - 1]) { labels[i - 1] = 1; stack.push(i - 1); }
          if (px < rx1 - 1 && bin[i + 1] && !labels[i + 1]) { labels[i + 1] = 1; stack.push(i + 1); }
          if (py > ry0 && bin[i - w] && !labels[i - w]) { labels[i - w] = 1; stack.push(i - w); }
          if (py < ry1 - 1 && bin[i + w] && !labels[i + w]) { labels[i + w] = 1; stack.push(i + w); }
        }
        const bw = maxx - minx + 1, bh = maxy - miny + 1;
        const side = Math.max(bw, bh);
        if (side < minSide || side > maxSide) continue;
        if (Math.min(bw, bh) / side < 0.7) continue;
        if (n / (bw * bh) < 0.8) continue;
        const cx = sx / n, cy = sy / n;
        const dist = Math.hypot(cx - cornerX, cy - cornerY);
        // Prefer big squares; break ties toward the page corner.
        const score = n - dist * 0.01;
        if (!best || score > best.score) best = { x: cx, y: cy, n, side, gray: sg / n, score };
      }
    }
    return best;
  }

  function findFiducials(gray) {
    const { w, h } = gray;
    const bin = adaptiveBinary(gray);
    const labels = new Uint8Array(w * h);
    const rw = Math.round(w * 0.36), rh = Math.round(h * 0.3);
    const found = [
      findSquareIn(gray, bin, labels, 0, 0, rw, rh, 0, 0),
      findSquareIn(gray, bin, labels, w - rw, 0, w, rh, w, 0),
      findSquareIn(gray, bin, labels, 0, h - rh, rw, h, 0, h),
      findSquareIn(gray, bin, labels, w - rw, h - rh, w, h, w, h),
    ];
    if (found.some((f) => !f)) return null;
    const [tl, tr, bl, br] = found;
    const top = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const bottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    const left = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const right = Math.hypot(br.x - tr.x, br.y - tr.y);
    const ratio = (left + right) / (top + bottom);
    const expected = L.FRAME_H / L.FRAME_W;
    if (ratio < expected * 0.8 || ratio > expected * 1.25) return null;
    if (Math.min(top, bottom) / Math.max(top, bottom) < 0.75) return null;
    return found;
  }

  // ---------- sampling ----------

  function sampleGray(gray, x, y) {
    const { w, h, data } = gray;
    if (x < 0 || y < 0 || x > w - 2 || y > h - 2) return 255;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    const a = data[i] + (data[i + 1] - data[i]) * fx;
    const b = data[i + w] + (data[i + w + 1] - data[i + w]) * fx;
    return a + (b - a) * fy;
  }

  // Offsets (mm) of sample points inside a disc of the given radius.
  function discOffsets(radius, step) {
    const pts = [];
    for (let dy = -radius; dy <= radius + 1e-9; dy += step)
      for (let dx = -radius; dx <= radius + 1e-9; dx += step)
        if (dx * dx + dy * dy <= radius * radius) pts.push([dx, dy]);
    return pts;
  }
  const BUBBLE_PTS = discOffsets(L.BUBBLE_R * 0.62, 0.22);
  const CODE_PTS = discOffsets(L.CODE_SIZE * 0.3, 0.3);

  /**
   * How dark the inside of a bubble is (0 = paper, 1 = corner-square black).
   * Uses the level that 40% of the samples are darker than, rather than the
   * mean. The printed letter covers well under 40% of the inside, so it does
   * not count, while a real mark covering about half the bubble or more does.
   */
  function darkness(gray, H, pts, cx, cy, white, black) {
    const vals = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const [u, v] = apply(H, cx + pts[i][0], cy + pts[i][1]);
      vals[i] = sampleGray(gray, u, v);
    }
    vals.sort();
    const g = vals[Math.floor(vals.length * 0.4)];
    return Math.max(0, Math.min(1, (white - g) / Math.max(20, white - black)));
  }

  function whiteLevel(gray, fid) {
    const xs = fid.map((f) => f.x), ys = fid.map((f) => f.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(gray.w, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(gray.h, Math.ceil(Math.max(...ys)));
    const hist = new Uint32Array(256);
    let n = 0;
    for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { hist[gray.data[y * gray.w + x]]++; n++; }
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.9) return v; }
    return 255;
  }

  function percentile(values, p) {
    const v = values.slice().sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : 0;
  }

  function otsu(values) {
    const bins = 100, hist = new Array(bins).fill(0);
    for (const v of values) hist[Math.min(bins - 1, Math.floor(v * bins))]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < bins; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 40;
    for (let i = 0; i < bins; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; t = i; }
    }
    return (t + 1) / bins;
  }

  /**
   * Decide which bubbles in one group are marked.
   * @returns {{marked:number[], flag:string|null}}
   */
  function decide(fills, T, allowMany) {
    const order = fills.map((f, i) => i).sort((a, b) => fills[b] - fills[a]);
    let marked = order.filter((i) => fills[i] >= T);
    let flag = null;
    if (marked.length > 1 && !allowMany) {
      const top = fills[order[0]], second = fills[order[1]];
      if (top - second >= 0.3 && second < T + 0.15) {
        marked = [order[0]];
        flag = 'erasure';
      } else {
        flag = 'multiple';
      }
    }
    if (!flag && fills.some((f) => Math.abs(f - T) < 0.07)) flag = 'faint';
    return { marked: marked.sort((a, b) => a - b), flag };
  }

  /**
   * Turn per-bubble fill values into answers / ID given a threshold.
   * @param multi  Set of 1-based question numbers where several marks are expected
   *               ("select all that apply"), so extra marks are kept and not flagged.
   */
  function interpret(read, T, multi) {
    const answers = [], flags = [];
    read.qFills.forEach((fills, q) => {
      const { marked, flag } = decide(fills, T, multi && multi.has(q + 1));
      answers.push(marked.map((i) => L.LETTERS[i]).join(''));
      if (flag) flags.push({ q: q + 1, type: flag });
    });
    let id = '';
    let idProblem = false;
    for (const fills of read.idFills) {
      const { marked } = decide(fills, T);
      if (marked.length === 1) id += String(marked[0]);
      else if (marked.length > 1) { id += '?'; idProblem = true; }
    }
    let initial = '';
    if (read.initFills) {
      const { marked } = decide(read.initFills, T);
      if (marked.length === 1) initial = L.INITIALS[marked[0]];
      else if (marked.length > 1) { initial = '?'; idProblem = true; }
    }
    return { answers, flags, studentId: id, initial, idProblem };
  }

  /**
   * Read a sheet image.
   * @param gray   {w,h,data} grayscale image
   * @param fallbackCfg  exam configuration to use if the layout code cannot be read
   */
  function readSheet(gray, fallbackCfg) {
    const attempt = (img, rotated) => {
      const fid = findFiducials(img);
      if (!fid) return null;
      const H = homography(L.fiducials, fid.map((f) => [f.x, f.y]));
      if (!H) return null;
      const white = whiteLevel(img, fid);
      const black = fid.reduce((s, f) => s + f.gray, 0) / 4;
      const bits = [];
      for (let i = 0; i < L.CODE_BITS; i++) {
        const x = L.CODE_X0 + i * L.CODE_DX;
        bits.push(darkness(img, H, CODE_PTS, x, 0, white, black) > 0.5 ? 1 : 0);
      }
      return { img, rotated, fid, H, white, black, cfg: L.decodeCode(bits) };
    };

    let r = attempt(gray, false);
    if (!r || !r.cfg) {
      const r2 = attempt(rotate180(gray), true);
      if (r2 && r2.cfg) r = r2;
    }
    if (!r) throw new Error('Could not find the four black corner squares. Make sure the whole sheet is visible and upright.');
    const warnings = [];
    let cfg = r.cfg;
    if (!cfg) {
      if (!fallbackCfg) throw new Error('Could not read the layout code along the top edge of the sheet.');
      cfg = fallbackCfg;
      warnings.push('Layout code unreadable; used the exam settings instead.');
    }
    const layout = L.build(cfg);
    const { img, H, white, black } = r;
    const qFills = layout.questions.map((q) => q.bubbles.map((b) => darkness(img, H, BUBBLE_PTS, b.x, b.y, white, black)));
    const idFills = layout.id.map((c) => c.bubbles.map((b) => darkness(img, H, BUBBLE_PTS, b.x, b.y, white, black)));
    let initFills = layout.initials.map((b) => darkness(img, H, BUBBLE_PTS, b.x, b.y, white, black));
    // Subtract the blank level (printed letter/digit + paper tone) measured on this page.
    // For each answer letter, most questions leave it blank, so a low percentile over
    // the questions is that letter's empty-bubble darkness.
    const adjust = (v, base) => Math.max(0, (v - base) / (1 - base));
    if (qFills.length >= 8) {
      for (let i = 0; i < cfg.numChoices; i++) {
        const base = Math.min(0.35, percentile(qFills.map((f) => f[i]), 0.3));
        qFills.forEach((f) => { f[i] = adjust(f[i], base); });
      }
    }
    const idBase = Math.min(0.35, percentile(idFills.flat().concat(initFills), 0.3));
    idFills.forEach((col) => col.forEach((v, d) => { col[d] = adjust(v, idBase); }));
    initFills = initFills.map((v) => adjust(v, idBase));
    const keyBits = layout.keyStrip.map((p) => (darkness(img, H, CODE_PTS, p.x, p.y, white, black) > 0.5 ? 1 : 0));
    const key = L.decodeKey(keyBits);
    if (key === null) warnings.push('Student code strip at the bottom edge is damaged; matched by name.# instead.');
    const all = qFills.flat().concat(idFills.flat(), initFills);
    const autoT = Math.max(0.3, Math.min(0.6, otsu(all)));
    return {
      cfg, H, rotated: r.rotated, warnings, autoThreshold: autoT,
      qFills: qFills.map((a) => a.map((v) => Math.round(v * 1000) / 1000)),
      idFills: idFills.map((a) => a.map((v) => Math.round(v * 1000) / 1000)),
      initFills: initFills.map((v) => Math.round(v * 1000) / 1000),
      key: key || 0,
      fiducials: r.fid.map((f) => [f.x, f.y]),
    };
  }

  g.OMR = { toGray, rotate180, readSheet, interpret, homography, apply };
})(typeof window !== 'undefined' ? window : globalThis);
