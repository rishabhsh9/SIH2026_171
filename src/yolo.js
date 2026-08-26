/**
 * yolo.js — Face detection using YOLOv8n-face ONNX via ONNX Runtime Web.
 *
 * Model: yolov8n-face.onnx (exported with NMS, input 1280x1280)
 * Output: [1, 300, 21] — x1, y1, x2, y2, conf, class, 14 keypoints
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
 * @param {HTMLCanvasElement|HTMLImageElement|ImageData} source
 * @param {ort.InferenceSession} [session]  Optional pre-loaded session.
 * @returns {Promise<Array<{bbox:[number,number,number,number], confidence:number}>>}
 *          Each bbox is [x, y, width, height] in the source's pixel coordinate space.
 */
export async function detectFaces(source, session) {
  const sess = session || _session;
  if (!sess) throw new Error("Model not loaded — call loadModel() first");

  /* ── prepare image ──────────────────────────────────────── */
  const { tensor, origW, origH, scale, padX, padY } = prepareInput(source);

  /* ── inference ──────────────────────────────────────────── */
  const t0 = performance.now();
  const output = await sess.run({ images: tensor });
  const ms = performance.now() - t0;
  console.log(`[yolo] inference ${ms.toFixed(1)} ms`);

  /* ── post-process ───────────────────────────────────────── */
  // output.output0 is an ort.Tensor with shape [1, 300, 21]
  const faces = postprocess(output.output0, origW, origH, scale, padX, padY);
  return faces;
}

/* ── helpers ──────────────────────────────────────────────── */

/**
 * Resize + normalise image into a Float32 tensor [1, 3, INPUT_SIZE, INPUT_SIZE].
 * Returns tensor + metadata needed for coordinate mapping.
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
  } else {
    throw new TypeError("Unsupported source type — use Canvas, Image, or ImageData");
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
  ctx.fillStyle = "rgb(114, 114, 114)";  // YOLO training padding
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(canvas, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imgData.data;  // Uint8ClampedArray RGBA

  // HWC → CHW, normalise to [0,1], RGB order (verified on this model)
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const area = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < area; i++) {
    const j = i * 4;
    chw[i]            = pixels[j]     / 255;  // R → channel 0
    chw[i + area]     = pixels[j + 1] / 255;  // G → channel 1
    chw[i + 2 * area] = pixels[j + 2] / 255;  // B → channel 2
  }

  const tensor = new ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, origW, origH, scale, padX, padY };
}

/**
 * Parse raw model output → array of detected faces in original image coords.
 *
 * Model output: Tensor [1, 300, 21]
 *   Each detection: x1, y1, x2, y2, conf, class, 14 keypoints (7×2)
 *   Coordinates are in INPUT_SIZE space (letterboxed).
 */
function postprocess(outputTensor, origW, origH, scale, padX, padY) {
  const raw = outputTensor.data;  // Float32Array length 6300 (1*300*21)
  const faces = [];

  for (let i = 0; i < 300; i++) {
    const base = i * 21;
    const x1_in = raw[base + 0];
    const y1_in = raw[base + 1];
    const x2_in = raw[base + 2];
    const y2_in = raw[base + 3];
    const conf  = raw[base + 4];
    const cls   = raw[base + 5];

    if (conf < CONF_THRESH) continue;

    // Convert from INPUT_SIZE coords to original image coords
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

  // Model already applies NMS; no additional NMS needed
  return faces;
}