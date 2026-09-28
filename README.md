# LambdaGrader λ

Disclaimer: A large portion of this project was written using AI programming tools. If you do not like that sort of thing feel free to ignore this project, it is not for you!

A free bubble-sheet (OMR) grader for multiple-choice exams. It runs **entirely in your browser**
and is hosted as a static site on GitHub Pages. Rosters, answer keys, scans and scores never leave
the computer. There is no server, no account, and no upload.

- **Prints bubble sheets.** Blank sheets, or personalised ones with each student's name and
  name.# pre-filled. Up to 400 students.
- **Name.# IDs.** Student IDs like `smith.12`. The number after the dot can repeat
  (`smith.12` and `jones.12`), so sheets also carry a last-name initial bubble. Personalised
  sheets add a hidden code that always identifies the exact student.
- **Plaintext answer key.** Type `1. B`, `2. D`… or just `BDACE…`. You can set points, accept
  either of several answers, add **select all that apply** questions (all-or-nothing or partial
  credit), and give free or dropped questions.
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
| 1 | **Exam** | Name the exam. Set the number of questions (up to 255), choices (2 to 8, A to H), how many digits the name.# numbers need, and how select-all questions are scored. |
| 2 | **Students** | Paste or load a roster CSV (`name.#,name,section`), up to 400 students. Emails like `smith.12@school.edu` are trimmed to `smith.12`. |
| 3 | **Answer key** | Type the key. The preview shows exactly what will be scored. |
| 4 | **Bubble sheets** | Generate a PDF and print it. |
| 5 | **Scan & grade** | Scan the completed sheets to PDF and drop the file in. |
| 6 | **Results** | Check anything flagged, then download the CSVs. |

You can also fill in a bubble sheet yourself as the key, scan it, and click
**Use this sheet as the answer key** in the review screen.

### Answer key format

```text
1. A            one correct answer
2) c            case and punctuation don't matter
3 B 2           worth 2 points (default 1)
4 A/C           either A or C is accepted (A,C works too)
5 ACD           select all that apply: A, C and D must all be marked
6 A+C 2 partial select all, 2 points, partial credit
7 BD exact      select all, all or nothing
8 *             free: everyone gets credit
9 -             dropped: not scored
# comments start with a hash

ABCDA DCBAB     unnumbered letters continue from the last question
[ACD] B [A/C]   [..] groups, * and - work here too
```

Enter the key before scanning. On select-all questions, the reader then keeps every mark
instead of treating extra marks as mistakes. If you add or change the key afterwards, click
**Re-read this session's sheets**.

See [`samples/answer-key.txt`](samples/answer-key.txt) and [`samples/roster.csv`](samples/roster.csv).

### Scoring rules

- A normal question scores if exactly one bubble is marked and that letter is accepted by the
  key. A blank answer, or more than one mark, scores 0. Double marks are flagged for review.
- A select-all question scores in full only if exactly the right set of bubbles is marked. With
  partial credit (set on the Exam tab, or per question with `partial` / `exact`), it earns
  (right marks − wrong marks) ÷ number of right answers of its points, never below zero. For
  example, if the key is `ACD` and the student marks `A C E`, that's (2 − 1) / 3 = ⅓.
- If one mark is much darker than another, the lighter one is treated as an erasure. The darker
  mark is used and the question is flagged.
- Changing the key re-scores every sheet instantly.

### Matching sheets to students (name.#)

Each sheet has bubbles for the **number** in the student's name.# and for the **first letter of
their last name**. A sheet is matched to a student in this order:

1. A student you picked by hand in the review screen.
2. The code strip along the bottom edge. Only personalised sheets have it, and it is unique
   per student.
3. The bubbled number, narrowed down by the last-name initial.

If the number and initial still fit more than one student (for example `smith.3` and
`sanchez.3` on a blank sheet), the sheet is flagged. The review screen lists the possible
students, and you pick the right one by reading the handwritten name on the scan. Personalised
sheets never have this problem.

Each student's code is kept permanently in the roster, so edit students rather than deleting and
re-adding them after personalised sheets are printed.

### Tips for printing and scanning

- Print single-sided. "Actual size" and "fit to page" both work.
- Don't write on or near the four black corner squares or the small squares along the top edge.
- Scan at 200–300 dpi, in grayscale or colour. Most copiers with a document feeder can scan a
  whole stack into one PDF.
- Upside-down pages are detected and handled automatically.
- Each sheet encodes its own layout (question count, choices, name.# digits) in the small squares
  at the top. Scanning a sheet printed with different settings is detected and flagged.

## Privacy and storage

- All processing uses JavaScript in your browser tab. The page's Content-Security-Policy blocks
  network requests to other sites.
- Data is saved in the browser's `localStorage` on this computer only. Clearing site data erases
  it. Use **Exam → Backup all data** to save a `.json` file you can restore elsewhere.
- Scanned images stay in memory only until the tab is closed. Answers and scores are saved.

## Hosting on GitHub Pages

1. Create a new repository on GitHub, then push this folder:
   ```bash
   git remote add origin https://github.com/<you>/lambdagrader.git
   git push -u origin main
   ```
2. In the repository, open **Settings → Pages → Build and deployment → Source** and choose
   **GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) publishes the site on
   every push to `main`.
3. The site appears at `https://<you>.github.io/lambdagrader/`.

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
