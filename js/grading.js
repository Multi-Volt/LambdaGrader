/* Answer key parsing, scoring, and CSV helpers. */
(function (g) {
  'use strict';
  const LETTERS = 'ABCDEFGH';

  /**
   * Parse a plaintext answer key.
   *
   * Numbered lines:
   *   "1. A", "2) b"            one correct answer
   *   "3 C 2"                   worth 2 points (default 1)
   *   "4 A/C" or "4 A,C"        either A or C is accepted (one mark)
   *   "5 ACD" or "5 A+C+D"      select all that apply: exactly A, C and D must be marked
   *   "5 ACD partial"           ...with partial credit ("exact" forces all-or-nothing)
   *   "6 *"                     free: everyone gets credit
   *   "7 -"                     dropped: not scored
   * Unnumbered letters ("ABCDA BCDDA", "[ACD] B [A/C]") continue from the last question.
   * Comments start with #.
   *
   * Item: {mode:'normal'|'free'|'drop', accept, match:'one'|'all', points, scoring?:'partial'|'exact'}
   */
  function parseKey(text, numQuestions, numChoices) {
    const items = [];
    const errors = [];
    const warnings = [];
    const valid = LETTERS.slice(0, numChoices);
    let next = 1;

    const parseAnswer = (tok, lineNo) => {
      tok = tok.trim().toUpperCase();
      if (tok === '*') return { accept: '', points: 1, mode: 'free', match: 'one' };
      if (tok === '-' || tok === 'X' || tok === 'DROP') return { accept: '', points: 0, mode: 'drop', match: 'one' };
      const either = /[,/|]|\bOR\b/.test(tok);
      const letters = tok.replace(/[\s,/|;+&]|\bOR\b|\bAND\b/g, '');
      if (!/^[A-H]+$/.test(letters)) { errors.push(`Line ${lineNo}: "${tok}" is not a valid answer.`); return null; }
      const bad = [...letters].filter((c) => !valid.includes(c));
      if (bad.length) errors.push(`Line ${lineNo}: choice ${bad.join(', ')} is beyond ${valid[valid.length - 1]} (the sheet has ${numChoices} choices).`);
      const accept = [...new Set(letters)].sort().join('');
      return { accept, points: 1, mode: 'normal', match: accept.length > 1 && !either ? 'all' : 'one' };
    };

    const set = (q, item, lineNo) => {
      if (q < 1 || q > numQuestions) { warnings.push(`Line ${lineNo}: question ${q} is outside 1 to ${numQuestions}; ignored.`); return; }
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
        let scoring = null;
        const sm = rest.match(/^(.*?)\s+(partial|exact)$/i) || rest.match(/^(.*?)\s+(partial|exact)(\s+.*)$/i);
        if (sm) { scoring = sm[2].toLowerCase(); rest = (sm[1] + (sm[3] || '')).trim(); }
        let points = null;
        const pm = rest.match(/^(.*?)\s+(?:\(|pts?\s*=?\s*)?(\d+(?:\.\d+)?)\s*(?:pts?|points?)?\)?$/i);
        if (pm) { rest = pm[1]; points = Number(pm[2]); }
        const item = parseAnswer(rest, lineNo);
        if (!item) return;
        if (points !== null && item.mode !== 'drop') item.points = points;
        if (scoring) {
          if (item.match === 'all') item.scoring = scoring;
          else warnings.push(`Line ${lineNo}: "${scoring}" only applies to select-all-that-apply answers.`);
        }
        set(q, item, lineNo);
        next = q + 1;
        return;
      }
      if (m && m[2] === '') { errors.push(`Line ${lineNo}: question ${m[1]} has no answer.`); return; }
      // Unnumbered: sequence of letters, [..] groups, * and -.
      const group = /\[[A-H,/|+&\s]+\]|[A-H*\-]/g;
      const tokens = line.toUpperCase().match(group);
      const leftover = line.toUpperCase().replace(group, '').replace(/[\s,;]/g, '');
      if (!tokens || leftover) { errors.push(`Line ${lineNo}: could not understand "${raw.trim()}".`); return; }
      for (const t of tokens) {
        const item = parseAnswer(t.replace(/[[\]]/g, ''), lineNo);
        if (item) set(next, item, lineNo);
        next++;
      }
    });

    const missing = [];
    for (let q = 1; q <= numQuestions; q++) if (!items[q - 1]) missing.push(q);
    if (missing.length) warnings.push(`No key for question${missing.length > 1 ? 's' : ''} ${compressRanges(missing)}, so ${missing.length > 1 ? 'they are' : 'it is'} not scored.`);
    return { items, errors, warnings };
  }

  /** 1-based question numbers that are "select all that apply". */
  function multiSelectSet(key) {
    const set = new Set();
    key.items.forEach((it, i) => { if (it && it.mode === 'normal' && it.match === 'all') set.add(i + 1); });
    return set;
  }

  function compressRanges(nums) {
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      out.push(i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
      i = j;
    }
    return out.join(', ');
  }

  /** Render a key back to canonical text (used by "use scanned sheet as key"). */
  function keyToText(answers) {
    return answers.map((a, i) => `${i + 1}. ${a || '-'}`).join('\n') + '\n';
  }

  /**
   * Credit for one question, 0..1 (null if not scored).
   * multiScoring: 'exact' (all-or-nothing) or 'partial' for select-all-that-apply items.
   * Partial credit = (correct marks - wrong marks) / number of correct choices, never below 0.
   */
  function creditFor(item, answer, multiScoring) {
    if (!item || item.mode === 'drop') return null;
    if (item.mode === 'free') return 1;
    const a = answer || '';
    if (item.match === 'one') return a.length === 1 && item.accept.includes(a) ? 1 : 0;
    const want = new Set(item.accept);
    let hits = 0, wrong = 0;
    for (const c of new Set(a)) { if (want.has(c)) hits++; else wrong++; }
    if (hits === want.size && wrong === 0) return 1;
    if ((item.scoring || multiScoring) !== 'partial') return 0;
    return Math.max(0, (hits - wrong) / want.size);
  }

  function scoreAnswers(answers, key, numQuestions, multiScoring) {
    let score = 0, possible = 0, correct = 0;
    const perQ = [];
    for (let q = 0; q < numQuestions; q++) {
      const item = key.items[q];
      const credit = creditFor(item, answers[q], multiScoring);
      perQ.push(credit);
      if (credit == null) continue;
      possible += item.points;
      score += credit * item.points;
      if (credit === 1) correct++;
    }
    score = Math.round(score * 100) / 100;
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

  g.Grading = { parseKey, multiSelectSet, creditFor, keyToText, scoreAnswers, toCSV, parseCSV, compressRanges };
})(typeof window !== 'undefined' ? window : globalThis);
