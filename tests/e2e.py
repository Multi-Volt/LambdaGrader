"""End-to-end test: build a roster of name.# IDs (with repeated numbers), a key
with select-all-that-apply questions, generate personalised and blank sheets,
fill them in like students would, simulate a scanner (skew, blur, noise,
shading, one page upside down, one shrunk), then grade the scan in a headless
browser and check every answer, every student match, and the scores.

    pip install playwright pymupdf pillow numpy && playwright install chromium
    python tests/e2e.py            # NQ=120 python tests/e2e.py for a full sheet
"""
import base64, os, random, subprocess, sys, time
import numpy as np
import pymupdf as fitz
from PIL import Image, ImageFilter
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
SITE = os.path.dirname(HERE)
PORT = 8765
NQ, NC, ND = int(os.environ.get('NQ', 40)), int(os.environ.get('NC', 5)), 4
LET = 'ABCDEFGH'[:NC]
random.seed(4)

ROSTER = [  # name.#, name, section
    ('lovelace.12', 'Ada Lovelace', 'Period 1'),
    ('turing.12', 'Alan Turing', 'Period 1'),       # same number as lovelace
    ('hopper.7', 'Grace Hopper', 'Period 2'),
    ('hughes.7', 'Langston Hughes', 'Period 2'),    # same number as hopper
    ('johnson.31', 'Katherine Johnson', 'Period 2'),
    ('liskov.5', 'Barbara Liskov', 'Period 1'),
]
# Blank sheets filled in by hand: (who, number bubbled, expected match or None=ambiguous)
BLANK = [
    ('johnson.31', '31', 'johnson.31'),
    ('hopper.7', '7', None),             # hopper.7 vs hughes.7: must be flagged
    ('lovelace.12', '12', None),         # lovelace.12 vs turing.12
    ('liskov.5', '5', 'liskov.5'),
]

key = [random.choice(LET) for _ in range(NQ)]
multi = {q: ''.join(sorted(random.sample(LET, 3))) for q in range(4, NQ, 7)}  # select-all questions
partial_q = min(multi)  # this one gets partial credit
for q, v in multi.items():
    key[q] = v
key_text = '# key\n' + '\n'.join(
    f"{q + 1}. {k}{' partial' if q == partial_q else ''}" for q, k in enumerate(key))


def fetch_pdf(pg):
    b64 = pg.evaluate("""async () => { const r = await fetch(document.querySelector('#sheetDownload').href);
        const buf = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s); }""")
    return base64.b64decode(b64)


def student_answers():
    ans = []
    for q in range(NQ):
        r = random.random()
        if q in multi:
            want = multi[q]
            if r < 0.5: a = want
            elif r < 0.8: a = ''.join(sorted(set(want[:2]) | {random.choice(LET)}))
            else: a = want[0]
        elif r < 0.06: a = ''
        elif r < 0.09: a = ''.join(sorted(random.sample(LET, 2)))
        elif r < 0.75: a = key[q]
        else: a = random.choice(LET)
        ans.append(a)
    return ans


def fill(page, layout, ans, num=None, erase_on=None):
    pw, ph = page.rect.width / 72 * 25.4, page.rect.height / 72 * 25.4
    ox, oy = (pw - 180) / 2, (ph - 250) / 2
    mm = 72 / 25.4

    def dot(b, gray=None):
        g = random.uniform(0.15, 0.4) if gray is None else gray
        page.draw_circle(fitz.Point((ox + b['x'] + random.uniform(-.3, .3)) * mm, (oy + b['y'] + random.uniform(-.3, .3)) * mm),
                         random.uniform(1.35, 1.75) * mm, color=None, fill=(g, g, g))

    for q, a in enumerate(ans):
        for l in a:
            dot(layout['questions'][q]['bubbles'][LET.index(l)])
    if num is not None:
        digits = num.rjust(ND, '0')
        for j, d in enumerate(digits):
            dot(layout['id'][j]['bubbles'][int(d)])
    if erase_on is not None:
        q = erase_on
        l = next(c for c in LET if c not in ans[q])
        dot(layout['questions'][q]['bubbles'][LET.index(l)], gray=0.85)


def scan(pdf_in, pdf_out):
    imgs = []
    for pi, page in enumerate(fitz.open(pdf_in)):
        pix = page.get_pixmap(dpi=200, colorspace=fitz.csGRAY)
        im = Image.frombytes('L', (pix.width, pix.height), pix.samples)
        im = im.rotate(random.uniform(-2.5, 2.5), resample=Image.BICUBIC, fillcolor=235,
                       translate=(random.randint(-25, 25), random.randint(-25, 25)))
        if pi == 2: im = im.rotate(180)
        if pi == 3: im = im.resize((int(im.width * 0.93), int(im.height * 0.93)))
        im = im.filter(ImageFilter.GaussianBlur(0.8))
        a = np.asarray(im).astype(np.float32) * 0.9 + 12 + np.random.normal(0, 6, (im.height, im.width))
        a = a - np.linspace(0, 25, a.shape[1])[None, :]
        imgs.append(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    imgs[0].save(pdf_out, save_all=True, append_images=imgs[1:], resolution=200)


def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', SITE],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errors, failures = [], []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
            pg.on('dialog', lambda d: d.accept())
            pg.goto(f'http://localhost:{PORT}/')

            pg.fill('#exTitle', 'Biology Midterm, Part A'); pg.press('#exTitle', 'Tab')
            pg.fill('#exQuestions', str(NQ)); pg.press('#exQuestions', 'Tab')
            pg.select_option('#exChoices', str(NC))
            pg.fill('#exDigits', str(ND)); pg.press('#exDigits', 'Tab')
            pg.screenshot(path=f'{OUT}/exam.png', full_page=True)

            pg.click('[data-tab=roster]')
            pg.fill('#rosterPaste', 'name.#,name,section\n' + '\n'.join(','.join(r) for r in ROSTER))
            pg.click('#rosterImportPaste')
            pg.screenshot(path=f'{OUT}/roster.png', full_page=True)

            pg.click('[data-tab=key]')
            pg.fill('#keyText', key_text)
            pg.screenshot(path=f'{OUT}/key.png', full_page=True)

            pg.click('[data-tab=sheets]')
            pg.check('input[name=sheetMode][value=roster]')
            pg.click('#sheetGenerate')
            pg.wait_for_selector('#sheetDownload:not([hidden])')
            open(f'{OUT}/personal.pdf', 'wb').write(fetch_pdf(pg))
            pg.check('input[name=sheetMode][value=blank]')
            pg.fill('#sheetCopies', str(len(BLANK)))
            pg.evaluate("document.querySelector('#sheetDownload').hidden = true")
            pg.click('#sheetGenerate')
            pg.wait_for_selector('#sheetDownload:not([hidden])')
            open(f'{OUT}/blank.pdf', 'wb').write(fetch_pdf(pg))
            layout = pg.evaluate(f'Layout.build({{numQuestions:{NQ},numChoices:{NC},idDigits:{ND}}})')

            # Personalised sheets are printed sorted by section, then name.
            printed = [r[0] for r in sorted(ROSTER, key=lambda r: (r[2], r[1]))]
            expected = []  # (answers, expected name.# or None)
            doc = fitz.open(f'{OUT}/personal.pdf')
            for i, page in enumerate(doc):
                ans = student_answers()
                fill(page, layout, ans, erase_on=1 if i == 1 else None)
                expected.append((ans, printed[i]))
            bdoc = fitz.open(f'{OUT}/blank.pdf')
            for page, (who, num, match) in zip(bdoc, BLANK):
                ans = student_answers()
                fill(page, layout, ans, num=num)
                expected.append((ans, match))
            doc.insert_pdf(bdoc)
            doc.save(f'{OUT}/filled.pdf')
            scan(f'{OUT}/filled.pdf', f'{OUT}/scan.pdf')

            pg.click('[data-tab=scan]')
            pg.set_input_files('#scanFiles', f'{OUT}/scan.pdf')
            for _ in range(800):
                if pg.inner_text('#scanStatus').startswith('Done'): break
                time.sleep(0.25)
            print(pg.inner_text('#scanStatus'))
            pg.screenshot(path=f'{OUT}/scan.png', full_page=True)

            rows = pg.evaluate("""() => { const ex = window.__omrApp.data.exams[0];
                return window.__omrApp.annotate().map(a => ({ src: a.r.source, answers: a.r.answers, student: a.student && a.student.id,
                  issues: a.issues, cands: a.candidates.map(c => c.id), score: a.sc.score, possible: a.sc.possible })); }""")
            tot = wrong = 0
            for (ans, match), r in zip(expected, rows):
                bad = [(q + 1, ans[q], r['answers'][q]) for q in range(NQ) if ans[q] != r['answers'][q]]
                tot += NQ; wrong += len(bad)
                ok_match = r['student'] == match
                if bad or not ok_match: failures.append((r['src'], bad, r['student'], match))
                print(f"{r['src']:14} -> {str(r['student']):12} expected {str(match):12} {'OK' if ok_match else 'WRONG'}"
                      f"  cands={r['cands']}  score {r['score']}/{r['possible']}  answer mismatches={bad}")
            print(f'answer accuracy: {tot - wrong}/{tot}')
            margins = pg.evaluate('''() => { let off = 0, on = 1; const ex = window.__omrApp.data.exams[0];
                for (const [id, img] of window.__omrApp.session.images) { const r = ex.results.find(x => x.id === id);
                  img.read.qFills.forEach((f, q) => f.forEach((v, i) => { if (r.answers[q].includes('ABCDEFGH'[i])) on = Math.min(on, v); else off = Math.max(off, v); })); }
                return [off, on]; }''')
            print('darkest blank bubble %.3f, lightest mark %.3f' % tuple(margins))
            print('blank bubble darkness by letter (max):', pg.evaluate('''() => { const m = {}; const ex = window.__omrApp.data.exams[0]; for (const [id, img] of window.__omrApp.session.images) { const r = ex.results.find(x => x.id === id); img.read.qFills.forEach((f, q) => f.forEach((v, i) => { const l = 'ABCDEFGH'[i]; if (!r.answers[q].includes(l) && (r.flags || []).every(x => x.q !== q + 1)) m[l] = Math.max(m[l] || 0, +v.toFixed(3)); })); } return m; }'''))

            # Scoring rules for select-all questions.
            checks = pg.evaluate("""() => { const it = (a, m, sc) => ({mode:'normal', accept:a, match:m, points:1, scoring:sc});
              const c = Grading.creditFor; return [
                c(it('ACD','all'), 'ACD', 'exact'), c(it('ACD','all'), 'AC', 'exact'), c(it('ACD','all'), 'ACE', 'partial'),
                c(it('ACD','all'), 'ACDE', 'partial'), c(it('ACD','all'), 'BE', 'partial'), c(it('AC','one'), 'C', 'exact'),
                c(it('AC','one'), 'AC', 'exact'), c(it('ACD','all','partial'), 'AC', 'exact') ]; }""")
            want = [1, 0, 1 / 3, 2 / 3, 0, 1, 0, 2 / 3]
            print('credit checks:', ['%.3f' % v for v in checks])
            if any(abs(a - b) > 1e-9 for a, b in zip(checks, want)): failures.append(('creditFor', checks, want))

            # Resolve an ambiguous sheet by hand in the review dialog.
            amb = next(i for i, (_, m) in enumerate(expected) if m is None)
            pg.click('[data-tab=results]')
            pg.evaluate(f"window.__omrApp.openReview(window.__omrApp.data.exams[0].results[{amb}].id)")
            time.sleep(0.5)
            pg.screenshot(path=f'{OUT}/review.png')
            opts = pg.eval_on_selector_all('#rvPick button[data-key]', 'els => els.map(e => e.textContent)')
            print('review suggests:', opts)
            pg.fill('#rvSearch', BLANK[1][0])  # search the roster for the right student
            pg.click('#rvPick button[data-key]')
            pg.keyboard.press('Escape')
            fixed = pg.evaluate(f"window.__omrApp.annotate()[{amb}].student.id")
            print('after picking by hand:', fixed)
            pg.screenshot(path=f'{OUT}/results.png', full_page=True)

            pg.reload()
            print('results after reload:', pg.evaluate('window.__omrApp.data.exams[0].results.length'))
            b.close()
    finally:
        srv.terminate()
    print('console errors:', errors)
    if failures or errors:
        print('FAILED:', failures)
        sys.exit(1)
    print('ALL PASSED')


if __name__ == '__main__':
    main()
