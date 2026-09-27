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

    const leftW = idDigits ? layout.idX0 - 14 : L.FRAME_W;

    // Title.
    doc.setFont('helvetica', 'bold');
    doc.text(fitText(doc, title || 'Multiple Choice Exam', leftW, 15, 9), X(0), Y(11));

    // Name / section lines.
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Name', X(0), Y(20));
    doc.setLineWidth(0.25);
    doc.line(X(11), Y(20.8), X(leftW), Y(20.8));
    doc.text('Section', X(0), Y(28));
    doc.line(X(14), Y(28.8), X(leftW * 0.6), Y(28.8));
    doc.text('Date', X(leftW * 0.6 + 3), Y(28));
    doc.line(X(leftW * 0.6 + 12), Y(28.8), X(leftW), Y(28.8));
    if (student) {
      doc.setFont('helvetica', 'bold');
      doc.text(fitText(doc, student.name || '', leftW - 13, 12, 7), X(12), Y(19.8));
      doc.setFont('helvetica', 'normal');
      if (student.section) doc.text(fitText(doc, student.section, leftW * 0.6 - 16, 10, 7), X(15), Y(27.8));
    }

    // Instructions.
    doc.setDrawColor(150);
    doc.setLineWidth(0.2);
    doc.roundedRect(X(0), Y(33), leftW, 30, 1.5, 1.5, 'S');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('INSTRUCTIONS', X(3), Y(38));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const lines = [
      'Use a dark pencil or black/blue pen. Fill each bubble completely:',
      'Mark only one answer per question. Erase changes completely.',
      student ? 'Your student ID is pre-filled at right. Do not change it.'
              : (idDigits ? 'Write your student ID in the boxes at right and fill the matching bubbles.' : ''),
      'Do not fold this sheet or write on or near the black squares.',
    ].filter(Boolean);
    lines.forEach((t, i) => doc.text(t, X(3), Y(43 + i * 4.6)));
    // Filled / wrong examples next to line 1.
    const ex = X(3) + doc.getTextWidth(lines[0]) + 3;
    doc.setDrawColor(0);
    doc.setFillColor(0, 0, 0);
    doc.circle(ex, Y(42.3), L.BUBBLE_R * 0.8, 'F');
    doc.setTextColor(120);
    doc.setFontSize(6.5);
    doc.text('like this', ex + 2.5, Y(43));
    doc.setTextColor(0);

    doc.setFontSize(6.5);
    doc.setTextColor(90);
    doc.text(`${numQuestions} questions · choices ${L.LETTERS[0]}–${L.LETTERS[numChoices - 1]}`, X(3), Y(61));
    doc.setTextColor(0);

    // Student ID grid.
    if (idDigits) {
      const top = L.ID_BOX_TOP;
      const x0 = layout.idX0 - L.ID_DX / 2;
      const w = idDigits * L.ID_DX;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('STUDENT ID', x0 + w / 2 + ox, Y(top - 2), { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      const idStr = student ? String(student.id).padStart(idDigits, '0') : '';
      layout.id.forEach((col, j) => {
        doc.rect(X(col.x - L.ID_DX / 2), Y(top), L.ID_DX, L.ID_BOX_H, 'S');
        if (idStr) {
          doc.setFontSize(10);
          doc.text(idStr[j], X(col.x), Y(top + L.ID_BOX_H / 2), { align: 'center', baseline: 'middle' });
        }
      });
      doc.setDrawColor(150);
      doc.rect(X(x0 - 5), Y(top - 5.5), w + 5.5, L.ID_TOP + 9 * L.ID_DY + 3 - (top - 5.5), 'S');
      doc.setFontSize(7);
      doc.setTextColor(90);
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
    doc.setTextColor(120);
    const footer = [title || null, student ? `${student.name} (${student.id})` : null, pageLabel]
      .filter(Boolean).join('  ·  ');
    doc.text(footer, X(L.FRAME_W / 2), Y(layout.lastRowY + 8), { align: 'center' });
    doc.setTextColor(0);
  }

  function bubble(doc, cx, cy, label, filled) {
    doc.setLineWidth(0.25);
    doc.setDrawColor(70);
    if (filled) {
      doc.setFillColor(0, 0, 0);
      doc.circle(cx, cy, L.BUBBLE_R, 'FD');
      return;
    }
    doc.circle(cx, cy, L.BUBBLE_R, 'S');
    if (label) {
      doc.setFontSize(5.5);
      doc.setTextColor(150);
      doc.text(label, cx, cy + 0.05, { align: 'center', baseline: 'middle' });
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
    doc.setProperties({ title: `${exam.title || 'Exam'} bubble sheets`, creator: 'OMRChecker Web' });
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
