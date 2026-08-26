/**
 * yolo.js — Face detection using YOLOv8n-face ONNX via ONNX Runtime Web.
 *
 * Usage:
 *   const session = await loadModel();            // call once, cache the promise
 *   const faces  = await detectFaces(canvas, session);
 *   // → [{ bbox: [x, y, w, h], confidence: number }, …]
 */

import * as ort from "onnxruntime-web";

/* ── tunables ─────────────────────────────────────────────── */
const INPUT_SIZE = 1280;          // higher than 640 default → better small-face recall
const CONF_THRESH = 0.25;         // lower than 0.5 default → catch borderline faces
const IOU_THRESH = 0.45;          // NMS IoU threshold
const MODEL_PATH =
  typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL("models/yolov8n-face.onnx")
    : "models/yolov8n-face.onnx";

/* ── globals ──────────────────────────────────────────────── */
let _session = null;

/* ── public API ───────────────────────────────────────────── */

/**
 * Load (or return the cached) ONNX session.
 * Safe to call many times — the model loads exactly once.
 */
export async function loadModel(modelPath) {
  if (_session) return _session;
  const t0 = performance.now();
  _session = await ort.InferenceSession.create(
    modelPath || MODEL_PATH,
    { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
  );
  console.log(`[yolo] model loaded in ${(performance.now() - t0).toFixed(1)} ms`);
  return _session;
}

/**
 * Run face detection on an image-like source.
 *
 * @param {HTMLCanvasElement|HTMLImageElement|ImageData|ArrayBuffer} source
 *        If an ImageData is passed it is wrapped onto a temporary canvas first.
 * @param {ort.InferenceSession} [session]  Optional pre-loaded session (saves a lookup).
 * @returns {Promise<Array<{bbox:[number,number,number,number], confidence:number}>>}
 *          Each bbox is [x, y, width, height] in the source's pixel coordinate space.
 */
export async function detectFaces(source, session) {
  const sess = session || _session;
  if (!sess) throw new Error("Model not loaded — call loadModel() first");

  /* ── prepare image ──────────────────────────────────────── */
  const { tensor, origW, origH } = prepareInput(source);

  /* ── inference ──────────────────────────────────────────── */
  const t0 = performance.now();
  const output = await sess.run({ images: tensor });
  const ms = performance.now() - t0;
  console.log(`[yolo] inference ${ms.toFixed(1)} ms`);

  /* ── post-process ───────────────────────────────────────── */
  const raw = output.output0.data;           // Float32Array  (1, 20, 8400)
  return postprocess(raw, origW, origH);
}

/* ── helpers ──────────────────────────────────────────────── */

/**
 * Resize + normalise image into a Float32 tensor [1, 3, INPUT_SIZE, INPUT_SIZE].
 */
function prepareInput(source) {
  let canvas, origW, origH;

  if (source instanceof HTMLCanvasElement) {
    canvas = source;
    origW = canvas.width;
    origH = canvas.height;
  } else if (source instanceof HTMLImageElement) {
    canvas = document.createElement("canvas");
    origW = source.naturalWidth || source.width;
    origH = source.naturalHeight || source.height;
    canvas.width = origW;
    canvas.height = origH;
    canvas.getContext("2d").drawImage(source, 0, 0);
  } else if (source instanceof ImageData) {
    canvas = document.createElement("canvas");
    origW = source.width;
    origH = source.height;
    canvas.width = origW;
    canvas.height = origH;
    canvas.getContext("2d").putImageData(source, 0, 0);
  } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    // raw pixels already — caller is expected to provide dimensions externally;
    // fall back to treating as RGBA ImageData inside a 1×1 canvas placeholder
    throw new Error(
      "Raw ArrayBuffer not supported directly — wrap in ImageData first"
    );
  } else {
    throw new TypeError("Unsupported source type");
  }

  // letterbox resize: preserve aspect ratio, pad with grey
  const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = (INPUT_SIZE - newW) / 2;
  const padY = (INPUT_SIZE - newH) / 2;

  const tmp = document.createElement("canvas");
  tmp.width = INPUT_SIZE;
  tmp.height = INPUT_SIZE;
  const ctx = tmp.getContext("2d");
  ctx.fillStyle = "114";                          // grey padding (same as YOLO default)
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(canvas, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imgData.data;                    // Uint8ClampedArray RGBA

  // HWC → CHW, normalise to [0,1], BGR order (YOLO convention)
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const area = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < area; i++) {
    const j = i * 4;
    chw[i]                = pixels[j + 2] / 255;  // R → channel 0 (B in RGB)
    chw[i + area]         = pixels[j + 1] / 255;  // G → channel 1
    chw[i + 2 * area]     = pixels[j]     / 255;  // B → channel 2 (R in RGB)
  }

  const tensor = new ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, origW, origH };
}

/**
 * Parse raw model output → array of detected faces in original image coords.
 *
 * Model output layout  (1, 20, 8400):
 *   rows 0-3  : cx, cy, w, h  (normalised to INPUT_SIZE)
 *   row 4     : objectness logit
 *   row 5     : class conf logit (single class "face")
 *   rows 6-19 : 14 keypoint values (ignored here)
 */
function postprocess(raw, origW, origH) {
  const C = 20;           // channels per detection
  const N = 8400;         // candidate count

  // letterbox scale + padding (must mirror prepareInput)
  const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW  = Math.round(origW * scale);
  const newH  = Math.round(origH * scale);
  const padX  = (INPUT_SIZE - newW) / 2;
  const padY  = (INPUT_SIZE - newH) / 2;

  const candidates = [];

  for (let i = 0; i < N; i++) {
    const cx = raw[i * C + 0];
    const cy = raw[i * C + 1];
    const w  = raw[i * C + 2];
    const h  = raw[i * C + 3];
    const objLogit = raw[i * C + 4];
    const clsLogit = raw[i * C + 5];

    const objConf = sigmoid(objLogit);
    const clsConf = sigmoid(clsLogit);
    const conf    = objConf * clsConf;

    if (conf < CONF_THRESH) continue;

    // centre → corners, remove letterbox padding
    const x1 = (cx - w / 2 - padX) / scale;
    const y1 = (cy - h / 2 - padY) / scale;
    const x2 = (cx + w / 2 - padX) / scale;
    const y2 = (cy + h / 2 - padY) / scale;

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

  // NMS (class-agnostic, single class)
  return nms(candidates, IOU_THRESH);
}

function sigmoid(v) {
  return 1 / (1 + Math.exp(-v));
}

/**
 * Simple greedy NMS.
 */
function nms(boxes, iouThresh) {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const keep = [];
  const alive = new Set(boxes.map((_, i) => i));

  for (const box of boxes) {
    const idx = boxes.indexOf(box);
    if (!alive.has(idx)) continue;
    keep.push(box);
    alive.delete(idx);
    for (const j of alive) {
      if (iou(box.bbox, boxes[j].bbox) > iouThresh) alive.delete(j);
    }
  }
  return keep;
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-6);
}
