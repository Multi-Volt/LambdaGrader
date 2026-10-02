/* Bubble sheet PDF generation (jsPDF, vector output). */
(function (g) {
  'use strict';
  const L = g.Layout;

  function fitText(doc, text, maxWidth, size, minSize) {
    let s = size;
    doc.setFontSize(s);
    while (s > minSize && doc.getTextWidth(text) > maxWidth) doc.setFontSize(--s);
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }


  const COLOR_NAMES = {
    black: '#000000', red: '#c81e1e', orange: '#d9670b', green: '#15803d', blue: '#1a56db',
    purple: '#7e22ce', gray: '#555555', grey: '#555555',
  };

  function parseColor(c) {
    c = String(c || '').trim().toLowerCase();
    if (COLOR_NAMES[c]) c = COLOR_NAMES[c];
    let m = /^#([0-9a-f]{6})$/.exec(c) || /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
    if (!m) return null;
    const hex = m.length === 2 ? m[1] : m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }

  /** "Midterm {red|Answer Sheet}" -> [{t, rgb}] ; rgb null means the field's own color. */
  function parseRich(text) {
    const out = [];
    let last = 0, m;
    const re = /\{([^{}|]+)\|([^{}]*)\}/g;
    const plain = (t) => { if (t) out.push({ t, rgb: null }); };
    while ((m = re.exec(text))) {
      const rgb = parseColor(m[1]);
      if (!rgb) continue;   // not a color: leave the braces as typed
      plain(text.slice(last, m.index));
      if (m[2]) out.push({ t: m[2], rgb });
      last = re.lastIndex;
    }
    plain(text.slice(last));
    return out;
  }

  /**
   * Draw text that may contain {color|part} segments, shrunk (then truncated) to
   * fit maxWidth. The font and base color come from the caller / `color`.
   */
  function drawRich(doc, text, x, y, o) {
    const segs = parseRich(text);
    const width = () => segs.reduce((w, sg) => w + doc.getTextWidth(sg.t), 0);
    let size = o.size;
    doc.setFontSize(size);
    while (size > o.minSize && width() > o.maxWidth) doc.setFontSize(--size);
    while (width() > o.maxWidth && segs.length) {
      const sg = segs[segs.length - 1];
      sg.t = sg.t.replace(/…$/, '').slice(0, -1);
      if (!sg.t) segs.pop(); else sg.t += '…';
    }
    let cx = o.align === 'right' ? x - width() : o.align === 'center' ? x - width() / 2 : x;
    for (const sg of segs) {
      const rgb = sg.rgb || o.color || [0, 0, 0];
      doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(sg.t, cx, y, { baseline: o.baseline });
      cx += doc.getTextWidth(sg.t);
    }
    doc.setTextColor(0);
  }

  /** Break rich text into word tokens [{t, rgb}] (spaces kept as their own tokens). */
  function richTokens(text) {
    const out = [];
    for (const sg of parseRich(text)) for (const t of sg.t.split(/(\s+)/)) if (t) out.push({ t, rgb: sg.rgb });
    return out;
  }

  /**
   * Wrap rich text into at most maxLines lines no wider than maxWidth, using the
   * largest size from `size` down to `minSize` that fits. The font must be set.
   * @returns {{lines: {t,rgb}[][], size: number}}
   */
  function layoutRich(doc, text, size, minSize, maxWidth, maxLines) {
    const toks = richTokens(text);
    const wrap = () => {
      const lines = [[]];
      let w = 0, tooWide = false;
      for (const tk of toks) {
        const tw = doc.getTextWidth(tk.t), isSpace = /^\s+$/.test(tk.t);
        const line = lines[lines.length - 1];
        if (isSpace && !line.length) continue;
        if (!isSpace && tw > maxWidth) tooWide = true;
        if (!isSpace && line.length && w + tw > maxWidth) {
          while (line.length && /^\s+$/.test(line[line.length - 1].t)) line.pop();
          lines.push([tk]); w = tw;
        } else { line.push(tk); w += tw; }
      }
      const last = lines[lines.length - 1];
      while (last.length && /^\s+$/.test(last[last.length - 1].t)) last.pop();
      return { lines, tooWide };
    };
    let sz = size, r;
    for (;;) {
      doc.setFontSize(sz);
      r = wrap();
      if (!r.tooWide && r.lines.length <= maxLines) return { lines: r.lines, size: sz };
      if (sz <= minSize) break;
      sz = Math.max(minSize, sz - 0.5);
    }
    // Still too big at the minimum size: keep the first lines, shorten the last with an ellipsis.
    const lines = r.lines.slice(0, maxLines);
    const lastLine = lines[lines.length - 1];
    const width = () => lastLine.reduce((a, tk) => a + doc.getTextWidth(tk.t), 0);
    while (lastLine.length && (width() > maxWidth || r.lines.length > maxLines)) {
      const tk = lastLine[lastLine.length - 1];
      tk.t = tk.t.replace(/…$/, '').slice(0, -1);
      if (!tk.t) lastLine.pop(); else tk.t += '…';
      if (width() <= maxWidth) break;
    }
    return { lines, size: sz };
  }

  function drawTokens(doc, tokens, x, y, align, baseColor) {
    // Draw each same-colored run as one string so spacing and kerning stay natural.
    const runs = [];
    for (const tk of tokens) {
      const last = runs[runs.length - 1];
      if (last && last.rgb === tk.rgb) last.t += tk.t; else runs.push({ t: tk.t, rgb: tk.rgb });
    }
    const width = runs.reduce((a, r) => a + doc.getTextWidth(r.t), 0);
    let cx = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    for (const r of runs) {
      const c = r.rgb || baseColor || [0, 0, 0];
      doc.setTextColor(c[0], c[1], c[2]);
      doc.text(r.t, cx, y);
      cx += doc.getTextWidth(r.t);
    }
    doc.setTextColor(0);
  }

  function drawPage(doc, layout, ox, oy, opts) {
    const { title, subtitle, className, headerRight, pageNum, showLogo, colors, sizes, student, pageLabel } = opts;
    const col = (k) => parseColor(colors && colors[k]) || [0, 0, 0];
    const DEFAULT_SIZES = { title: 20, subtitle: 11, className: 10, headerRight: 10, pageNum: 10 };
    const sz = (k) => Math.max(6, Math.min(40, Number(sizes && sizes[k]) || DEFAULT_SIZES[k]));
    const { numQuestions, numChoices, idDigits } = layout.cfg;
    const X = (x) => ox + x;
    const Y = (y) => oy + y;
    const half = L.FIDUCIAL / 2;

    doc.setTextColor(0);
    doc.setDrawColor(0);
    doc.setFillColor(0, 0, 0);

    // Corner squares and layout code.
    for (const [fx, fy] of L.fiducials) doc.rect(X(fx - half), Y(fy - half), L.FIDUCIAL, L.FIDUCIAL, 'F');
    for (const c of layout.code) {
      if (c.bit) doc.rect(X(c.x - L.CODE_SIZE / 2), Y(c.y - L.CODE_SIZE / 2), L.CODE_SIZE, L.CODE_SIZE, 'F');
    }

    // Student code strip (personalised sheets only).
    if (student && student.key) {
      L.encodeKey(student.key).forEach((bit, i) => {
        const p = layout.keyStrip[i];
        if (bit) doc.rect(X(p.x - L.CODE_SIZE / 2), Y(p.y - L.CODE_SIZE / 2), L.CODE_SIZE, L.CODE_SIZE, 'F');
      });
    }

    // LambdaGrader logo on the bottom edge, clear of the student code strip and corner squares.
    if (showLogo) {
      const lx = X(144), ly = Y(L.FRAME_H);
      if (g.LOGO_PNG) doc.addImage(g.LOGO_PNG, 'PNG', lx - 3.3, ly - 3.3, 6.6, 6.6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('LambdaGrader', X(149), ly + 0.1, { baseline: 'middle' });
      doc.setFont('helvetica', 'normal');
    }

    // Optional header text on the code-row line: class name between the top-left
    // square and the layout code, free text between the code and the top-right square.
    doc.setFont('helvetica', 'bold');
    if (className) drawRich(doc, className, X(half + 2), Y(0), { size: sz('className'), minSize: 6, maxWidth: 22, baseline: 'middle', color: col('className') });
    if (headerRight) drawRich(doc, headerRight, X(L.FRAME_W - half - 2), Y(0), { size: sz('headerRight'), minSize: 6, maxWidth: 42, align: 'right', baseline: 'middle', color: col('headerRight') });
    doc.setFont('helvetica', 'normal');

    // Optional page number above the bottom-right corner square.
    if (pageNum) {
      drawRich(doc, String(pageNum), X(L.FRAME_W + half), Y(L.FRAME_H - half - 3), { size: sz('pageNum'), minSize: 6, maxWidth: 30, align: 'right', baseline: 'middle', color: col('pageNum') });
    }

    const leftW = idDigits ? layout.idX0 - 14 : L.FRAME_W;

    // Title and subtitle, centered on the page (or on the area left of the ID box when that is too narrow).
    // They wrap to two lines if needed and the pair is scaled down to stay clear of the Name line.
    let midX = L.FRAME_W / 2, textW = L.FRAME_W - 16;
    if (idDigits) {
      textW = 2 * (leftW - midX);
      if (textW < leftW * 0.7) { midX = leftW / 2; textW = leftW; }
    }
    const MM = 0.3528, TOP = 4.5, LIMIT = 22.5;
    const titleText = title || 'Multiple Choice Exam';
    let blk;
    for (let f = 1; ; f -= 0.05) {
      doc.setFont('helvetica', 'bold');
      const tl = layoutRich(doc, titleText, sz('title') * f, 6, textW, 2);
      let sl = null;
      if (subtitle) {
        doc.setFont('helvetica', 'normal');
        sl = layoutRich(doc, subtitle, sz('subtitle') * f, 6, textW, 2);
      }
      const tMm = tl.size * MM, sMm = sl ? sl.size * MM : 0;
      const t0 = TOP + 0.74 * tMm, tEnd = t0 + (tl.lines.length - 1) * 1.15 * tMm;
      const s0 = tEnd + 0.3 * tMm + 1.8 + 0.74 * sMm;
      const end = sl ? s0 + (sl.lines.length - 1) * 1.15 * sMm + 0.25 * sMm : tEnd + 0.25 * tMm;
      blk = { tl, sl, t0, s0, tMm, sMm };
      if (end <= LIMIT || f <= 0.4) break;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(blk.tl.size);
    blk.tl.lines.forEach((ln, i) => drawTokens(doc, ln, X(midX), Y(blk.t0 + i * 1.15 * blk.tMm), 'center', col('title')));
    if (blk.sl) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(blk.sl.size);
      blk.sl.lines.forEach((ln, i) => drawTokens(doc, ln, X(midX), Y(blk.s0 + i * 1.15 * blk.sMm), 'center', col('subtitle')));
    }

    // Name, name.# and section lines, spaced out so there is room to write.
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setLineWidth(0.25);
    doc.text('Name', X(0), Y(26));
    doc.line(X(11), Y(26.8), X(leftW), Y(26.8));
    const split = leftW * 0.5;
    doc.text('Name.#', X(0), Y(35));
    doc.line(X(13.5), Y(35.8), X(split), Y(35.8));
    doc.text('Section', X(split + 3), Y(35));
    doc.line(X(split + 16), Y(35.8), X(leftW), Y(35.8));
    if (student) {
      doc.setFont('helvetica', 'bold');
      doc.text(fitText(doc, student.name || '', leftW - 13, 12, 7), X(12), Y(25.8));
      if (student.id) doc.text(fitText(doc, student.id, split - 16, 11, 7), X(15), Y(34.8));
      doc.setFont('helvetica', 'normal');
      if (student.section) doc.text(fitText(doc, student.section, leftW - split - 18, 10, 7), X(split + 17), Y(34.8));
    }

    // Fill example.
    doc.setFontSize(7);
    doc.setTextColor(40);
    doc.text('Fill bubbles like this:', X(0), Y(41.1));
    doc.setFillColor(0, 0, 0);
    doc.circle(X(0) + doc.getTextWidth('Fill bubbles like this:') + 3, Y(40.4), L.BUBBLE_R, 'F');
    doc.text('Use a dark pencil or black/blue pen.', X(0), Y(45.2));
    doc.setTextColor(0);

    // Instructions.
    doc.setDrawColor(60);
    doc.setLineWidth(0.2);
    doc.roundedRect(X(0), Y(47.5), leftW, 19.5, 1.5, 1.5, 'S');
    doc.setFont('helvetica', 'normal');
    const lines = [
      'Fill each bubble completely. Mark one answer per question unless it says "select all that apply".',
      student ? `Your name${idDigits ? ' and name.# number are' : ' is'} pre-filled. Do not change them.`
        : `Write your name and name.# above.${idDigits ? ' Bubble its number at right.' : ''}`,
      'Erase changes completely. Do not fold this sheet.',
      'Do not write on or near the black squares.',
    ];
    lines.forEach((t, i) => {
      const fitted = fitText(doc, t, leftW - 6, 7.5, 5.5);
      doc.text(fitted, X(3), Y(52 + i * 4.2));
    });

    // Student ID grid.
    if (idDigits) {
      const top = L.ID_BOX_TOP;
      const x0 = layout.idX0 - L.ID_DX / 2;
      const w = idDigits * L.ID_DX;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(fitText(doc, 'NAME.# NUMBER', w + 4, 8, 5.5), X(x0 + w / 2 - 2.25), Y(top - 2), { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      const idStr = student && student.num ? String(student.num).padStart(idDigits, '0') : '';
      layout.id.forEach((col, j) => {
        doc.rect(X(col.x - L.ID_DX / 2), Y(top), L.ID_DX, L.ID_BOX_H, 'S');
        if (idStr) {
          doc.setFontSize(10);
          doc.text(idStr[j], X(col.x), Y(top + L.ID_BOX_H / 2), { align: 'center', baseline: 'middle' });
        }
      });
      doc.setDrawColor(60);
      doc.rect(X(x0 - 5), Y(top - 5.5), w + 5.5, L.ID_TOP + 9 * L.ID_DY + 3 - (top - 5.5), 'S');
      doc.setFontSize(7);
      doc.setTextColor(40);
      for (let d = 0; d < 10; d++) doc.text(String(d), X(x0 - 2.5), Y(L.ID_TOP + d * L.ID_DY), { align: 'center', baseline: 'middle' });
      doc.setTextColor(0);
      layout.id.forEach((col, j) => {
        col.bubbles.forEach((b, d) => {
          const filled = idStr && Number(idStr[j]) === d;
          bubble(doc, X(b.x), Y(b.y), filled ? null : String(d), filled);
        });
      });
    }

    // Divider.
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    doc.line(X(0), Y(69), X(L.FRAME_W), Y(69));

    // Questions.
    for (const q of layout.questions) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(0);
      doc.text(String(q.number), X(q.labelX), Y(q.y), { align: 'right', baseline: 'middle' });
      doc.setFont('helvetica', 'normal');
      q.bubbles.forEach((b, i) => bubble(doc, X(b.x), Y(b.y), L.LETTERS[i], false));
    }

    // Footer.
    doc.setFontSize(6.5);
    doc.setTextColor(60);
    const footer = [student ? `${student.name}${student.id ? ` (${student.id})` : ''}` : null,
      `${numQuestions} questions, choices ${L.LETTERS[0]} to ${L.LETTERS[numChoices - 1]}`, pageLabel]
      .filter(Boolean).join('  ·  ');
    doc.text(footer, X(L.FRAME_W / 2), Y(layout.lastRowY + 8), { align: 'center' });
    doc.setTextColor(0);
  }

  // High-contrast bubbles: thick black outline and AA-contrast letters.
  function bubble(doc, cx, cy, label, filled) {
    doc.setLineWidth(0.35);
    doc.setDrawColor(0);
    if (filled) {
      doc.setFillColor(0, 0, 0);
      doc.circle(cx, cy, L.BUBBLE_R, 'FD');
      return;
    }
    doc.circle(cx, cy, L.BUBBLE_R, 'S');
    if (label) {
      doc.setFontSize(6);
      doc.setTextColor(112);  // #707070: 4.9:1 on white (WCAG AA) but light enough not to read as a mark
      doc.text(label, cx, cy + 0.08, { align: 'center', baseline: 'middle' });
      doc.setTextColor(0);
    }
  }

  /**
   * @param {object} exam   {title, numQuestions, numChoices, idDigits, paper}
   * @param {object} opts   {students?: [{id,name,section}], copies?: number, onProgress?}
   * @returns {Promise<Blob>}
   */
  async function generate(exam, opts) {
    const { jsPDF } = g.jspdf;
    const paper = L.PAPER[exam.paper] ? exam.paper : 'letter';
    const [pw, ph] = L.PAPER[paper];
    const doc = new jsPDF({ unit: 'mm', format: paper, orientation: 'portrait', compress: true });
    doc.setProperties({ title: `${exam.name || plain(exam.title) || 'Exam'} bubble sheets`, creator: 'LambdaGrader' });
    const layout = L.build(exam);
    const ox = (pw - L.FRAME_W) / 2;
    const oy = (ph - L.FRAME_H) / 2;
    const pages = opts.students ? opts.students.map((s) => ({ student: s })) : Array.from({ length: opts.copies || 1 }, () => ({}));
    for (let i = 0; i < pages.length; i++) {
      if (i) doc.addPage(paper, 'portrait');
      drawPage(doc, layout, ox, oy, { title: exam.title, subtitle: exam.subtitle, className: exam.className, headerRight: exam.headerRight, pageNum: exam.pageNum, showLogo: exam.showLogo !== false, colors: exam.colors, sizes: exam.sizes, student: pages[i].student, pageLabel: `Sheet ${i + 1} of ${pages.length}` });
      if (opts.onProgress && i % 20 === 19) {
        opts.onProgress(i + 1, pages.length);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return doc.output('blob');
  }

  /** Text with {color|part} markup reduced to what is printed. */
  const plain = (text) => parseRich(String(text || '')).map((sg) => sg.t).join('');

  g.Sheet = { generate, plain };
})(window);
