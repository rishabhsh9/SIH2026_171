/**
 * Channel order verification for YOLOv8n-face ONNX model (with built-in NMS)
 * Tests both RGB and BGR preprocessing
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import ort from 'onnxruntime-node';
import { writeFileSync } from 'fs';

const MODEL_PATH = 'models/yolov8n-face.onnx';
const IMAGE_PATH = 'test/assets/im.png';
const INPUT_SIZE = 1280;
const CONF_THRESH = 0.25;

function prepareInput(canvas, channelOrder) {
  const origW = canvas.width;
  const origH = canvas.height;

  const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = (INPUT_SIZE - newW) / 2;
  const padY = (INPUT_SIZE - newH) / 2;

  const tmp = createCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = 'rgb(114, 114, 114)';
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(canvas, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imgData.data;

  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const area = INPUT_SIZE * INPUT_SIZE;

  if (channelOrder === 'RGB') {
    for (let i = 0; i < area; i++) {
      const j = i * 4;
      chw[i] = pixels[j] / 255;
      chw[i + area] = pixels[j + 1] / 255;
      chw[i + 2 * area] = pixels[j + 2] / 255;
    }
  } else {
    for (let i = 0; i < area; i++) {
      const j = i * 4;
      chw[i] = pixels[j + 2] / 255;
      chw[i + area] = pixels[j + 1] / 255;
      chw[i + 2 * area] = pixels[j] / 255;
    }
  }

  const tensor = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, origW, origH, scale, padX, padY };
}

function postprocess(rawTensor, origW, origH, scale, padX, padY) {
  // rawTensor is an ort.Tensor with shape [1, 300, 21]
  const raw = rawTensor.data; // Float32Array length 6300
  const candidates = [];

  // Shape: [1, 300, 21] -> 300 detections, each 21 values
  // Each detection: x1, y1, x2, y2, conf, class, 14 keypoints (7*2)
  for (let i = 0; i < 300; i++) {
    const base = i * 21;
    const x1_in = raw[base + 0];
    const y1_in = raw[base + 1];
    const x2_in = raw[base + 2];
    const y2_in = raw[base + 3];
    const conf = raw[base + 4];
    const cls = raw[base + 5];

    if (conf < CONF_THRESH) continue;

    // Convert from INPUT_SIZE coords to original image coords
    const x1 = (x1_in - padX) / scale;
    const y1 = (y1_in - padY) / scale;
    const x2 = (x2_in - padX) / scale;
    const y2 = (y2_in - padY) / scale;

    const bboxW = x2 - x1;
    const bboxH = y2 - y1;

    if (bboxW <= 0 || bboxH <= 0) continue;
    if (x1 > origW || y1 > origH) continue;
    if (x2 < 0 || y2 < 0) continue;

    candidates.push({
      bbox: [
        Math.max(0, Math.round(x1)),
        Math.max(0, Math.round(y1)),
        Math.min(origW, Math.round(x2)) - Math.max(0, Math.round(x1)),
        Math.min(origH, Math.round(y2)) - Math.max(0, Math.round(y1)),
      ],
      confidence: conf,
    });
  }

  return candidates;
}

async function runTest(channelOrder, imageCanvas, session) {
  console.log(`\n=== Testing ${channelOrder} channel order ===`);
  const { tensor, origW, origH, scale, padX, padY } = prepareInput(imageCanvas, channelOrder);

  const t0 = performance.now();
  const output = await session.run({ images: tensor });
  const ms = performance.now() - t0;

  // output is { output0: Tensor }
  const outputTensor = output.output0;
  const faces = postprocess(outputTensor, origW, origH, scale, padX, padY);

  console.log(`Inference time: ${ms.toFixed(1)} ms`);
  console.log(`Faces detected: ${faces.length}`);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    console.log(`  Face ${i + 1}: bbox=[${f.bbox.join(',')}] conf=${f.confidence.toFixed(4)}`);
  }

  const smallFaces = faces.filter(f => f.bbox[2] < 60 && f.bbox[3] < 60);
  if (smallFaces.length > 0) {
    console.log(`  ✓ SMALL AVATAR DETECTED: ${smallFaces.length} face(s) < 60px`);
    for (const f of smallFaces) {
      console.log(`    bbox=[${f.bbox.join(',')}] conf=${f.confidence.toFixed(4)}`);
    }
  } else {
    console.log(`  ✗ SMALL AVATAR MISSED: no faces < 60px detected`);
  }

  return { faces, ms, channelOrder };
}

async function main() {
  console.log('Loading model...');
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
  });
  console.log('Model loaded ✓');

  let imageCanvas;
  try {
    const img = await loadImage(IMAGE_PATH);
    imageCanvas = createCanvas(img.width, img.height);
    const ctx = imageCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    console.log(`Loaded test image: ${img.width}x${img.height}`);
  } catch (e) {
    console.error(`Failed to load ${IMAGE_PATH}: ${e.message}`);
    console.log('Creating synthetic test image...');
    imageCanvas = createCanvas(640, 480);
    const ctx = imageCanvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#444';
    ctx.fillRect(500, 50, 80, 80);
    ctx.fillRect(200, 150, 200, 200);
    console.log('Synthetic image created (640x480) with mock faces');
  }

  const bgrResult = await runTest('BGR', imageCanvas, session);
  const rgbResult = await runTest('RGB', imageCanvas, session);

  console.log('\n========== SUMMARY ==========');
  console.log(`BGR: ${bgrResult.faces.length} faces, ${bgrResult.ms.toFixed(1)}ms`);
  console.log(`RGB: ${rgbResult.faces.length} faces, ${rgbResult.ms.toFixed(1)}ms`);

  const bgrSmall = bgrResult.faces.filter(f => f.bbox[2] < 60 && f.bbox[3] < 60).length;
  const rgbSmall = rgbResult.faces.filter(f => f.bbox[2] < 60 && f.bbox[3] < 60).length;
  console.log(`Small avatar (<60px): BGR=${bgrSmall}, RGB=${rgbSmall}`);

  let winner;
  if (rgbResult.faces.length > bgrResult.faces.length) {
    winner = 'RGB';
  } else if (bgrResult.faces.length > rgbResult.faces.length) {
    winner = 'BGR';
  } else if (rgbSmall > bgrSmall) {
    winner = 'RGB';
  } else if (bgrSmall > rgbSmall) {
    winner = 'BGR';
  } else if (rgbResult.faces.length > 0 && bgrResult.faces.length > 0) {
    const avgBGR = bgrResult.faces.reduce((a, f) => a + f.confidence, 0) / bgrResult.faces.length;
    const avgRGB = rgbResult.faces.reduce((a, f) => a + f.confidence, 0) / rgbResult.faces.length;
    winner = avgRGB > avgBGR ? 'RGB' : 'BGR';
  } else {
    winner = 'RGB';
  }

  console.log(`\n>>> SELECTED CHANNEL ORDER: ${winner} <<<`);

  const result = {
    timestamp: new Date().toISOString(),
    model: MODEL_PATH,
    image: IMAGE_PATH,
    inputSize: INPUT_SIZE,
    confThresh: CONF_THRESH,
    bgr: { faces: bgrResult.faces.length, ms: bgrResult.ms, smallDetected: bgrSmall > 0 },
    rgb: { faces: rgbResult.faces.length, ms: rgbResult.ms, smallDetected: rgbSmall > 0 },
    selected: winner,
  };
  writeFileSync('test/channel_order_result.json', JSON.stringify(result, null, 2));
  console.log('\nResult saved to test/channel_order_result.json');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});