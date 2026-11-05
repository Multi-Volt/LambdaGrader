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
  // (CODE_* is the original 17-bit design, still read for sheets printed with it; see CODE2_* below.)
  const CODE_BITS = 17;
  const CODE_X0 = 30;
  const CODE_DX = 6;
  const CODE_SIZE = 3.5;

  // Current design: a 32-bit error-correcting code (extended BCH, distance 8, scrambled so it is
  // never mostly blank) on the top edge for the sheet layout, and another along the bottom edge for
  // the student key. Both are decoded softly, so a few chopped, smudged or washed-out squares are
  // corrected and anything unreliable is rejected instead of misread.
  const CODE2_BITS = 32;
  const CODE2_X0 = 30.5;
  const CODE2_DX = 3.2;
  const CODE2_SIZE = 2.5;

  const BUBBLE_R = 1.8;
  const BUBBLE_DX = 5;
  const Q_TOP = 85;   // sheets printed before this change started at 76; the scanner finds those on its own
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

  /**
   * Parse a per-question choice spec such as "1-10:4, 11-15:5" (question range : number of choices).
   * Questions not listed get `dflt` choices.
   * @returns {{counts:number[], errors:string[]}}
   */
  function parseChoiceSpec(text, nq, dflt) {
    const counts = new Array(Math.max(0, nq || 0)).fill(dflt);
    const errors = [];
    for (const part of String(text || '').split(/[;,\n]/)) {
      const p = part.trim();
      if (!p) continue;
      const m = p.match(/^(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*[:=]\s*(\d+)$/i);
      if (!m) { errors.push(`"${p}" is not like 1-10:4.`); continue; }
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a, c = Number(m[3]);
      if (a < 1 || b < a || b > nq) { errors.push(`Questions "${p.split(/[:=]/)[0].trim()}" are outside 1–${nq}.`); continue; }
      if (c < 2 || c > MAX_CHOICES) { errors.push(`Choices must be 2–${MAX_CHOICES} in "${p}".`); continue; }
      for (let q = a; q <= b; q++) counts[q - 1] = c;
    }
    return { counts, errors };
  }

  /** Full layout config for an exam: numChoices becomes the widest row, qChoices the per-question counts. */
  function cfgFor(ex) {
    const nq = ex.numQuestions;
    const counts = parseChoiceSpec(ex.choiceSpec, nq, ex.numChoices).counts;
    const cfg = { numQuestions: nq, numChoices: counts.length ? Math.max(...counts) : ex.numChoices, idDigits: ex.idDigits };
    if (counts.some((c) => c !== cfg.numChoices)) cfg.qChoices = counts;
    return cfg;
  }

  function choicesOf(cfg, q) {
    return (cfg.qChoices && cfg.qChoices[q]) || cfg.numChoices;
  }

  function validateConfig(cfg) {
    const errs = [];
    const q = cfg.numQuestions, c = cfg.numChoices, d = cfg.idDigits;
    if (!Number.isInteger(c) || c < 2 || c > MAX_CHOICES) errs.push(`Choices per question must be 2–${MAX_CHOICES}.`);
    else if (!Number.isInteger(q) || q < 1 || q > maxQuestions(c)) errs.push(`With ${c} choices a sheet holds 1–${maxQuestions(c)} questions.`);
    if (!Number.isInteger(d) || d < 0 || d > MAX_ID_DIGITS) errs.push(`Student ID digits must be 0–${MAX_ID_DIGITS}.`);
    return errs;
  }

  /**
   * Optional overrides for sheets laid out differently from the built-in design
   * (the scanner finds these itself): {qTop, qPitch, groupGap, dx, xShift}.
   */
  const DEFAULT_GRID = { qTop: Q_TOP, qPitch: Q_PITCH, groupGap: Q_GROUP_GAP, dx: BUBBLE_DX, xShift: 0 };

  function rowY(r, t) {
    return t.qTop + r * t.qPitch + Math.floor(r / 5) * t.groupGap;
  }

  /** Build every printable/readable position for a configuration. */
  function build(cfg, grid) {
    const t = Object.assign({}, DEFAULT_GRID, grid);
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
      const y = rowY(r, t);
      const bubbles = [];
      for (let i = 0; i < choicesOf(cfg, q); i++) bubbles.push({ x: colX + t.xShift + 9 + i * t.dx + BUBBLE_R, y });
      questions.push({ number: q + 1, labelX: colX + t.xShift + 6.5, y, bubbles });
    }

    const id = [];
    const idX0 = FRAME_W - 2 - (nd - 1) * ID_DX;
    for (let j = 0; j < nd; j++) {
      const x = idX0 + j * ID_DX;
      const bubbles = [];
      for (let d = 0; d < 10; d++) bubbles.push({ x, y: ID_TOP + d * ID_DY });
      id.push({ x, bubbles });
    }

    const code = encodeCode2(cfg).map((bit, i) => ({ x: CODE2_X0 + i * CODE2_DX, y: 0, bit }));

    // Offset by half a step so an upside-down strip never overlaps the layout code.
    const keyStrip = Array.from({ length: CODE2_BITS }, (_, i) => ({ x: CODE2_X0 + CODE2_DX / 2 + i * CODE2_DX, y: FRAME_H }));
    const legacyKeyStrip = Array.from({ length: KEY_BITS }, (_, i) => ({ x: CODE_X0 + CODE_DX / 2 + i * CODE_DX, y: FRAME_H }));

    return {
      cfg: cfg.qChoices ? { numQuestions: nq, numChoices: nc, idDigits: nd, qChoices: cfg.qChoices } : { numQuestions: nq, numChoices: nc, idDigits: nd },
      questions, id, idX0, code, rows, keyStrip, legacyKeyStrip,
      lastRowY: rowY(rows - 1, t),
    };
  }

  // ---------- error-correcting codes ----------

  const BCH_G = 0x8FAF;               // generator of the (31,16) BCH code, t = 3
  const CONFIG_MASK = 0xA5C39E27;
  const KEY_MASK = 0x3C6B5D91;
  const KEY_TAG = 0x25;               // 6 fixed bits after the 10-bit key, so garbage rarely looks valid

  /** 16 data bits → 32-bit word (31-bit BCH codeword + overall parity), minimum distance 8. */
  function bch32(m) {
    let rem = m << 15;
    for (let b = 30; b >= 15; b--) if ((rem >> b) & 1) rem ^= BCH_G << (b - 15);
    let w = (m << 15) | (rem & 0x7FFF);
    let p = 0;
    for (let b = 0; b < 31; b++) p ^= (w >> b) & 1;
    return ((w | (p << 31)) >>> 0);
  }

  function wordBits(w) {
    const bits = [];
    for (let i = 0; i < CODE2_BITS; i++) bits.push((w >>> i) & 1);
    return bits;
  }

  function configPayload(cfg) {
    return (cfg.numQuestions & 255) | (((cfg.numChoices - 2) & 7) << 8) | ((cfg.idDigits & 15) << 11);
  }

  function encodeCode2(cfg) { return wordBits((bch32(configPayload(cfg)) ^ CONFIG_MASK) >>> 0); }
  function encodeKey2(key) { return wordBits((bch32((key & 1023) | (KEY_TAG << 10)) ^ KEY_MASK) >>> 0); }

  const books = {};
  /** All words a sheet can carry: kind 'config' (every valid layout) or 'key' (0..1023). */
  function codebook(kind) {
    if (books[kind]) return books[kind];
    const words = [], values = [];
    if (kind === 'config') {
      for (let q = 1; q <= 255; q++) for (let c = 2; c <= MAX_CHOICES; c++) for (let d = 0; d <= MAX_ID_DIGITS; d++) {
        const cfg = { numQuestions: q, numChoices: c, idDigits: d };
        if (validateConfig(cfg).length) continue;
        words.push((bch32(configPayload(cfg)) ^ CONFIG_MASK) >>> 0);
        values.push(cfg);
      }
    } else {
      for (let k = 0; k < 1024; k++) { words.push((bch32(k | (KEY_TAG << 10)) ^ KEY_MASK) >>> 0); values.push(k); }
    }
    return (books[kind] = { words: Uint32Array.from(words), values });
  }

  /**
   * Soft-decision decode. s[i] is how likely bit i is ink (0..1), valid[i] is 0 for a square that
   * could not be seen (cut off by the image edge). Returns the `count` closest words as
   * [{index, cost}] (cost = squared distance over the visible bits), best first.
   */
  function softDecode(kind, s, valid, count) {
    const { words } = codebook(kind);
    // cost(word) = Σ s² + Σ over its 1-bits of (1 - 2s); tabulate per byte.
    let base = 0;
    const d = new Float64Array(CODE2_BITS);
    for (let i = 0; i < CODE2_BITS; i++) if (valid[i]) { base += s[i] * s[i]; d[i] = 1 - 2 * s[i]; }
    const tab = new Float64Array(4 * 256);
    for (let by = 0; by < 4; by++) for (let v = 1; v < 256; v++) {
      const low = v & -v, bit = 31 - Math.clz32(low);
      tab[by * 256 + v] = tab[by * 256 + (v ^ low)] + d[by * 8 + bit];
    }
    const top = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const c = base + tab[w & 255] + tab[256 + ((w >>> 8) & 255)] + tab[512 + ((w >>> 16) & 255)] + tab[768 + (w >>> 24)];
      if (top.length < count || c < top[top.length - 1].cost) {
        top.push({ index: i, cost: c });
        top.sort((a, b) => a.cost - b.cost);
        if (top.length > count) top.pop();
      }
    }
    return top;
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
    FRAME_W, FRAME_H, FIDUCIAL, CODE2_BITS, CODE2_X0, CODE2_DX, CODE2_SIZE, CODE_BITS, CODE_X0, CODE_DX, CODE_SIZE, BUBBLE_R, ID_DX, ID_DY, ID_TOP,
    ID_BOX_TOP, ID_BOX_H, PAPER, LETTERS, MAX_CHOICES, MAX_ID_DIGITS,
    fiducials: [[0, 0], [FRAME_W, 0], [0, FRAME_H], [FRAME_W, FRAME_H]],
    KEY_BITS, MAX_KEY: 1023, DEFAULT_GRID,
    encodeCode2, encodeKey2, codebook, softDecode, bch32, maxQuestions, validateConfig, parseChoiceSpec, cfgFor, choicesOf, build, encodeCode, decodeCode, encodeKey, decodeKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
