/* Persistence: everything lives in this browser's localStorage. */
(function (g) {
  'use strict';
  const KEY = 'lambdagrader:v1';
  const LEGACY_KEYS = ['omrchecker-web:v1'];
  const MAX_STUDENTS = 400;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newExam(title) {
    return {
      id: uid(), title: title || 'Exam 1', numQuestions: 50, numChoices: 5, idDigits: 4,
      paper: 'letter', subtitle: '', className: '', headerRight: '', pageNum: '', keyText: '', multiScoring: 'exact', results: [], created: new Date().toISOString(),
    };
  }

  // ---------- student IDs ----------
  // IDs are usually name.# ("smith.12"): a last name, a dot, and a number that
  // is NOT unique on its own. Plain numeric IDs ("1001") also work.

  const stripZeros = (d) => d.replace(/^0+(?=\d)/, '');

  function normalizeId(v) {
    return String(v ?? '').trim().toLowerCase().replace(/@.*$/, '').replace(/\s+/g, '');
  }

  /** The number a sheet can carry. */
  function idParts(student) {
    const m = String(student.id || '').match(/^([a-z][a-z'\-]*)\.(\d+)$/i);
    if (m) return { num: stripZeros(m[2]) };
    const digits = String(student.id || '').replace(/\D/g, '');
    return { num: digits ? stripZeros(digits) : '' };
  }

  /**
   * Give every student a permanent small integer key (1..1023). Personalised
   * sheets print it in the code strip, so it must not change once printed.
   */
  function assignKeys(roster) {
    const used = new Set();
    for (const st of roster) {
      if (Number.isInteger(st.key) && st.key > 0 && st.key <= 1023 && !used.has(st.key)) used.add(st.key);
      else st.key = 0;
    }
    let n = 1;
    for (const st of roster) {
      if (st.key) continue;
      while (used.has(n)) n++;
      st.key = n;
      used.add(n);
    }
    return roster;
  }

  function blank() {
    const exam = newExam();
    return { version: 1, roster: [], exams: [exam], activeExamId: exam.id };
  }

  function sanitize(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.exams) || !Array.isArray(d.roster)) throw new Error('Not a LambdaGrader backup.');
    d.roster = assignKeys(d.roster.filter((s) => s && typeof s.name === 'string').map((s) => ({
      key: s.key, id: normalizeId(s.id), name: s.name, section: String(s.section ?? ''),
    })));
    d.exams = d.exams.filter((e) => e && e.id).map((e) => ({ ...newExam(), ...e, results: Array.isArray(e.results) ? e.results : [] }));
    for (const e of d.exams) {
      for (const r of e.results) {
        // Results saved before name.# support stored the bubbled digits as studentId.
        if (r.num === undefined) r.num = stripZeros(String(r.studentId || ''));
        delete r.initial;
        delete r.studentId;
      }
    }
    if (!d.exams.length) d.exams.push(newExam());
    if (!d.exams.some((e) => e.id === d.activeExamId)) d.activeExamId = d.exams[0].id;
    d.version = 1;
    return d;
  }

  function load() {
    try {
      let raw = localStorage.getItem(KEY);
      for (const k of LEGACY_KEYS) if (!raw) raw = localStorage.getItem(k);
      if (raw) return sanitize(JSON.parse(raw));
    } catch (e) {
      console.warn('Could not load saved data', e);
    }
    return blank();
  }

  let saveTimer = null;
  let lastError = null;
  function save(data, immediate) {
    clearTimeout(saveTimer);
    const run = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        lastError = null;
      } catch (e) {
        lastError = e;
        console.error(e);
        g.dispatchEvent(new CustomEvent('store-error', { detail: e }));
      }
    };
    if (immediate) run(); else saveTimer = setTimeout(run, 250);
  }

  function bytesUsed() {
    try { return (localStorage.getItem(KEY) || '').length * 2; } catch { return 0; }
  }

  function wipe() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  g.Store = {
    load, save, wipe, sanitize, newExam, blank, uid, bytesUsed, MAX_STUDENTS,
    normalizeId, idParts, assignKeys, stripZeros, get lastError() { return lastError; } };
})(window);
