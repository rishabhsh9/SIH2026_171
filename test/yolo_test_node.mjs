/**
 * Quick CLI smoke-test for yolov8n-face ONNX.
 * Run:  node --experimental-vm-modules test/yolo_test_node.mjs
 *   or: npm exec -- node test/yolo_test_node.mjs
 */

import { readFileSync } from "fs";
import { createCanvas, loadImage } from "canvas";   // npm i canvas  (optional)
import ort from "onnxruntime-node";

const MODEL = "models/yolov8n-face.onnx";
const INPUT = process.argv[2] || "models/yolov8n-face.onnx"; // placeholder
const SIZE  = 1280;
const CONF  = 0.25;

async function main() {
  console.log("Loading model…");
  const sess = await ort.InferenceSession.create(MODEL, {
    executionProviders: ["cpu"],
  });
  console.log("Model loaded ✓");

  // create a tiny synthetic image (640×480 grey)
  const canvas = createCanvas(640, 480);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 640, 480);

  const { tensor, origW, origH } = prepareInput(ctx, 640, 480);
  const t0 = performance.now();
  const output = await sess.run({ images: tensor });
  const ms = performance.now() - t0;
  console.log(`Inference: ${ms.toFixed(1)} ms`);

  const raw = output.output0.data;
  const faces = postprocess(raw, origW, origH);
  console.log(`Faces detected: ${faces.length}`);
  for (const f of faces)
    console.log(`  bbox=[${f.bbox}]  conf=${f.confidence.toFixed(3)}`);
}

function prepareInput(ctx, w, h) {
  const scale = Math.min(SIZE / w, SIZE / h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);
  const px = (SIZE - nw) / 2, py = (SIZE - nh) / 2;

  const tmp = createCanvas(SIZE, SIZE);
  const tctx = tmp.getContext("2d");
  tctx.fillStyle = "114";
  tctx.fillRect(0, 0, SIZE, SIZE);
  tctx.drawImage(ctx.canvas, px, py, nw, nh);

  const img = tctx.getImageData(0, 0, SIZE, SIZE).data;
  const chw = new Float32Array(3 * SIZE * SIZE);
  const area = SIZE * SIZE;
  for (let i = 0; i < area; i++) {
    const j = i * 4;
    chw[i]            = img[j + 2] / 255;
    chw[i + area]     = img[j + 1] / 255;
    chw[i + 2 * area] = img[j]     / 255;
  }
  return {
    tensor: new ort.Tensor("float32", chw, [1, 3, SIZE, SIZE]),
    origW: w,
    origH: h,
  };
}

function postprocess(raw, origW, origH) {
  const C = 20, N = 8400;
  const scale = Math.min(SIZE / origW, SIZE / origH);
  const nw = Math.round(origW * scale), nh = Math.round(origH * scale);
  const px = (SIZE - nw) / 2, py = (SIZE - nh) / 2;
  const cands = [];
  for (let i = 0; i < N; i++) {
    const cx = raw[i*C], cy = raw[i*C+1], w = raw[i*C+2], h = raw[i*C+3];
    const conf = sigmoid(raw[i*C+4]) * sigmoid(raw[i*C+5]);
    if (conf < CONF) continue;
    const x1 = Math.max(0, (cx-w/2-px)/scale);
    const y1 = Math.max(0, (cy-h/2-py)/scale);
    const x2 = Math.min(origW, (cx+w/2-px)/scale);
    const y2 = Math.min(origH, (cy+h/2-py)/scale);
    cands.push({ bbox: [+x1.toFixed(1), +y1.toFixed(1), +(x2-x1).toFixed(1), +(y2-y1).toFixed(1)], confidence: conf });
  }
  return cands;
}
function sigmoid(v) { return 1 / (1 + Math.exp(-v)); }

main().catch(e => { console.error(e); process.exit(1); });
