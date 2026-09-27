/* Persistence: everything lives in this browser's localStorage. */
(function (g) {
  'use strict';
  const KEY = 'omrchecker-web:v1';
  const MAX_STUDENTS = 400;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newExam(title) {
    return {
      id: uid(), title: title || 'Exam 1', numQuestions: 50, numChoices: 5, idDigits: 6,
      paper: 'letter', keyText: '', results: [], created: new Date().toISOString(),
    };
  }

  function blank() {
    const exam = newExam();
    return { version: 1, roster: [], exams: [exam], activeExamId: exam.id };
  }

  function sanitize(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.exams) || !Array.isArray(d.roster)) throw new Error('Not an OMRChecker Web backup.');
    d.roster = d.roster.filter((s) => s && typeof s.name === 'string').map((s) => ({
      id: String(s.id ?? '').replace(/\D/g, ''), name: s.name, section: String(s.section ?? ''),
    }));
    d.exams = d.exams.filter((e) => e && e.id).map((e) => ({ ...newExam(), ...e, results: Array.isArray(e.results) ? e.results : [] }));
    if (!d.exams.length) d.exams.push(newExam());
    if (!d.exams.some((e) => e.id === d.activeExamId)) d.activeExamId = d.exams[0].id;
    d.version = 1;
    return d;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
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

  g.Store = { load, save, wipe, sanitize, newExam, blank, uid, bytesUsed, MAX_STUDENTS, get lastError() { return lastError; } };
})(window);
