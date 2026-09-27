"""End-to-end test: generate personalised sheets, fill them in, simulate a
scanner (skew, blur, noise, shading, one page upside down, one shrunk), then
grade the scan in a headless browser and compare.

    pip install playwright pymupdf pillow numpy && playwright install chromium
    python tests/e2e.py            # NQ=120 python tests/e2e.py for a full sheet
"""
import base64, json, random, subprocess, sys, time, io, os
import pymupdf as fitz
from PIL import Image, ImageFilter, ImageDraw
import numpy as np
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
random.seed(4)
NQ, NC, ND = int(os.environ.get('NQ', 40)), int(os.environ.get('NC', 5)), 6
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 1000}, accept_downloads=True)
        pg.on('console', lambda m: errors.append(m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        pg.on('dialog', lambda d: d.accept())
        pg.goto(f'http://localhost:{PORT}/')
        # exam settings
        pg.fill('#exTitle', 'Biology Midterm — Part A'); pg.press('#exTitle', 'Tab')
        pg.fill('#exQuestions', str(NQ)); pg.press('#exQuestions', 'Tab')
        pg.select_option('#exChoices', str(NC))
        pg.fill('#exDigits', str(ND)); pg.press('#exDigits', 'Tab')
        pg.screenshot(path=f'{OUT}/s_exam.png', full_page=True)
        # roster
        pg.click('[data-tab=roster]')
        names = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Katherine Johnson', 'Edsger Dijkstra', 'Barbara Liskov']
        roster = 'id,name,section\n' + '\n'.join(f'{1000+i*7},{n},Period {1+i%2}' for i, n in enumerate(names))
        pg.fill('#rosterPaste', roster); pg.click('#rosterImportPaste')
        pg.screenshot(path=f'{OUT}/s_roster.png', full_page=True)
        # key
        key = [random.choice('ABCDEFGH'[:NC]) for _ in range(NQ)]
        pg.click('[data-tab=key]')
        pg.fill('#keyText', '# key\n' + ''.join(key[:10]) + '\n' + '\n'.join(f'{i+11}. {k}' for i, k in enumerate(key[10:])))
        pg.screenshot(path=f'{OUT}/s_key.png', full_page=True)
        # sheets
        pg.click('[data-tab=sheets]')
        pg.check('input[name=sheetMode][value=roster]')
        pg.click('#sheetGenerate')
        pg.wait_for_selector('#sheetDownload:not([hidden])')
        b64 = pg.evaluate("""async () => { const r = await fetch(document.querySelector('#sheetDownload').href); const buf = new Uint8Array(await r.arrayBuffer()); let s=''; for (const x of buf) s += String.fromCharCode(x); return btoa(s); }""")
        open(f'{OUT}/sheets.pdf', 'wb').write(base64.b64decode(b64))
        time.sleep(1)
        pg.screenshot(path=f'{OUT}/s_sheets.png', full_page=True)
        # blank sheet too
        pg.check('input[name=sheetMode][value=blank]'); pg.fill('#sheetCopies', '2'); pg.click('#sheetGenerate')
        time.sleep(1)
        b64 = pg.evaluate("""async () => { const r = await fetch(document.querySelector('#sheetDownload').href); const buf = new Uint8Array(await r.arrayBuffer()); let s=''; for (const x of buf) s += String.fromCharCode(x); return btoa(s); }""")
        open(f'{OUT}/blank.pdf', 'wb').write(base64.b64decode(b64))
        layout = pg.evaluate(f"Layout.build({{numQuestions:{NQ},numChoices:{NC},idDigits:{ND}}})")

        # ---- fill sheets as students would ----
        doc = fitz.open(f'{OUT}/sheets.pdf')
        pw, ph = 215.9, 279.4
        ox, oy = (pw - 180) / 2, (ph - 250) / 2
        mm = 72 / 25.4
        expected = []
        for pi, page in enumerate(doc):
            ans = []
            for qi, q in enumerate(layout['questions']):
                r = random.random()
                if r < 0.06: a = ''
                elif r < 0.09: a = ''.join(sorted(random.sample('ABCDEFGH'[:NC], 2)))
                elif r < 0.75: a = key[qi]
                else: a = random.choice('ABCDEFGH'[:NC])
                ans.append(a)
                for l in a:
                    bb = q['bubbles']['ABCDEFGH'.index(l)]
                    cx, cy = (ox + bb['x']) * mm, (oy + bb['y']) * mm
                    # pencil-ish: imperfect dark fill
                    gray = random.uniform(0.15, 0.4)
                    rad = random.uniform(1.35, 1.75) * mm
                    page.draw_circle(fitz.Point(cx + random.uniform(-.3, .3) * mm, cy + random.uniform(-.3, .3) * mm), rad, color=None, fill=(gray, gray, gray))
            # an erasure smudge on page 2, q1 non-chosen bubble
            if pi == 1:
                q = layout['questions'][1]
                l = next(c for c in 'ABCDE'[:NC] if c not in ans[1])
                bb = q['bubbles']['ABCDEFGH'.index(l)]
                page.draw_circle(fitz.Point((ox + bb['x']) * mm, (oy + bb['y']) * mm), 1.5 * mm, color=None, fill=(0.85, 0.85, 0.85))
            expected.append(ans)
        doc.save(f'{OUT}/filled.pdf')

        # ---- simulate scanning: rasterize, rotate a bit, blur, noise; page 3 upside down ----
        imgs = []
        for pi, page in enumerate(fitz.open(f'{OUT}/filled.pdf')):
            pix = page.get_pixmap(dpi=200, colorspace=fitz.csGRAY)
            im = Image.frombytes('L', (pix.width, pix.height), pix.samples)
            ang = random.uniform(-2.5, 2.5)
            im = im.rotate(ang, resample=Image.BICUBIC, expand=False, fillcolor=235, translate=(random.randint(-25, 25), random.randint(-25, 25)))
            if pi == 2: im = im.rotate(180)
            if pi == 3: im = im.resize((int(im.width * 0.93), int(im.height * 0.93)))  # printed "fit to page"
            im = im.filter(ImageFilter.GaussianBlur(0.8))
            a = np.asarray(im).astype(np.float32)
            a = a * 0.9 + 12 + np.random.normal(0, 6, a.shape)  # dull white, noise
            # lighting gradient
            a = a - np.linspace(0, 25, a.shape[1])[None, :]
            imgs.append(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
        imgs[0].save(f'{OUT}/scan.pdf', save_all=True, append_images=imgs[1:], resolution=200)
        imgs[0].save(f'{OUT}/scan_p1.png')

        pg.click('[data-tab=scan]')
        pg.set_input_files('#scanFiles', f'{OUT}/scan.pdf')
        for _ in range(600):
            if pg.inner_text('#scanStatus').startswith('Done'): break
            time.sleep(0.25)
        pg.screenshot(path=f'{OUT}/s_scan.png', full_page=True)
        data = pg.evaluate('window.__omrApp.data')
        ex = next(e for e in data['exams'] if e['id'] == data['activeExamId'])
        print('scan status:', pg.inner_text('#scanStatus'))
        # Personalised sheets are printed sorted by section, then name.
        people = sorted(((f'Period {1+i%2}', n, str(1000 + i * 7)) for i, n in enumerate(names)))
        ids = [pid for _, _, pid in people]
        tot = wrong = 0
        for i, r in enumerate(ex['results']):
            exp = expected[i]
            bad = [(q + 1, exp[q], r['answers'][q]) for q in range(NQ) if exp[q] != r['answers'][q]]
            tot += NQ; wrong += len(bad)
            print(r['source'], 'id', r['studentId'], 'expected', ids[i], 'OK' if r['studentId'].lstrip('0') == ids[i] else 'ID MISMATCH', 'T=', r['threshold'], 'mismatches:', bad, 'flags:', r['flags'], r['warnings'])
        print(f'answer accuracy: {tot-wrong}/{tot}')
        print('fill stats', pg.evaluate('''() => { const out=[]; for (const [id,img] of window.__omrApp.session.images) { const r = window.__omrApp.data.exams[0].results.find(x=>x.id===id); const on=[], off=[]; img.read.qFills.forEach((f,q)=>f.forEach((v,i)=> (r.answers[q].includes('ABCDEFGH'[i])?on:off).push(v))); out.push([Math.max(...off).toFixed(3), Math.min(...on).toFixed(3), img.read.autoThreshold.toFixed(2)]); } return out; }'''))
        pg.click('#scanTable button[data-review]')
        time.sleep(1)
        pg.screenshot(path=f'{OUT}/s_review.png')
        # rotated sheet review
        pg.keyboard.press('Escape')
        pg.click('[data-tab=results]')
        pg.screenshot(path=f'{OUT}/s_results.png', full_page=True)
        with pg.expect_download() as dl:
            pg.click('#csvResults')
        dl.value.save_as(f'{OUT}/results.csv')
        # test reload persistence
        pg.reload()
        n = pg.evaluate('window.__omrApp.data.exams[0].results.length')
        print('results after reload:', n)
        b.close()
finally:
    srv.terminate()
print('console errors:', errors)
