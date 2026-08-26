/**
 * Browser test entry point - imports from src/yolo.js and provides UI
 * This is bundled by esbuild into test/yolo_test.bundle.js
 */

import { loadModel, detectFaces } from '../src/yolo.js';

const MODEL_PATH = 'yolov8n-face.onnx'; // relative to test/ after bundling

const logEl = document.getElementById('log');
function log(msg) { logEl.textContent += msg + '\n'; }

async function runTest() {
  const file = document.getElementById('file').files[0];
  if (!file) { alert('Pick an image first'); return; }

  logEl.textContent = '';
  const img = document.getElementById('preview');
  img.src = URL.createObjectURL(file);
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);

  try {
    await loadModel(MODEL_PATH);
    const faces = await detectFaces(canvas);

    log(`\nDetected ${faces.length} face(s):`);
    for (const f of faces) {
      log(`  bbox=[${f.bbox.join(',')}]  conf=${f.confidence.toFixed(3)}`);
    }

    // draw boxes on canvas for visual verification
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 3;
    ctx.font = '14px monospace';
    for (const f of faces) {
      ctx.strokeRect(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]);
      ctx.fillStyle = '#0f0';
      ctx.fillText(f.confidence.toFixed(3), f.bbox[0], f.bbox[1] - 4);
    }
    img.src = canvas.toDataURL();
  } catch (e) {
    log(`ERROR: ${e.message}`);
    console.error(e);
  }
}

document.getElementById('run').addEventListener('click', runTest);

// Auto-run on load if test asset exists
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('assets/im.png');
    if (res.ok) {
      const blob = await res.blob();
      const file = new File([blob], 'im.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.getElementById('file').files = dt.files;
      log('Auto-loaded test/assets/im.png');
      await runTest();
    }
  } catch (e) {
    // ignore - manual selection will work
  }
});