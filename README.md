# OMRChecker Web

A free bubble-sheet (OMR) grader for multiple-choice exams. It runs **entirely in your browser**
and is hosted as a static site on GitHub Pages. Rosters, answer keys, scans and scores never leave
the computer. There is no server, no account, and no upload.

- **Prints bubble sheets.** Blank sheets, or personalised ones with each student's name printed
  and ID pre-filled. Up to 400 students.
- **Plaintext answer key.** Type `1. B`, `2. D`… or just `BDACE…`. You can set points, accept
  more than one answer, and give free or dropped questions.
- **Grades scanned PDFs.** Drop in a multi-page scan (or phone photos). Every page is read,
  matched to a student, and scored.
- **Review screen.** Flagged sheets (double marks, faint marks, unreadable IDs) show an overlay.
  Click a bubble to fix a misread.
- **CSV export.** You get a results CSV (score plus every answer), a gradebook CSV for the full
  roster (including missing students), and an item analysis.
- **Works offline.** All libraries are vendored. You can also open `index.html` straight from
  disk.

## Using it

| Step | Tab | What you do |
|---|---|---|
| 1 | **Exam** | Name the exam. Set the number of questions (up to 255), choices (2–8, A–H) and student-ID digits. |
| 2 | **Students** | Paste or load a roster CSV (`id,name,section`), up to 400 students. "Number students without an ID" gives IDs to anyone missing one. |
| 3 | **Answer key** | Type the key. The preview shows exactly what will be scored. |
| 4 | **Bubble sheets** | Generate a PDF and print it. |
| 5 | **Scan & grade** | Scan the completed sheets to PDF and drop the file in. |
| 6 | **Results** | Check anything flagged, then download the CSVs. |

You can also fill in a bubble sheet yourself as the key, scan it, and click
**Use this sheet as the answer key** in the review screen.

### Answer key format

```text
1. A          one correct answer
2) c          case and punctuation don't matter
3 B 2         worth 2 points (default 1)
4 A,C         either A or C is accepted
5 *           free: everyone gets credit
6 -           dropped: not scored
# comments start with a hash

ABCDA DCBAB   unnumbered letters continue from the last question
[AC] B *      [..] groups, * and - work here too
```

See [`samples/answer-key.txt`](samples/answer-key.txt) and [`samples/roster.csv`](samples/roster.csv).

### Scoring rules

- A question scores if exactly one bubble is marked and that letter is accepted by the key.
- A blank answer, or more than one mark, scores 0. Double marks are flagged for review.
- If one mark is much darker than another, the lighter one is treated as an erasure. The darker
  mark is used and the question is flagged.
- Changing the key re-scores every sheet instantly.

### Tips for printing and scanning

- Print single-sided. "Actual size" and "fit to page" both work.
- Don't write on or near the four black corner squares or the small squares along the top edge.
- Scan at 200–300 dpi, in grayscale or colour. Most copiers with a document feeder can scan a
  whole stack into one PDF.
- Upside-down pages are detected and handled automatically.
- Each sheet encodes its own layout (question count, choices, ID digits) in the small squares at
  the top. Scanning a sheet printed with different settings is detected and flagged.

## Privacy and storage

- All processing uses JavaScript in your browser tab. The page's Content-Security-Policy blocks
  network requests to other sites.
- Data is saved in the browser's `localStorage` on this computer only. Clearing site data erases
  it. Use **Exam → Backup all data** to save a `.json` file you can restore elsewhere.
- Scanned images stay in memory only until the tab is closed. Answers and scores are saved.

## Hosting on GitHub Pages

1. Create a new repository on GitHub, then push this folder:
   ```bash
   git remote add origin https://github.com/<you>/omrchecker-web.git
   git push -u origin main
   ```
2. In the repository, open **Settings → Pages → Build and deployment → Source** and choose
   **GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) publishes the site on
   every push to `main`.
3. The site appears at `https://<you>.github.io/omrchecker-web/`.

To run it locally, open `index.html`, or serve the folder with `python3 -m http.server`.

## How the reader works

`js/omr.js` does the following for each page:

1. Renders the page with pdf.js at about 200 dpi and converts it to grayscale.
2. Applies an adaptive threshold, then finds the four solid corner squares with connected-component
   analysis. The squares are filtered by size, squareness and fill.
3. Fits a perspective transform from sheet coordinates (mm) to image pixels. This corrects for
   skew, scaling and rotation.
4. Reads the 16-bit layout code along the top edge (with a parity check). If it fails, the reader
   tries the page rotated 180°.
5. Measures how dark the inside of each bubble is, normalised between the paper white and the
   corner-square black.
6. Picks a per-page threshold (Otsu, clamped to 0.30–0.60) and applies the marking rules. The
   **Mark sensitivity** setting can override the threshold.

The sheet geometry lives in `js/layout.js`, which is shared by the PDF generator (`js/sheet.js`)
and the reader, so the two always agree.

```
index.html          app shell (6 tabs + review dialog)
css/style.css
js/layout.js        sheet geometry + layout code
js/sheet.js         bubble sheet PDF generator (jsPDF)
js/omr.js           image processing / mark reading
js/grading.js       answer-key parser, scoring, CSV
js/store.js         localStorage persistence
js/app.js           UI
vendor/             pdf.js 3.11.174, jsPDF 2.5.1 (unmodified)
tests/e2e.py        end-to-end test (generate → fill → simulate scan → grade)
```

### Running the test

```bash
pip install playwright pymupdf pillow numpy && playwright install chromium
python tests/e2e.py          # 40 questions
NQ=120 python tests/e2e.py   # full 120-question sheet
```

The test creates personalised sheets and fills them like students would (including blanks,
double marks and an erasure). It then simulates a poor scan (skew, blur, noise, uneven lighting,
one page upside down, one printed at 93%), grades it in headless Chromium, and compares every
answer and ID.

## License

MIT. Bundled libraries: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) and
[jsPDF](https://github.com/parallax/jsPDF) (MIT).
