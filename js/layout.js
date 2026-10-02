/*
 * Sheet geometry shared by the PDF generator and the scanner.
 *
 * All coordinates are in millimetres in a "frame" whose origin is the centre of
 * the top-left corner square. The four corner squares sit at the corners of a
 * FRAME_W x FRAME_H rectangle, so a scan can be mapped back to these
 * coordinates with a perspective transform regardless of paper size, printer
 * scaling, or scanner resolution.
 */
(function (g) {
  'use strict';

  const FRAME_W = 180;
  const FRAME_H = 250;
  const FIDUCIAL = 8;            // side of the solid corner squares

  // Layout code: a row of 16 small squares along the top edge that records the
  // sheet's question/choice/ID configuration so scans are self-describing.
  const CODE_BITS = 17;
  const CODE_X0 = 30;
  const CODE_DX = 6;
  const CODE_SIZE = 3.5;

  const BUBBLE_R = 1.8;
  const BUBBLE_DX = 5;
  const Q_TOP = 76;
  const Q_PITCH = 5;
  const Q_GROUP_GAP = 1.5;       // extra space after every 5 rows
  const Q_MAX_ROWS = 30;

  const ID_DX = 5.5;
  const ID_DY = 4.4;
  const ID_TOP = 22;
  const ID_BOX_TOP = 13.5;
  const ID_BOX_H = 5;

  // Student code strip along the bottom edge. Personalised sheets print a
  // roster key here (10 bits + 2 parity bits) so they match exactly, even when
  // two students share a name.# number. Blank sheets leave it empty.
  const KEY_BITS = 12;

  const PAPER = { letter: [215.9, 279.4], a4: [210, 297] };
  const LETTERS = 'ABCDEFGH';
  const MAX_CHOICES = 8;
  const MAX_ID_DIGITS = 10;

  function columnWidth(choices) {
    return 9 + choices * BUBBLE_DX + 3;
  }

  function maxColumns(choices) {
    return Math.floor(FRAME_W / columnWidth(choices));
  }

  function maxQuestions(choices) {
    return Math.min(255, maxColumns(choices) * Q_MAX_ROWS);
  }

  function validateConfig(cfg) {
    const errs = [];
    const q = cfg.numQuestions, c = cfg.numChoices, d = cfg.idDigits;
    if (!Number.isInteger(c) || c < 2 || c > MAX_CHOICES) errs.push(`Choices per question must be 2–${MAX_CHOICES}.`);
    else if (!Number.isInteger(q) || q < 1 || q > maxQuestions(c)) errs.push(`With ${c} choices a sheet holds 1–${maxQuestions(c)} questions.`);
    if (!Number.isInteger(d) || d < 0 || d > MAX_ID_DIGITS) errs.push(`Student ID digits must be 0–${MAX_ID_DIGITS}.`);
    return errs;
  }

  function rowY(r) {
    return Q_TOP + r * Q_PITCH + Math.floor(r / 5) * Q_GROUP_GAP;
  }

  /** Build every printable/readable position for a configuration. */
  function build(cfg) {
    const { numQuestions: nq, numChoices: nc, idDigits: nd } = cfg;
    const colsNeeded = Math.ceil(nq / Q_MAX_ROWS);
    const rows = Math.ceil(nq / colsNeeded);
    const minW = columnWidth(nc);
    const spacing = Math.min(FRAME_W / colsNeeded, minW + 14);
    const startX = (FRAME_W - spacing * colsNeeded) / 2 + (spacing - minW) / 2;

    const questions = [];
    for (let q = 0; q < nq; q++) {
      const col = Math.floor(q / rows);
      const r = q % rows;
      const colX = startX + col * spacing;
      const y = rowY(r);
      const bubbles = [];
      for (let i = 0; i < nc; i++) bubbles.push({ x: colX + 9 + i * BUBBLE_DX + BUBBLE_R, y });
      questions.push({ number: q + 1, labelX: colX + 6.5, y, bubbles });
    }

    const id = [];
    const idX0 = FRAME_W - 2 - (nd - 1) * ID_DX;
    for (let j = 0; j < nd; j++) {
      const x = idX0 + j * ID_DX;
      const bubbles = [];
      for (let d = 0; d < 10; d++) bubbles.push({ x, y: ID_TOP + d * ID_DY });
      id.push({ x, bubbles });
    }

    const code = encodeCode(cfg).map((bit, i) => ({ x: CODE_X0 + i * CODE_DX, y: 0, bit }));

    // Offset by half a step so an upside-down strip never overlaps the layout code.
    const keyStrip = Array.from({ length: KEY_BITS }, (_, i) => ({ x: CODE_X0 + CODE_DX / 2 + i * CODE_DX, y: FRAME_H }));

    return {
      cfg: { numQuestions: nq, numChoices: nc, idDigits: nd },
      questions, id, idX0, code, rows, keyStrip,
      lastRowY: rowY(rows - 1),
    };
  }

  function encodeCode(cfg) {
    const v = (cfg.numQuestions & 255) | (((cfg.numChoices - 2) & 7) << 8) | ((cfg.idDigits & 15) << 11);  // bit 15 unused (was last-name initials)
    const bits = [];
    let ones = 0;
    for (let i = 0; i < CODE_BITS - 1; i++) {
      const b = (v >> i) & 1;
      bits.push(b);
      ones += b;
    }
    bits.push(ones % 2);  // even parity
    return bits;
  }

  function decodeCode(bits) {
    let ones = 0, v = 0;
    for (let i = 0; i < CODE_BITS; i++) {
      ones += bits[i];
      if (i < CODE_BITS - 1) v |= bits[i] << i;
    }
    if (ones % 2 !== 0) return null;
    const cfg = { numQuestions: v & 255, numChoices: ((v >> 8) & 7) + 2, idDigits: (v >> 11) & 15 };
    return validateConfig(cfg).length ? null : cfg;
  }

  function encodeKey(key) {
    const bits = [];
    for (let i = 0; i < 10; i++) bits.push((key >> i) & 1);
    bits.push(bits.filter((_, i) => i % 2 === 0).reduce((a, b) => a ^ b, 0));
    bits.push(bits.filter((_, i) => i % 2 === 1 && i < 10).reduce((a, b) => a ^ b, 0));
    return bits;
  }

  /** @returns {number|null} 0 for an empty strip, null if the parity fails. */
  function decodeKey(bits) {
    let key = 0;
    for (let i = 0; i < 10; i++) key |= bits[i] << i;
    const check = encodeKey(key);
    return check[10] === bits[10] && check[11] === bits[11] ? key : null;
  }

  g.Layout = {
    FRAME_W, FRAME_H, FIDUCIAL, CODE_BITS, CODE_X0, CODE_DX, CODE_SIZE, BUBBLE_R, ID_DX, ID_DY, ID_TOP,
    ID_BOX_TOP, ID_BOX_H, PAPER, LETTERS, MAX_CHOICES, MAX_ID_DIGITS,
    fiducials: [[0, 0], [FRAME_W, 0], [0, FRAME_H], [FRAME_W, FRAME_H]],
    KEY_BITS, MAX_KEY: 1023,
    maxQuestions, validateConfig, build, encodeCode, decodeCode, encodeKey, decodeKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
