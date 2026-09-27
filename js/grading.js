/* Answer key parsing, scoring, and CSV helpers. */
(function (g) {
  'use strict';
  const LETTERS = 'ABCDEFGH';

  /**
   * Parse a plaintext answer key.
   *
   * Numbered lines:       "1. A", "2) b", "3 C 2" (2 points), "4 A,C" / "4 AC" (either accepted),
   *                       "5 *" (free: everyone gets credit), "6 -" (dropped: not scored)
   * Unnumbered letters:   "ABCDA BCDDA" or "A B C D" — assigned to the next question in order.
   * Comments start with #.
   *
   * @returns {{items: Array<{accept:string, points:number, mode:'normal'|'free'|'drop'}|undefined>, errors:string[], warnings:string[]}}
   */
  function parseKey(text, numQuestions, numChoices) {
    const items = [];
    const errors = [];
    const warnings = [];
    const valid = LETTERS.slice(0, numChoices);
    let next = 1;

    const parseAnswer = (tok, lineNo) => {
      tok = tok.trim().toUpperCase();
      if (tok === '*') return { accept: '', points: 1, mode: 'free' };
      if (tok === '-' || tok === 'X' || tok === 'DROP') return { accept: '', points: 0, mode: 'drop' };
      const letters = tok.replace(/[\s,/|;+&]|OR/g, '');
      if (!/^[A-H]+$/.test(letters)) { errors.push(`Line ${lineNo}: "${tok}" is not a valid answer.`); return null; }
      const bad = [...letters].filter((c) => !valid.includes(c));
      if (bad.length) errors.push(`Line ${lineNo}: choice ${bad.join(', ')} is beyond ${valid[valid.length - 1]} (the sheet has ${numChoices} choices).`);
      return { accept: [...new Set(letters)].sort().join(''), points: 1, mode: 'normal' };
    };

    const set = (q, item, lineNo) => {
      if (q < 1 || q > numQuestions) { warnings.push(`Line ${lineNo}: question ${q} is outside 1–${numQuestions}; ignored.`); return; }
      if (items[q - 1]) warnings.push(`Line ${lineNo}: question ${q} was already given; using the later value.`);
      items[q - 1] = item;
    };

    text.split(/\r?\n/).forEach((raw, idx) => {
      const lineNo = idx + 1;
      const line = raw.replace(/#.*/, '').trim();
      if (!line) return;
      const m = line.match(/^(?:q\s*)?(\d+)\s*[.):=]?\s*(.*)$/i);
      if (m && m[2] !== '') {
        const q = Number(m[1]);
        let rest = m[2].trim();
        let points = null;
        const pm = rest.match(/^(.*?)\s+(?:\(|pts?\s*=?\s*)?(\d+(?:\.\d+)?)\s*(?:pts?|points?)?\)?$/i);
        if (pm) { rest = pm[1]; points = Number(pm[2]); }
        const item = parseAnswer(rest, lineNo);
        if (!item) return;
        if (points !== null && item.mode !== 'drop') item.points = points;
        set(q, item, lineNo);
        next = q + 1;
        return;
      }
      if (m && m[2] === '') { errors.push(`Line ${lineNo}: question ${m[1]} has no answer.`); return; }
      // Unnumbered: sequence of letters, [AC] groups, * and -.
      const tokens = line.toUpperCase().match(/\[[A-H,\s/]+\]|[A-H*\-]/g);
      const leftover = line.toUpperCase().replace(/\[[A-H,\s/]+\]|[A-H*\-]|[\s,;]/g, '');
      if (!tokens || leftover) { errors.push(`Line ${lineNo}: could not understand "${raw.trim()}".`); return; }
      for (const t of tokens) {
        const item = parseAnswer(t.replace(/[[\]]/g, ''), lineNo);
        if (item) set(next, item, lineNo);
        next++;
      }
    });

    const missing = [];
    for (let q = 1; q <= numQuestions; q++) if (!items[q - 1]) missing.push(q);
    if (missing.length) warnings.push(`No key for question${missing.length > 1 ? 's' : ''} ${compressRanges(missing)} — scored as dropped.`);
    return { items, errors, warnings };
  }

  function compressRanges(nums) {
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      out.push(i === j ? `${nums[i]}` : `${nums[i]}–${nums[j]}`);
      i = j;
    }
    return out.join(', ');
  }

  /** Render a key back to canonical text (used by "use scanned sheet as key"). */
  function keyToText(answers) {
    return answers.map((a, i) => `${i + 1}. ${a || '-'}`).join('\n') + '\n';
  }

  function scoreAnswers(answers, key, numQuestions) {
    let score = 0, possible = 0, correct = 0;
    const perQ = [];
    for (let q = 0; q < numQuestions; q++) {
      const item = key.items[q];
      const a = answers[q] || '';
      if (!item || item.mode === 'drop') { perQ.push(null); continue; }
      possible += item.points;
      const ok = item.mode === 'free' || (a.length === 1 && item.accept.includes(a));
      if (ok) { score += item.points; correct++; }
      perQ.push(ok);
    }
    return { score, possible, correct, perQ, percent: possible ? (100 * score) / possible : 0 };
  }

  // ---------- CSV ----------

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(rows) {
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    const delim = !text.includes(',') && text.includes('\t') ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  g.Grading = { parseKey, keyToText, scoreAnswers, toCSV, parseCSV, compressRanges };
})(typeof window !== 'undefined' ? window : globalThis);
