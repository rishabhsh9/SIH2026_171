/**
 * OCR benchmark test using Tesseract.js.
 * Loads images from data/raw/ocr_samples/, runs word-level OCR,
 * saves annotated output images with bounding boxes, prints a summary table.
 *
 * Usage: node scripts/test_ocr.js
 */

import { createWorker } from 'tesseract.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readdir, mkdir, writeFile, unlink } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, basename, extname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const SAMPLES_DIR = join(PROJECT_ROOT, 'data', 'raw', 'ocr_samples');
const RESULTS_DIR = join(PROJECT_ROOT, 'data', 'results', 'ocr');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg']);

/**
 * Load the Tesseract.js worker and return a recognize() closure.
 */
async function loadEngine() {
  const worker = await createWorker('eng', 1, {
    logger: m =>
      console.log(
        `  [tesseract] ${m.status}${m.progress != null ? ' ' + (m.progress * 100).toFixed(0) + '%' : ''}`,
      ),
  });

  /**
   * Run word-level OCR on an image.
   *
   * @param {string} imagePath - Absolute path to the image file.
   * @param {Array<[number,number,number,number]>} [excludeRegions=[]] -
   *   Array of [x,y,w,h] boxes to mask with black before OCR (DOM-covered areas).
   * @returns {Promise<Array<import('../src/detection-schema.js').Detection>>}
   */
  async function recognize(imagePath, excludeRegions = []) {
    let processPath = imagePath;
    let tmpCreated = false;

    // Mask excluded regions by drawing black rectangles over them on a temp copy.
    // NOTE: Can be replaced with per-region cropping if profiling shows the extra I/O
    // is a bottleneck.
    if (excludeRegions.length > 0) {
      const img = await loadImage(imagePath);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = 'black';
      for (const [x, y, w, h] of excludeRegions) {
        ctx.fillRect(x, y, w, h);
      }
      processPath = imagePath + '.tmp_ocr.png';
      await writeFile(processPath, canvas.toBuffer('image/png'));
      tmpCreated = true;
    }

    const { data: { tsv } } = await worker.recognize(processPath, {}, { tsv: true });

    // Clean up temp file
    if (tmpCreated) {
      try { await unlink(processPath); } catch {}
    }

    // TSV columns (0-indexed):
    // level=0  page=1  block=2  par=3  line=4  word=5  left=6  top=7  width=8  height=9  conf=10  text=11
    const lines = tsv.split('\n').filter(Boolean);
    const results = [];
    for (const line of lines) {
      const cols = line.split('\t');
      const level = parseInt(cols[0], 10);
      if (level !== 5) continue;

      const conf = parseFloat(cols[10]);
      const text = (cols[11] || '').trim();

      if (conf < 0 || text === '') continue;

      const confidence = conf / 100;
      if (confidence < 0.3) {
        console.warn(`  ⚠ low confidence (${confidence.toFixed(3)}): "${text}"`);
      }

      results.push({
        type:       'text',
        bbox:       [parseInt(cols[6], 10), parseInt(cols[7], 10), parseInt(cols[8], 10), parseInt(cols[9], 10)],
        confidence,
        source:     'ocr',
        text,
      });
    }

    return results;
  }

  async function terminate() {
    await worker.terminate();
  }

  return { recognize, terminate };
}

/**
 * Draw red bounding boxes with text labels over the image.
 */
async function drawBoxes(imagePath, results) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  for (const r of results) {
    const [x, y, w, h] = r.bbox;
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'red';
    ctx.font = '14px sans-serif';
    ctx.fillText(r.text, x, y - 4);
  }

  return canvas;
}

async function main() {
  console.log('Loading Tesseract.js engine...');
  const { recognize, terminate } = await loadEngine();

  await mkdir(RESULTS_DIR, { recursive: true });

  const files = (await readdir(SAMPLES_DIR)).filter(f =>
    IMAGE_EXTS.has(extname(f).toLowerCase()),
  );

  if (files.length === 0) {
    console.log('No images found in', SAMPLES_DIR);
    await terminate();
    return;
  }

  console.log(`Found ${files.length} image(s) to process\n`);
  const summary = [];

  for (const file of files) {
    const imagePath = join(SAMPLES_DIR, file);
    console.log(`--- Processing: ${file} ---`);

    try {
      const t0 = performance.now();
      const results = await recognize(imagePath);
      const ms = performance.now() - t0;

      console.log(`  Words detected: ${results.length}`);
      for (const r of results) {
        console.log(`    text="${r.text}"  bbox=[${r.bbox}]  conf=${r.confidence.toFixed(3)}`);
      }

      const outCanvas = await drawBoxes(imagePath, results);
      const outPath = join(RESULTS_DIR, basename(file));
      await writeFile(outPath, outCanvas.toBuffer('image/png'));
      console.log(`  Saved: ${outPath}`);

      console.log(`  OCR time: ${ms.toFixed(1)} ms`);

      const avgConf = results.length > 0
        ? results.reduce((s, r) => s + r.confidence, 0) / results.length
        : 0;

      summary.push({
        Image: file,
        Regions: results.length,
        'Avg Conf': avgConf.toFixed(3),
        'Time (ms)': Math.round(ms),
      });
    } catch (err) {
      console.error(`  ERROR on ${file}: ${err.message}`);
      summary.push({
        Image: file,
        Regions: 'ERROR',
        'Avg Conf': '-',
        'Time (ms)': '-',
      });
    }

    console.log('');
  }

  console.log('=== Summary ===');
  console.table(summary);

  await writeFile(join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Summary saved to ${join(RESULTS_DIR, 'summary.json')}`);

  await terminate();
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
