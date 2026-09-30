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

  function drawPage(doc, layout, ox, oy, opts) {
    const { title, student, pageLabel } = opts;
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
    const lx = X(144), ly = Y(L.FRAME_H);
    doc.setFillColor(0, 0, 0);
    doc.circle(lx, ly, 3.3, 'F');
    doc.setLineWidth(0.3);
    doc.setDrawColor(150);
    doc.circle(lx, ly, 2.8, 'S');
    doc.setDrawColor(255);
    doc.setLineCap('round');
    doc.setLineWidth(0.55);
    doc.line(lx - 1.2, ly - 1.9, lx + 1.3, ly + 1.9);   // long stroke
    doc.setLineWidth(0.45);
    doc.line(lx + 0.05, ly + 0.05, lx - 1.3, ly + 1.9); // short leg
    doc.setLineCap('butt');
    doc.setDrawColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('LambdaGrader', X(149), ly + 0.1, { baseline: 'middle' });
    doc.setFont('helvetica', 'normal');

    const leftW = idDigits ? layout.idX0 - 14 : L.FRAME_W;

    // Title.
    doc.setFont('helvetica', 'bold');
    doc.text(fitText(doc, title || 'Multiple Choice Exam', leftW, 15, 9), X(0), Y(11));

    // Name, name.# and section lines.
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setLineWidth(0.25);
    doc.text('Name', X(0), Y(20));
    doc.line(X(11), Y(20.8), X(leftW), Y(20.8));
    const split = leftW * 0.5;
    doc.text('Name.#', X(0), Y(28));
    doc.line(X(13.5), Y(28.8), X(split), Y(28.8));
    doc.text('Section', X(split + 3), Y(28));
    doc.line(X(split + 16), Y(28.8), X(leftW), Y(28.8));
    if (student) {
      doc.setFont('helvetica', 'bold');
      doc.text(fitText(doc, student.name || '', leftW - 13, 12, 7), X(12), Y(19.8));
      if (student.id) doc.text(fitText(doc, student.id, split - 16, 11, 7), X(15), Y(27.8));
      doc.setFont('helvetica', 'normal');
      if (student.section) doc.text(fitText(doc, student.section, leftW - split - 18, 10, 7), X(split + 17), Y(27.8));
    }

    // Last-name initial bubbles.
    const hasInitials = layout.initials.length > 0;
    if (hasInitials) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text('FIRST LETTER OF LAST NAME', X(layout.initials[0].x - L.BUBBLE_R), Y(34.6));
      doc.setFont('helvetica', 'normal');
      for (const b of layout.initials) bubble(doc, X(b.x), Y(b.y), b.letter, student && student.initial === b.letter);
    }

    // Fill example beside the initial block (or at the left when there is none).
    const exX = hasInitials ? layout.initials[12].x + 7 : 0;
    if (leftW - exX > 30) {
      doc.setFontSize(7);
      doc.setTextColor(40);
      doc.text('Fill bubbles like this:', X(exX), Y(39.3));
      doc.setFillColor(0, 0, 0);
      doc.circle(X(exX) + doc.getTextWidth('Fill bubbles like this:') + 3, Y(38.6), L.BUBBLE_R, 'F');
      doc.text('Use a dark pencil or black/blue pen.', X(exX), Y(43.9));
      doc.setTextColor(0);
    }

    // Instructions.
    doc.setDrawColor(60);
    doc.setLineWidth(0.2);
    doc.roundedRect(X(0), Y(47.5), leftW, 19.5, 1.5, 1.5, 'S');
    doc.setFont('helvetica', 'normal');
    const bubbleHelp = [idDigits && ' Bubble its number at right', hasInitials && ' Bubble the first letter of your last name']
      .filter(Boolean).join(' and') + (idDigits || hasInitials ? '.' : '');
    const lines = [
      'Fill each bubble completely. Mark one answer per question unless it says "select all that apply".',
      student ? `Your name${idDigits ? ', name.# number' : ''}${hasInitials ? ' and last-name initial' : ''} ${idDigits || hasInitials ? 'are' : 'is'} pre-filled. Do not change them.`
        : `Write your name and name.# above.${bubbleHelp}`,
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
    const footer = [title || null, student ? `${student.name}${student.id ? ` (${student.id})` : ''}` : null,
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
    doc.setProperties({ title: `${exam.title || 'Exam'} bubble sheets`, creator: 'LambdaGrader' });
    const layout = L.build(exam);
    const ox = (pw - L.FRAME_W) / 2;
    const oy = (ph - L.FRAME_H) / 2;
    const pages = opts.students ? opts.students.map((s) => ({ student: s })) : Array.from({ length: opts.copies || 1 }, () => ({}));
    for (let i = 0; i < pages.length; i++) {
      if (i) doc.addPage(paper, 'portrait');
      drawPage(doc, layout, ox, oy, { title: exam.title, student: pages[i].student, pageLabel: `Sheet ${i + 1} of ${pages.length}` });
      if (opts.onProgress && i % 20 === 19) {
        opts.onProgress(i + 1, pages.length);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return doc.output('blob');
  }

  g.Sheet = { generate };
})(window);
