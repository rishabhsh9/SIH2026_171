/**
 * Quick CLI smoke-test for yolov8n-face ONNX (with built-in NMS).
 * Usage: node test/yolo_test_node.mjs [image-path]
 * Default image: test/assets/im.png
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import ort from 'onnxruntime-node';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const MODEL_PATH = join(PROJECT_ROOT, 'models', 'yolov8n-face.onnx');
const DEFAULT_IMAGE = join(PROJECT_ROOT, 'test', 'assets', 'im.png');
const IMAGE_PATH = process.argv[2] || DEFAULT_IMAGE;
const INPUT_SIZE = 1280;
const CONF_THRESH = 0.25;

async function main() {
  console.log(`Loading model: ${MODEL_PATH}`);
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
  });
  console.log('Model loaded ✓');

  console.log(`Loading image: ${IMAGE_PATH}`);
  const img = await loadImage(IMAGE_PATH);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  console.log(`Image size: ${img.width}x${img.height}`);

  const { tensor, origW, origH, scale, padX, padY } = prepareInput(canvas);

  const t0 = performance.now();
  const output = await session.run({ images: tensor });
  const ms = performance.now() - t0;
  console.log(`Inference: ${ms.toFixed(1)} ms`);

  const faces = postprocess(output.output0, origW, origH, scale, padX, padY);
  console.log(`Faces detected: ${faces.length}`);
  for (const f of faces) {
    console.log(`  bbox=[${f.bbox.join(',')}]  conf=${f.confidence.toFixed(4)}`);
  }

  const smallFaces = faces.filter(f => f.bbox[2] < 60 && f.bbox[3] < 60);
  if (smallFaces.length > 0) {
    console.log(`✓ Small avatar detected: ${smallFaces.length} face(s) < 60px`);
  } else {
    console.log(`✗ Small avatar MISSED`);
  }
}

function prepareInput(canvas) {
  const origW = canvas.width;
  const origH = canvas.height;

  const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = (INPUT_SIZE - newW) / 2;
  const padY = (INPUT_SIZE - newH) / 2;

  const tmp = createCanvas(INPUT_SIZE, INPUT_SIZE);
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = 'rgb(114, 114, 114)';
  tctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  tctx.drawImage(canvas, padX, padY, newW, newH);

  const imgData = tctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imgData.data;
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const area = INPUT_SIZE * INPUT_SIZE;

  // RGB order (verified)
  for (let i = 0; i < area; i++) {
    const j = i * 4;
    chw[i] = pixels[j] / 255;
    chw[i + area] = pixels[j + 1] / 255;
    chw[i + 2 * area] = pixels[j + 2] / 255;
  }

  return {
    tensor: new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    origW, origH, scale, padX, padY
  };
}

function postprocess(outputTensor, origW, origH, scale, padX, padY) {
  const raw = outputTensor.data;  // Float32Array [1, 300, 21] -> 6300 elements
  const faces = [];

  for (let i = 0; i < 300; i++) {
    const base = i * 21;
    const x1_in = raw[base + 0];
    const y1_in = raw[base + 1];
    const x2_in = raw[base + 2];
    const y2_in = raw[base + 3];
    const conf = raw[base + 4];
    const cls = raw[base + 5];

    if (conf < CONF_THRESH) continue;

    const x1 = (x1_in - padX) / scale;
    const y1 = (y1_in - padY) / scale;
    const x2 = (x2_in - padX) / scale;
    const y2 = (y2_in - padY) / scale;

    const w = x2 - x1;
    const h = y2 - y1;

    if (w <= 0 || h <= 0) continue;
    if (x1 > origW || y1 > origH) continue;
    if (x2 < 0 || y2 < 0) continue;

    faces.push({
      bbox: [
        Math.max(0, Math.round(x1)),
        Math.max(0, Math.round(y1)),
        Math.min(origW, Math.round(x2)) - Math.max(0, Math.round(x1)),
        Math.min(origH, Math.round(y2)) - Math.max(0, Math.round(y1)),
      ],
      confidence: conf,
    });
  }
  return faces;
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});