/* UI controller. */
(function () {
  'use strict';
  const L = window.Layout, G = window.Grading, S = window.Store;

  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normId = (s) => String(s ?? '').replace(/^0+(?=\d)/, '');
  const pct = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const fmtPts = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, ''));
  const today = () => new Date().toISOString().slice(0, 10);
  const slug = (s) => String(s || 'exam').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exam';

  let toastTimer;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), 3500);
  }

  function download(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  function readFileText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
  }

  // ---------- state ----------
  let data = S.load();
  const session = { images: new Map(), log: [] };  // images: resultId -> {url, w, h, scale, H, read, rotated}
  const exam = () => data.exams.find((e) => e.id === data.activeExamId);
  const save = (now) => S.save(data, now);
  window.addEventListener('store-error', () => toast('Could not save — browser storage is full or disabled. Download a backup!', 'error'));

  let keyCache = { sig: null, key: null };
  function getKey() {
    const ex = exam();
    const sig = `${ex.id}|${ex.numQuestions}|${ex.numChoices}|${ex.keyText}`;
    if (keyCache.sig !== sig) keyCache = { sig, key: G.parseKey(ex.keyText || '', ex.numQuestions, ex.numChoices) };
    return keyCache.key;
  }

  function rosterIndex() {
    const m = new Map();
    for (const s of data.roster) if (s.id) m.set(normId(s.id), s);
    return m;
  }

  function scoreOf(r) {
    return G.scoreAnswers(r.answers, getKey(), exam().numQuestions);
  }

  /** Derived status info for every result in the active exam. */
  function annotateResults() {
    const idx = rosterIndex();
    const counts = new Map();
    for (const r of exam().results) {
      const k = normId(r.studentId);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return exam().results.map((r) => {
      const k = normId(r.studentId);
      const student = k ? idx.get(k) : null;
      const issues = [];
      if (!r.studentId) issues.push('no ID');
      else if (r.studentId.includes('?')) issues.push('ID unclear');
      else if (!student && data.roster.length) issues.push('ID not in roster');
      if (k && counts.get(k) > 1) issues.push('duplicate');
      const nFlags = (r.flags || []).length;
      if (nFlags) issues.push(`${nFlags} question${nFlags > 1 ? 's' : ''} to check`);
      for (const w of r.warnings || []) issues.push(w);
      return { r, student, issues, sc: scoreOf(r), sid: student ? student.id : r.studentId };
    });
  }

  // ---------- tabs ----------
  function showTab(name) {
    $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
    renderTab(name);
    try { sessionStorage.setItem('lambdagrader-tab', name); } catch { /* ignore */ }
  }
  function currentTab() {
    return $('.tabs [aria-selected=true]').dataset.tab;
  }
  function renderTab(name) {
    ({ exam: renderExam, roster: renderRoster, key: renderKey, sheets: renderSheets, scan: renderScan, results: renderResults })[name]();
  }
  $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- exam ----------
  function renderExamPicker() {
    const sel = $('#examSelect');
    sel.innerHTML = data.exams.map((e) => `<option value="${e.id}">${esc(e.title || 'Untitled')}</option>`).join('');
    sel.value = data.activeExamId;
  }
  $('#examSelect').addEventListener('change', (e) => {
    data.activeExamId = e.target.value;
    save();
    renderExamPicker();
    renderTab(currentTab());
  });

  const choiceSel = $('#exChoices');
  for (let c = 2; c <= L.MAX_CHOICES; c++) choiceSel.add(new Option(`${c} (A–${L.LETTERS[c - 1]})`, c));

  function renderExam() {
    const ex = exam();
    $('#exTitle').value = ex.title;
    $('#exQuestions').value = ex.numQuestions;
    $('#exChoices').value = ex.numChoices;
    $('#exDigits').value = ex.idDigits;
    $('#exPaper').value = ex.paper;
    $('#exErrors').textContent = '';
    const cap = L.maxQuestions(ex.numChoices);
    let hint = `One sheet holds up to ${cap} questions with ${ex.numChoices} choices.`;
    const maxRosterId = data.roster.reduce((m, s) => Math.max(m, s.id.length), 0);
    if (maxRosterId > ex.idDigits) hint += ` ⚠ Some roster IDs have ${maxRosterId} digits — increase "Student ID digits".`;
    if (ex.results.length) hint += ` ${ex.results.length} sheet(s) already graded — sheets record their own layout, so reprint if you change the layout.`;
    $('#exCapacity').textContent = hint;
    $('#exDelete').disabled = data.exams.length < 2;
    const kb = S.bytesUsed() / 1024;
    $('#storageInfo').textContent = `Using about ${kb < 1024 ? Math.ceil(kb) + ' KB' : (kb / 1024).toFixed(1) + ' MB'} of browser storage (browsers allow ~5 MB).`;
  }

  function applyExamSettings() {
    const ex = exam();
    const cfg = {
      numQuestions: parseInt($('#exQuestions').value, 10),
      numChoices: parseInt($('#exChoices').value, 10),
      idDigits: parseInt($('#exDigits').value, 10),
    };
    const errs = L.validateConfig(cfg);
    ex.title = $('#exTitle').value.trim() || 'Untitled exam';
    ex.paper = $('#exPaper').value;
    if (errs.length) {
      $('#exErrors').textContent = errs.join(' ');
      save();
      renderExamPicker();
      return;
    }
    Object.assign(ex, cfg);
    save();
    renderExamPicker();
    renderExam();
  }
  ['#exTitle', '#exQuestions', '#exChoices', '#exDigits', '#exPaper'].forEach((s) => $(s).addEventListener('change', applyExamSettings));

  $('#exNew').addEventListener('click', () => {
    const e = S.newExam(`Exam ${data.exams.length + 1}`);
    const cur = exam();
    Object.assign(e, { numQuestions: cur.numQuestions, numChoices: cur.numChoices, idDigits: cur.idDigits, paper: cur.paper });
    data.exams.push(e);
    data.activeExamId = e.id;
    save();
    renderExamPicker();
    renderExam();
    $('#exTitle').focus();
    $('#exTitle').select();
  });
  $('#exDuplicate').addEventListener('click', () => {
    const cur = exam();
    const e = { ...JSON.parse(JSON.stringify(cur)), id: S.uid(), title: cur.title + ' (copy)', results: [], created: new Date().toISOString() };
    data.exams.push(e);
    data.activeExamId = e.id;
    save();
    renderExamPicker();
    renderExam();
    toast('Duplicated settings and key (results not copied).');
  });
  $('#exDelete').addEventListener('click', () => {
    const cur = exam();
    if (data.exams.length < 2) return;
    if (!confirm(`Delete "${cur.title}" and its ${cur.results.length} result(s)? This cannot be undone.`)) return;
    data.exams = data.exams.filter((e) => e !== cur);
    data.activeExamId = data.exams[0].id;
    save();
    renderExamPicker();
    renderExam();
  });

  $('#dataExport').addEventListener('click', () => {
    download(JSON.stringify(data, null, 1), `lambdagrader-backup-${today()}.json`, 'application/json');
  });
  $('#dataImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = S.sanitize(JSON.parse(await readFileText(f)));
      if (!confirm(`Replace ALL current data with this backup (${d.roster.length} students, ${d.exams.length} exams)?`)) return;
      data = d;
      session.images.clear();
      session.log = [];
      save(true);
      renderExamPicker();
      renderExam();
      toast('Backup restored.', 'ok');
    } catch (err) {
      toast('Could not restore: ' + err.message, 'error');
    }
  });
  $('#dataWipe').addEventListener('click', () => {
    if (!confirm('Erase the roster, every exam, key and result stored in this browser? Download a backup first if unsure.')) return;
    S.wipe();
    data = S.blank();
    session.images.clear();
    session.log = [];
    save(true);
    renderExamPicker();
    renderExam();
    toast('All data erased.');
  });

  // ---------- roster ----------
  function rosterProblems() {
    const ex = exam();
    const seen = new Map();
    const dup = new Set();
    let missing = 0, long = 0;
    for (const s of data.roster) {
      if (!s.id) { missing++; continue; }
      const k = normId(s.id);
      if (seen.has(k)) dup.add(s.id);
      seen.set(k, s);
      if (s.id.length > ex.idDigits) long++;
    }
    const out = [];
    if (missing) out.push(`${missing} student(s) have no ID — they can't be matched to scans (use "Number students without an ID").`);
    if (dup.size) out.push(`Duplicate IDs: ${[...dup].join(', ')}.`);
    if (long) out.push(`${long} ID(s) are longer than the ${ex.idDigits} digits on this exam's sheet.`);
    return { text: out.join(' '), dup };
  }

  function renderRoster() {
    const f = $('#rosterFilter').value.trim().toLowerCase();
    const { text, dup } = rosterProblems();
    $('#rosterCount').textContent = `${data.roster.length} / ${S.MAX_STUDENTS}`;
    $('#rosterWarn').textContent = text;
    const rows = data.roster
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !f || `${s.id} ${s.name} ${s.section}`.toLowerCase().includes(f));
    $('#rosterTable tbody').innerHTML = rows.map(({ s, i }) => `
      <tr data-i="${i}" class="${dup.has(s.id) || !s.id ? 'bad' : ''}">
        <td><input data-f="id" value="${esc(s.id)}" inputmode="numeric" aria-label="ID"></td>
        <td><input data-f="name" value="${esc(s.name)}" aria-label="Name"></td>
        <td><input data-f="section" value="${esc(s.section)}" aria-label="Section"></td>
        <td><button class="icon" data-del title="Remove">✕</button></td>
      </tr>`).join('') || `<tr><td colspan="4" class="empty">No students yet.</td></tr>`;
  }
  $('#rosterFilter').addEventListener('input', renderRoster);
  $('#rosterTable').addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr || !e.target.dataset.f) return;
    const s = data.roster[+tr.dataset.i];
    let v = e.target.value.trim();
    if (e.target.dataset.f === 'id') {
      v = v.replace(/\D/g, '');
      e.target.value = v;
    }
    s[e.target.dataset.f] = v;
    save();
    renderRoster();
  });
  $('#rosterTable').addEventListener('click', (e) => {
    if (!e.target.matches('[data-del]')) return;
    const i = +e.target.closest('tr').dataset.i;
    data.roster.splice(i, 1);
    save();
    renderRoster();
  });
  $('#rosterAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (data.roster.length >= S.MAX_STUDENTS) return toast(`The roster is limited to ${S.MAX_STUDENTS} students.`, 'error');
    const id = String(fd.get('id') || '').replace(/\D/g, '');
    if (id && rosterIndex().has(normId(id))) return toast(`ID ${id} is already used.`, 'error');
    data.roster.push({ id, name: String(fd.get('name')).trim(), section: String(fd.get('section') || '').trim() });
    save();
    e.target.reset();
    e.target.elements.id.focus();
    renderRoster();
  });

  function importRows(rows) {
    if (!rows.length) return toast('Nothing to import.', 'error');
    const head = rows[0].map((c) => c.trim().toLowerCase());
    const find = (...names) => head.findIndex((h) => names.some((n) => h === n || h.replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, '')));
    let ci = { id: find('id', 'student id', 'studentid', 'student number', 'number', 'no'), name: find('name', 'full name', 'student', 'student name'),
      first: find('first', 'first name', 'firstname', 'given name'), last: find('last', 'last name', 'lastname', 'surname', 'family name'),
      section: find('section', 'class', 'period', 'group', 'course') };
    const hasHeader = Object.values(ci).some((v) => v >= 0);
    if (hasHeader) rows = rows.slice(1);
    else {
      // No header: guess "id, name, section" or "name, section" by whether column 1 is numeric.
      const numericFirst = rows.every((r) => /^\s*\d*\s*$/.test(r[0]));
      ci = numericFirst ? { id: 0, name: 1, first: -1, last: -1, section: 2 } : { id: -1, name: 0, first: -1, last: -1, section: 1 };
    }
    const incoming = rows.map((r) => {
      const get = (i) => (i >= 0 && r[i] != null ? r[i].trim() : '');
      let name = get(ci.name);
      if (!name && (ci.first >= 0 || ci.last >= 0)) name = [get(ci.first), get(ci.last)].filter(Boolean).join(' ');
      return { id: get(ci.id).replace(/\D/g, ''), name, section: get(ci.section) };
    }).filter((s) => s.name || s.id);

    const replace = $('#rosterReplace').checked;
    const base = replace ? [] : data.roster.slice();
    const idx = new Map(base.filter((s) => s.id).map((s) => [normId(s.id), s]));
    let added = 0, updated = 0, skipped = 0;
    for (const s of incoming) {
      if (!s.name) s.name = `Student ${s.id}`;
      const k = s.id && normId(s.id);
      if (k && idx.has(k)) { Object.assign(idx.get(k), s); updated++; continue; }
      if (base.length >= S.MAX_STUDENTS) { skipped++; continue; }
      base.push(s);
      if (k) idx.set(k, s);
      added++;
    }
    data.roster = base;
    save();
    renderRoster();
    toast(`Added ${added}, updated ${updated}${skipped ? `, skipped ${skipped} (limit ${S.MAX_STUDENTS})` : ''}.`, skipped ? 'error' : 'ok');
  }
  $('#rosterImportPaste').addEventListener('click', () => {
    importRows(G.parseCSV($('#rosterPaste').value));
    $('#rosterPaste').value = '';
  });
  $('#rosterFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importRows(G.parseCSV(await readFileText(f)));
  });
  $('#rosterAutoId').addEventListener('click', () => {
    const used = new Set(data.roster.filter((s) => s.id).map((s) => Number(s.id)));
    let n = 1, count = 0;
    for (const s of data.roster) {
      if (s.id) continue;
      while (used.has(n)) n++;
      s.id = String(n);
      used.add(n);
      count++;
    }
    save();
    renderRoster();
    toast(count ? `Numbered ${count} student(s).` : 'Every student already has an ID.');
  });
  $('#rosterExport').addEventListener('click', () => {
    download(G.toCSV([['id', 'name', 'section'], ...data.roster.map((s) => [s.id, s.name, s.section])]), `roster-${today()}.csv`, 'text/csv');
  });
  $('#rosterClear').addEventListener('click', () => {
    if (!data.roster.length || !confirm(`Remove all ${data.roster.length} students from the roster?`)) return;
    data.roster = [];
    save();
    renderRoster();
  });

  // ---------- key ----------
  function renderKey() {
    const ex = exam();
    const ta = $('#keyText');
    if (document.activeElement !== ta) ta.value = ex.keyText || '';
    const key = getKey();
    $('#keyErrors').textContent = key.errors.join(' ');
    $('#keyWarnings').textContent = key.warnings.join(' ');
    const scored = key.items.filter((it) => it && it.mode !== 'drop');
    const total = scored.reduce((s, it) => s + it.points, 0);
    $('#keySummary').textContent = `${scored.length} scored · ${fmtPts(total)} pts`;
    let html = '';
    for (let q = 0; q < ex.numQuestions; q++) {
      const it = key.items[q];
      const label = !it ? '—' : it.mode === 'free' ? 'free' : it.mode === 'drop' ? 'drop' : it.accept.split('').join('/');
      const pts = it && it.mode !== 'drop' && it.points !== 1 ? `<small>${fmtPts(it.points)}pt</small>` : '';
      html += `<div class="k ${!it ? 'none' : it.mode}"><b>${q + 1}</b><span>${label}</span>${pts}</div>`;
    }
    $('#keyGrid').innerHTML = html;
  }
  $('#keyText').addEventListener('input', (e) => {
    exam().keyText = e.target.value;
    save();
    renderKey();
  });
  $('#keyTemplate').addEventListener('click', () => {
    const ex = exam();
    const ta = $('#keyText');
    if (ta.value.trim() && !confirm('Replace the current key with an empty numbered template?')) return;
    ta.value = Array.from({ length: ex.numQuestions }, (_, i) => `${i + 1}. `).join('\n');
    ex.keyText = ta.value;
    save();
    renderKey();
    ta.focus();
    ta.setSelectionRange(3, 3);
  });
  $('#keyFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    exam().keyText = await readFileText(f);
    save();
    $('#keyText').value = exam().keyText;
    renderKey();
  });
  $('#keyDownload').addEventListener('click', () => download(exam().keyText || '', `${slug(exam().title)}-key.txt`));

  // ---------- sheets ----------
  let sheetUrl = null;
  function sheetMode() {
    return $('input[name=sheetMode]:checked').value;
  }
  function sheetStudents() {
    const sec = $('#sheetSection').value;
    return data.roster.filter((s) => !sec || s.section === sec).slice().sort((a, b) =>
      (a.section || '').localeCompare(b.section || '') || a.name.localeCompare(b.name));
  }
  function renderSheets() {
    const sel = $('#sheetSection');
    const cur = sel.value;
    const secs = [...new Set(data.roster.map((s) => s.section).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">All students (${data.roster.length})</option>` +
      secs.map((s) => `<option value="${esc(s)}">${esc(s)} (${data.roster.filter((r) => r.section === s).length})</option>`).join('');
    if (secs.includes(cur)) sel.value = cur;
    const ex = exam();
    const n = sheetMode() === 'blank' ? Math.max(1, parseInt($('#sheetCopies').value, 10) || 1) : sheetStudents().length;
    $('#sheetInfo').textContent = `"${ex.title}" · ${ex.numQuestions} questions · ${ex.numChoices} choices · ${ex.idDigits}-digit ID · ${ex.paper === 'a4' ? 'A4' : 'US Letter'} · ${n} page(s)`;
    $('#sheetError').textContent = '';
  }
  $$('input[name=sheetMode]').forEach((r) => r.addEventListener('change', renderSheets));
  $('#sheetCopies').addEventListener('input', renderSheets);
  $('#sheetSection').addEventListener('change', renderSheets);

  $('#sheetGenerate').addEventListener('click', async () => {
    const ex = exam();
    const errs = L.validateConfig(ex);
    const err = (m) => { $('#sheetError').textContent = m; };
    if (errs.length) return err(errs.join(' '));
    const opts = {};
    if (sheetMode() === 'blank') {
      opts.copies = Math.min(500, Math.max(1, parseInt($('#sheetCopies').value, 10) || 1));
    } else {
      if (!ex.idDigits) return err('Personalised sheets need a student ID on the sheet — set "Student ID digits" above 0.');
      const list = sheetStudents();
      if (!list.length) return err('No students in the roster (or section).');
      const noId = list.filter((s) => !s.id);
      if (noId.length) return err(`${noId.length} student(s) have no ID. Use "Number students without an ID" on the Students tab.`);
      const long = list.filter((s) => s.id.length > ex.idDigits);
      if (long.length) return err(`${long.length} ID(s) have more than ${ex.idDigits} digits (e.g. ${long[0].id}). Increase "Student ID digits".`);
      opts.students = list;
    }
    const btn = $('#sheetGenerate');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      opts.onProgress = (i, n) => { btn.textContent = `Generating… ${i}/${n}`; };
      const blob = await window.Sheet.generate(ex, opts);
      if (sheetUrl) URL.revokeObjectURL(sheetUrl);
      sheetUrl = URL.createObjectURL(blob);
      const name = `${slug(ex.title)}-${opts.students ? 'personalised' : 'blank'}-sheets.pdf`;
      const a = $('#sheetDownload');
      a.href = sheetUrl;
      a.download = name;
      a.hidden = false;
      $('#sheetPreview').src = sheetUrl;
      $('#sheetPreview').classList.add('on');
      $('#sheetPreviewEmpty').hidden = true;
      toast(`Created ${name}`, 'ok');
    } catch (e) {
      console.error(e);
      err('Could not generate: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate PDF';
    }
  });

  // ---------- scanning ----------
  function thresholdFor(read) {
    const m = $('#thresholdMode').value;
    return m === 'auto' ? read.autoThreshold : Number(m);
  }

  function canvasFor(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  async function renderPdfPage(page) {
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 1800 / Math.max(vp1.width, 1));
    const vp = page.getViewport({ scale });
    const c = canvasFor(Math.round(vp.width), Math.round(vp.height));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }

  function imageToCanvas(bitmap) {
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const c = canvasFor(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    return c;
  }

  async function makePreview(canvas, rotated) {
    const scale = Math.min(1, 1100 / canvas.width);
    const c = canvasFor(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
    const ctx = c.getContext('2d');
    if (rotated) {
      ctx.translate(c.width, c.height);
      ctx.rotate(Math.PI);
    }
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    return { url: URL.createObjectURL(blob), w: c.width, h: c.height, scale };
  }

  function fitAnswers(answers, n) {
    const out = answers.slice(0, n);
    while (out.length < n) out.push('');
    return out;
  }

  async function gradeCanvas(canvas, source) {
    const ex = exam();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const gray = window.OMR.toGray(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const read = window.OMR.readSheet(gray, { numQuestions: ex.numQuestions, numChoices: ex.numChoices, idDigits: ex.idDigits });
    const T = thresholdFor(read);
    const it = window.OMR.interpret(read, T);
    const warnings = read.warnings.slice();
    const c = read.cfg;
    if (c.numQuestions !== ex.numQuestions || c.numChoices !== ex.numChoices || c.idDigits !== ex.idDigits) {
      warnings.push(`Sheet layout (${c.numQuestions}q/${c.numChoices}ch/${c.idDigits}id) differs from exam settings`);
    }
    if (it.idProblem) it.flags.push({ q: 0, type: 'id' });
    const result = {
      id: S.uid(), source, studentId: it.studentId, answers: fitAnswers(it.answers, ex.numQuestions),
      flags: it.flags.filter((f) => f.q <= ex.numQuestions), warnings, threshold: Math.round(T * 100) / 100,
      scannedAt: new Date().toISOString(),
    };
    const prev = await makePreview(canvas, read.rotated);
    session.images.set(result.id, { ...prev, read });
    return result;
  }

  async function processFiles(files) {
    files = [...files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) || /^image\//.test(f.type));
    if (!files.length) return toast('Choose PDF or image files.', 'error');
    const ex = exam();
    const prog = $('#scanProgress');
    const status = $('#scanStatus');
    prog.hidden = false;
    let done = 0, total = 0, ok = 0, failed = 0;
    const jobs = [];
    // Count pages first so the progress bar is honest.
    for (const f of files) {
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        try {
          const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
          jobs.push({ f, pdf });
          total += pdf.numPages;
        } catch (e) {
          session.log.unshift({ source: f.name, error: 'Could not open PDF: ' + e.message });
          failed++;
        }
      } else {
        jobs.push({ f });
        total++;
      }
    }
    prog.max = Math.max(1, total);
    const handle = async (source, getCanvas) => {
      status.textContent = `Reading ${source}… (${done + 1}/${total})`;
      try {
        const canvas = await getCanvas();
        const r = await gradeCanvas(canvas, source);
        if (exam() !== ex) throw new Error('Exam changed during scanning');
        ex.results.push(r);
        session.log.unshift({ source, resultId: r.id });
        ok++;
        canvas.width = canvas.height = 0;
      } catch (e) {
        console.error(e);
        session.log.unshift({ source, error: e.message });
        failed++;
      }
      done++;
      prog.value = done;
      if (done % 3 === 0 || done === total) { save(); renderScan(); }
      await new Promise((r) => setTimeout(r, 0));
    };
    for (const job of jobs) {
      if (job.pdf) {
        for (let p = 1; p <= job.pdf.numPages; p++) {
          await handle(`${job.f.name} p${p}`, async () => {
            const page = await job.pdf.getPage(p);
            const c = await renderPdfPage(page);
            page.cleanup();
            return c;
          });
        }
        job.pdf.destroy();
      } else {
        await handle(job.f.name, async () => imageToCanvas(await createImageBitmap(job.f)));
      }
    }
    save(true);
    prog.hidden = true;
    status.textContent = `Done: ${ok} sheet(s) read${failed ? `, ${failed} failed` : ''}.`;
    renderScan();
    toast(status.textContent, failed ? 'error' : 'ok');
  }

  const drop = $('#dropZone');
  $('#scanFiles').addEventListener('change', (e) => { processFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => processFiles(e.dataTransfer.files));
  // Keep the browser from opening files dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('#rereadAll').addEventListener('click', () => {
    let n = 0;
    for (const r of exam().results) {
      const img = session.images.get(r.id);
      if (!img || r.edited) continue;
      const T = thresholdFor(img.read);
      const it = window.OMR.interpret(img.read, T);
      r.answers = fitAnswers(it.answers, exam().numQuestions);
      if (!r.idEdited) r.studentId = it.studentId;
      r.flags = it.flags.filter((f) => f.q <= exam().numQuestions);
      if (it.idProblem) r.flags.push({ q: 0, type: 'id' });
      r.threshold = Math.round(T * 100) / 100;
      n++;
    }
    save();
    renderScan();
    toast(n ? `Re-read ${n} sheet(s).` : 'No unedited sheets from this session to re-read.');
  });

  function renderScan() {
    const idx = new Map(annotateResults().map((a) => [a.r.id, a]));
    $('#scanTable tbody').innerHTML = session.log.map((l) => {
      if (l.error) return `<tr class="bad"><td>${esc(l.source)}</td><td colspan="3"></td><td>✗ ${esc(l.error)}</td><td></td></tr>`;
      const a = idx.get(l.resultId);
      if (!a) return '';
      return `<tr class="${a.issues.length ? 'warnrow' : ''}">
        <td>${esc(l.source)}</td><td>${esc(a.sid || '—')}</td><td>${esc(a.student ? a.student.name : '')}</td>
        <td>${fmtPts(a.sc.score)} / ${fmtPts(a.sc.possible)}</td>
        <td>${a.issues.length ? '⚑ ' + esc(a.issues.join('; ')) : '✓'}</td>
        <td><button data-review="${a.r.id}">Review</button></td></tr>`;
    }).join('') || `<tr><td colspan="6" class="empty">No sheets scanned in this session yet.</td></tr>`;
  }
  $('#scanTable').addEventListener('click', (e) => { if (e.target.dataset.review) openReview(e.target.dataset.review); });

  // ---------- results ----------
  let sortBy = { key: 'name', dir: 1 };
  $$('#resultsTable th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    sortBy = { key: th.dataset.sort, dir: sortBy.key === th.dataset.sort ? -sortBy.dir : 1 };
    renderResults();
  }));

  function stats(values) {
    if (!values.length) return null;
    const v = values.slice().sort((a, b) => a - b);
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
    const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    return { n: v.length, mean, sd, med, min: v[0], max: v[v.length - 1] };
  }

  function itemAnalysis(rows) {
    const ex = exam();
    const key = getKey();
    const out = [];
    for (let q = 0; q < ex.numQuestions; q++) {
      const counts = new Array(ex.numChoices).fill(0);
      let blank = 0, multi = 0, correct = 0, n = 0;
      for (const { r, sc } of rows) {
        const a = r.answers[q] || '';
        if (!a) blank++;
        else if (a.length > 1) multi++;
        else counts[L.LETTERS.indexOf(a)]++;
        if (sc.perQ[q] != null) { n++; if (sc.perQ[q]) correct++; }
      }
      const it = key.items[q];
      out.push({ q: q + 1, key: !it ? '' : it.mode === 'normal' ? it.accept : it.mode, pct: n ? (100 * correct) / n : null, counts, blank, multi });
    }
    return out;
  }

  function renderResults() {
    const ex = exam();
    const rows = annotateResults();
    const key = getKey();
    const noKey = !key.items.some(Boolean);
    $('#resultsWarn').textContent = noKey ? 'No answer key yet — scores are 0. Add the key on the Answer key tab; results update automatically.'
      : key.errors.length ? 'The answer key has errors — see the Answer key tab.' : '';

    const st = stats(rows.map((a) => a.sc.percent));
    const possible = rows[0] ? rows[0].sc.possible : 0;
    $('#stats').innerHTML = st ? [
      ['Sheets', st.n], ['Mean', pct(st.mean) + '%'], ['Median', pct(st.med) + '%'], ['High', pct(st.max) + '%'],
      ['Low', pct(st.min) + '%'], ['Std dev', pct(st.sd)], ['Points possible', fmtPts(possible)],
      ['Need attention', rows.filter((a) => a.issues.length).length],
    ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('') : '<p class="hint">No results yet. Scan some sheets on the Scan &amp; grade tab.</p>';

    const val = (a) => ({ id: a.sid, name: a.student ? a.student.name : '', section: a.student ? a.student.section : '', score: a.sc.score, percent: a.sc.percent }[sortBy.key]);
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sortBy.dir;
    });
    $$('#resultsTable th[data-sort]').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === sortBy.key));

    $('#resultsTable tbody').innerHTML = rows.map((a) => `
      <tr class="${a.issues.length ? 'warnrow' : ''}">
        <td>${esc(a.sid || '—')}</td>
        <td>${a.student ? esc(a.student.name) : '<i class="muted">unknown</i>'}</td>
        <td>${esc(a.student ? a.student.section : '')}</td>
        <td>${fmtPts(a.sc.score)} / ${fmtPts(a.sc.possible)}</td>
        <td>${pct(a.sc.percent)}</td>
        <td class="flags">${esc(a.issues.join('; '))}</td>
        <td class="muted">${esc(a.r.source)}</td>
        <td><button data-review="${a.r.id}">Review</button></td>
      </tr>`).join('') || `<tr><td colspan="8" class="empty">No results for this exam.</td></tr>`;

    const got = new Set(rows.map((a) => a.student).filter(Boolean));
    const missing = data.roster.filter((s) => !got.has(s));
    $('#missingCount').textContent = missing.length;
    $('#missingList').textContent = missing.length ? missing.map((s) => `${s.name} (${s.id || 'no ID'})`).join(', ') : 'Everyone on the roster has a sheet.';

    const items = itemAnalysis(rows);
    const letters = L.LETTERS.slice(0, ex.numChoices).split('');
    $('#itemTable').innerHTML = `<thead><tr><th>Q</th><th>Key</th><th>% correct</th>${letters.map((l) => `<th>${l}</th>`).join('')}<th>Blank</th><th>Multi</th></tr></thead><tbody>` +
      items.map((i) => `<tr><td>${i.q}</td><td>${esc(i.key)}</td><td class="${i.pct != null && i.pct < 40 ? 'low' : ''}">${i.pct == null ? '—' : pct(i.pct)}</td>` +
        i.counts.map((c, k) => `<td class="${i.key.includes(letters[k]) ? 'keycell' : ''}">${c}</td>`).join('') +
        `<td>${i.blank}</td><td>${i.multi}</td></tr>`).join('') + '</tbody>';
  }
  $('#resultsTable').addEventListener('click', (e) => { if (e.target.dataset.review) openReview(e.target.dataset.review); });

  $('#csvResults').addEventListener('click', () => {
    const ex = exam();
    const rows = annotateResults();
    const head = ['Student ID', 'Name', 'Section', 'Score', 'Possible', 'Percent', 'Correct', 'Flags', 'Source', 'Scanned at'];
    for (let q = 1; q <= ex.numQuestions; q++) head.push(`Q${q}`);
    const body = rows.map((a) => [a.sid, a.student ? a.student.name : '', a.student ? a.student.section : '',
      fmtPts(a.sc.score), fmtPts(a.sc.possible), pct(a.sc.percent), a.sc.correct, a.issues.join('; '), a.r.source, a.r.scannedAt, ...a.r.answers]);
    body.sort((x, y) => String(x[1]).localeCompare(String(y[1])) || String(x[0]).localeCompare(String(y[0])));
    download(G.toCSV([head, ...body]), `${slug(ex.title)}-results-${today()}.csv`, 'text/csv');
  });
  $('#csvGradebook').addEventListener('click', () => {
    const ex = exam();
    const rows = annotateResults();
    const by = new Map();
    for (const a of rows) if (a.student) by.set(a.student, [...(by.get(a.student) || []), a]);
    const head = ['Student ID', 'Name', 'Section', 'Score', 'Possible', 'Percent', 'Status'];
    const body = data.roster.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
      const list = by.get(s);
      if (!list) return [s.id, s.name, s.section, '', '', '', 'missing'];
      const a = list[list.length - 1];
      return [s.id, s.name, s.section, fmtPts(a.sc.score), fmtPts(a.sc.possible), pct(a.sc.percent), list.length > 1 ? 'duplicate scans — latest used' : (a.issues.length ? 'check' : 'graded')];
    });
    for (const a of rows) if (!a.student) body.push([a.r.studentId, '', '', fmtPts(a.sc.score), fmtPts(a.sc.possible), pct(a.sc.percent), `unmatched sheet (${a.r.source})`]);
    download(G.toCSV([head, ...body]), `${slug(ex.title)}-gradebook-${today()}.csv`, 'text/csv');
  });
  $('#csvItems').addEventListener('click', () => {
    const ex = exam();
    const letters = L.LETTERS.slice(0, ex.numChoices).split('');
    const items = itemAnalysis(annotateResults());
    download(G.toCSV([['Question', 'Key', 'Percent correct', ...letters, 'Blank', 'Multiple'],
      ...items.map((i) => [i.q, i.key, i.pct == null ? '' : pct(i.pct), ...i.counts, i.blank, i.multi])]), `${slug(ex.title)}-items-${today()}.csv`, 'text/csv');
  });
  $('#resultsClear').addEventListener('click', () => {
    const ex = exam();
    if (!ex.results.length || !confirm(`Delete all ${ex.results.length} result(s) for "${ex.title}"?`)) return;
    ex.results = [];
    session.log = [];
    save();
    renderResults();
  });

  // ---------- review ----------
  const dlg = $('#review');
  let rv = null;  // {id, img, bubbles: [{q, i, x, y}], r}

  function openReview(id) {
    const r = exam().results.find((x) => x.id === id);
    if (!r) return;
    rv = { id, r, img: session.images.get(id) || null, image: null };
    const sel = $('#rvStudent');
    sel.innerHTML = '<option value="">—</option>' + data.roster.slice().sort((a, b) => a.name.localeCompare(b.name))
      .filter((s) => s.id).map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.id)})</option>`).join('');
    if (!dlg.open) dlg.showModal();
    $('#rvCanvas').hidden = !rv.img;
    $('#rvNoImage').hidden = !!rv.img;
    if (rv.img) {
      const im = new Image();
      im.onload = () => { if (rv && rv.id === id) { rv.image = im; drawReview(); } };
      im.src = rv.img.url;
    }
    renderReviewSide();
  }

  function reviewGeometry() {
    const { img } = rv;
    const layout = L.build(img.read.cfg);
    const H = img.read.H;
    const toPx = (x, y) => {
      const [u, v] = window.OMR.apply(H, x, y);
      // H targets the (upright) image that was read; the preview was drawn upright too.
      return [u * img.scale, v * img.scale];
    };
    const [ax, ay] = toPx(0, 0), [bx, by] = toPx(L.BUBBLE_R, 0);
    const rad = Math.hypot(bx - ax, by - ay);
    const bubbles = [];
    layout.questions.forEach((q, qi) => q.bubbles.forEach((b, i) => { const [x, y] = toPx(b.x, b.y); bubbles.push({ q: qi, i, x, y }); }));
    return { bubbles, rad };
  }

  function drawReview() {
    if (!rv || !rv.img || !rv.image) return;
    const c = $('#rvCanvas');
    c.width = rv.img.w;
    c.height = rv.img.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(rv.image, 0, 0);
    const { bubbles, rad } = reviewGeometry();
    rv.geom = { bubbles, rad };
    const key = getKey();
    const flagged = new Set((rv.r.flags || []).map((f) => f.q - 1));
    ctx.lineWidth = Math.max(1.5, rad * 0.3);
    for (const b of bubbles) {
      if (b.q >= rv.r.answers.length) continue;
      const letter = L.LETTERS[b.i];
      const marked = (rv.r.answers[b.q] || '').includes(letter);
      const it = key.items[b.q];
      const isKey = it && it.mode === 'normal' && it.accept.includes(letter);
      if (marked) {
        ctx.fillStyle = isKey ? 'rgba(22,163,74,0.45)' : 'rgba(37,99,235,0.45)';
        ctx.beginPath(); ctx.arc(b.x, b.y, rad * 1.1, 0, Math.PI * 2); ctx.fill();
        if (it && it.mode === 'normal' && !isKey) {
          ctx.strokeStyle = 'rgba(220,38,38,0.95)';
          ctx.beginPath(); ctx.arc(b.x, b.y, rad * 1.45, 0, Math.PI * 2); ctx.stroke();
        }
      }
      if (isKey) {
        ctx.strokeStyle = 'rgba(22,163,74,0.95)';
        ctx.beginPath(); ctx.arc(b.x, b.y, rad * 1.3, 0, Math.PI * 2); ctx.stroke();
      }
      if (flagged.has(b.q) && b.i === 0) {
        ctx.fillStyle = 'rgba(245,158,11,0.9)';
        ctx.beginPath(); ctx.arc(b.x - rad * 3.2, b.y, rad * 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function toggleAnswer(q, letter) {
    const r = rv.r;
    const cur = new Set((r.answers[q] || '').split('').filter(Boolean));
    if (cur.has(letter)) cur.delete(letter); else cur.add(letter);
    r.answers[q] = [...cur].sort().join('');
    r.edited = true;
    r.flags = (r.flags || []).filter((f) => f.q !== q + 1);
    save();
    drawReview();
    renderReviewSide();
  }

  $('#rvCanvas').addEventListener('click', (e) => {
    if (!rv || !rv.geom) return;
    const c = e.currentTarget, rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * c.width) / rect.width;
    const y = ((e.clientY - rect.top) * c.height) / rect.height;
    let best = null, bd = Infinity;
    for (const b of rv.geom.bubbles) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) { bd = d; best = b; }
    }
    if (best && bd < rv.geom.rad * 1.6 && best.q < rv.r.answers.length) toggleAnswer(best.q, L.LETTERS[best.i]);
  });

  function renderReviewSide() {
    const { r } = rv;
    const ex = exam();
    const student = rosterIndex().get(normId(r.studentId));
    const sc = scoreOf(r);
    $('#rvTitle').textContent = `Review · ${r.source}`;
    const idInput = $('#rvId');
    if (document.activeElement !== idInput) idInput.value = r.studentId || '';
    $('#rvStudent').value = student ? student.id : '';
    $('#rvName').textContent = student ? `${student.name}${student.section ? ' · ' + student.section : ''}` : (r.studentId ? 'ID not found in roster' : 'No ID read');
    $('#rvName').className = 'rv-name ' + (student ? '' : 'bad');
    $('#rvScore').textContent = `Score ${fmtPts(sc.score)} / ${fmtPts(sc.possible)} (${pct(sc.percent)}%)`;
    const key = getKey();
    const flagged = new Map((r.flags || []).map((f) => [f.q, f.type]));
    let html = '';
    for (let q = 0; q < ex.numQuestions; q++) {
      const it = key.items[q];
      const a = r.answers[q] || '';
      const ok = sc.perQ[q];
      html += `<div class="rq ${flagged.has(q + 1) ? 'flag' : ''} ${ok === true ? 'ok' : ok === false ? 'no' : ''}"><b>${q + 1}</b>`;
      for (let i = 0; i < ex.numChoices; i++) {
        const l = L.LETTERS[i];
        const k = it && it.mode === 'normal' && it.accept.includes(l);
        html += `<button type="button" data-q="${q}" data-l="${l}" class="${a.includes(l) ? 'on' : ''} ${k ? 'key' : ''}">${l}</button>`;
      }
      html += '</div>';
    }
    $('#rvAnswers').innerHTML = html;
    const names = { multiple: 'more than one bubble marked', erasure: 'possible erasure — darkest mark used', faint: 'faint or partial mark', id: 'student ID bubbles unclear' };
    const items = (r.flags || []).map((f) => `<li>${f.q ? 'Q' + f.q : 'ID'}: ${names[f.type] || f.type}</li>`)
      .concat((r.warnings || []).map((w) => `<li>${esc(w)}</li>`));
    $('#rvFlags').innerHTML = items.join('') + (items.length ? '<li><button type="button" id="rvClearFlags">Mark reviewed (clear flags)</button></li>' : '');
  }

  $('#rvAnswers').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q]');
    if (b) toggleAnswer(+b.dataset.q, b.dataset.l);
  });
  $('#rvFlags').addEventListener('click', (e) => {
    if (e.target.id !== 'rvClearFlags') return;
    rv.r.flags = [];
    rv.r.warnings = [];
    save();
    drawReview();
    renderReviewSide();
  });
  function setReviewId(v) {
    rv.r.studentId = v.replace(/[^\d?]/g, '');
    rv.r.idEdited = true;
    rv.r.flags = (rv.r.flags || []).filter((f) => f.q !== 0);
    save();
    renderReviewSide();
  }
  $('#rvId').addEventListener('change', (e) => setReviewId(e.target.value));
  $('#rvStudent').addEventListener('change', (e) => { if (e.target.value) setReviewId(e.target.value); });
  $('#rvUseAsKey').addEventListener('click', () => {
    const ex = exam();
    if (ex.keyText.trim() && !confirm('Replace the current answer key with the answers on this sheet?')) return;
    ex.keyText = G.keyToText(rv.r.answers);
    save();
    renderReviewSide();
    drawReview();
    toast('Answer key replaced. Blank questions were marked as dropped (-).', 'ok');
  });
  $('#rvDelete').addEventListener('click', () => {
    if (!confirm('Delete this scanned sheet from the results?')) return;
    const ex = exam();
    const i = ex.results.findIndex((x) => x.id === rv.id);
    ex.results.splice(i, 1);
    session.log = session.log.filter((l) => l.resultId !== rv.id);
    save();
    const next = ex.results[Math.min(i, ex.results.length - 1)];
    if (next) openReview(next.id); else dlg.close();
  });
  function step(dir, flaggedOnly) {
    const list = flaggedOnly ? annotateResults().filter((a) => a.issues.length).map((a) => a.r) : exam().results;
    if (!list.length) return toast('Nothing flagged. 🎉', 'ok');
    const all = exam().results;
    const pos = all.findIndex((x) => x.id === rv.id);
    for (let k = 1; k <= all.length; k++) {
      const cand = all[(pos + dir * k + all.length * 2) % all.length];
      if (list.includes(cand)) return openReview(cand.id);
    }
  }
  $('#rvPrev').addEventListener('click', () => step(-1));
  $('#rvNext').addEventListener('click', () => step(1));
  $('#rvNextFlag').addEventListener('click', () => step(1, true));
  dlg.addEventListener('close', () => {
    rv = null;
    renderTab(currentTab());
  });

  // ---------- boot ----------
  const gh = location.hostname.match(/^([\w-]+)\.github\.io$/);
  if (gh) {
    const repo = location.pathname.split('/').filter(Boolean)[0];
    const a = document.createElement('a');
    a.href = `https://github.com/${gh[1]}/${repo || gh[1] + '.github.io'}`;
    a.textContent = 'source on GitHub';
    $('#repoLink').append('· ', a);
  }
  renderExamPicker();
  let first = 'exam';
  try { first = sessionStorage.getItem('lambdagrader-tab') || 'exam'; } catch { /* ignore */ }
  showTab($(`.tabs [data-tab="${first}"]`) ? first : 'exam');

  // Hooks for automated tests.
  window.__omrApp = { get data() { return data; }, processFiles, session };
})();
