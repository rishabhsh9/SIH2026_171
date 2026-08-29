/**
 * yolo.js — High-Precision Face detection using YOLOv8n-face ONNX via ONNX Runtime Web.
 */

const getOrt = () => (typeof window !== "undefined" && window.ort) ? window.ort : (typeof globalThis !== "undefined" && globalThis.ort) ? globalThis.ort : null;

/* ── tunables ─────────────────────────────────────────────── */
const INPUT_SIZE = 1280;           // 640x640 is the native YOLOv8n-face trained resolution (maximizes recall for medium & large faces)
const CONF_THRESH = 0.15;         // Confidence threshold
const IOU_THRESH = 0.45;          // NMS IoU threshold

const MODEL_PATH = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
  ? chrome.runtime.getURL("models/yolov8n-face.onnx")
  : "./models/yolov8n-face.onnx";

/* ── globals ──────────────────────────────────────────────── */
let _sessionPromise = null;

/* ── public API ───────────────────────────────────────────── */

/**
 * Load (or return the cached) ONNX session.
 */
export async function loadModel(modelPath) {
  if (_sessionPromise) return _sessionPromise;
  _sessionPromise = (async () => {
    const t0 = performance.now();
    const ort = getOrt();
    if (!ort) {
      throw new Error("ONNX Runtime Web (window.ort) not found. Check offscreen.html script loading.");
    }

    // Configure WASM environment for Chrome MV3 extension
    if (ort.env && ort.env.wasm) {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        ort.env.wasm.wasmPaths = chrome.runtime.getURL("node_modules/onnxruntime-web/dist/");
      }
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
    }

    const resolvedPath = modelPath || MODEL_PATH;
    let session;

    // Fetch model binary as ArrayBuffer for reliable loading across all contexts
    if (typeof fetch !== "undefined" && (resolvedPath.startsWith("chrome-extension:") || resolvedPath.startsWith("http") || resolvedPath.startsWith("blob:"))) {
      const resp = await fetch(resolvedPath);
      if (!resp.ok) throw new Error(`Failed to fetch model binary: ${resp.statusText}`);
      const modelBuffer = await resp.arrayBuffer();
      session = await ort.InferenceSession.create(
        modelBuffer,
        { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
      );
    } else {
      session = await ort.InferenceSession.create(
        resolvedPath,
        { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
      );
    }

    console.log(`[yolo] High-recall face model loaded in ${(performance.now() - t0).toFixed(1)} ms`);
    return session;
  })().catch(err => {
    console.error("[yolo] Failed to load face model:", err);
    _sessionPromise = null;
    throw err;
  });
  return _sessionPromise;
}

/**
 * Run face detection on an image source (Canvas, Image, ImageData, or Data URL string).
 */
export async function detectFaces(source, session) {
  const sess = session || await loadModel();
  if (!sess) throw new Error("Model not loaded — call loadModel() first");

  /* ── prepare image ──────────────────────────────────────── */
  const { tensor, origW, origH, scale, padX, padY } = await prepareInput(source);

  /* ── inference ──────────────────────────────────────────── */
  const t0 = performance.now();
  const inputName = sess.inputNames[0] || "images";
  const output = await sess.run({ [inputName]: tensor });
  const ms = performance.now() - t0;
  console.log(`[yolo] Face inference (${INPUT_SIZE}x${INPUT_SIZE}) in ${ms.toFixed(1)} ms`);

  /* ── post-process & NMS ─────────────────────────────────── */
  const outputTensor = output[sess.outputNames[0]] || output.output0 || Object.values(output)[0];
  const faces = postprocess(outputTensor, origW, origH, scale, padX, padY);
  return faces;
}

/* ── helpers ──────────────────────────────────────────────── */

async function prepareInput(source) {
  let canvas, origW, origH;

  if (typeof source === "string") {
    // Data URL or image URL
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (e) => reject(new Error("Failed to load image source string for YOLO"));
      image.src = source;
    });
    origW = img.naturalWidth || img.width;
    origH = img.naturalHeight || img.height;
    canvas = document.createElement("canvas");
    canvas.width = origW;
    canvas.height = origH;
    canvas.getContext("2d").drawImage(img, 0, 0);
  } else if (source instanceof HTMLCanvasElement) {
    canvas = source;
    origW = canvas.width;
    origH = canvas.height;
  } else if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    canvas = document.createElement("canvas");
    origW = source.naturalWidth || source.width;
    origH = source.naturalHeight || source.height;
    canvas.width = origW;
    canvas.height = origH;
    canvas.getContext("2d").drawImage(source, 0, 0);
  } else if (typeof ImageData !== "undefined" && source instanceof ImageData) {
    canvas = document.createElement("canvas");
    origW = source.width;
    origH = source.height;
    canvas.width = origW;
    canvas.height = origH;
    canvas.getContext("2d").putImageData(source, 0, 0);
  } else {
    throw new TypeError("Unsupported source type — use Canvas, Image, ImageData, or Data URL");
  }

  const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = Math.floor((INPUT_SIZE - newW) / 2);
  const padY = Math.floor((INPUT_SIZE - newH) / 2);

  const tmp = document.createElement("canvas");
  tmp.width = INPUT_SIZE;
  tmp.height = INPUT_SIZE;
  const ctx = tmp.getContext("2d");
  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(canvas, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imgData.data;

  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const area = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < area; i++) {
    const j = i * 4;
    chw[i] = pixels[j] / 255;
    chw[i + area] = pixels[j + 1] / 255;
    chw[i + 2 * area] = pixels[j + 2] / 255;
  }

  const ort = getOrt();
  const tensor = new ort.Tensor("float32", chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, origW, origH, scale, padX, padY };
}

function calculateIoU(boxA, boxB) {
  const [x1A, y1A, wA, hA] = boxA;
  const [x1B, y1B, wB, hB] = boxB;

  const x2A = x1A + wA;
  const y2A = y1A + hA;
  const x2B = x1B + wB;
  const y2B = y1B + hB;

  const interX1 = Math.max(x1A, x1B);
  const interY1 = Math.max(y1A, y1B);
  const interX2 = Math.min(x2A, x2B);
  const interY2 = Math.min(y2A, y2B);

  if (interX2 <= interX1 || interY2 <= interY1) return 0;

  const interArea = (interX2 - interX1) * (interY2 - interY1);
  const areaA = wA * hA;
  const areaB = wB * hB;
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

function nms(boxes, iouThreshold = IOU_THRESH) {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const selected = [];

  for (let i = 0; i < boxes.length; i++) {
    const boxA = boxes[i];
    let keep = true;

    for (let j = 0; j < selected.length; j++) {
      const boxB = selected[j];
      const iou = calculateIoU(boxA.bbox, boxB.bbox);
      if (iou > iouThreshold) {
        keep = false;
        break;
      }
    }

    if (keep) {
      selected.push(boxA);
    }
  }
  return selected;
}

function postprocess(outputTensor, origW, origH, scale, padX, padY) {
  const raw = outputTensor.data;
  const dims = outputTensor.dims;
  const candidates = [];

  if (!raw || raw.length === 0) return candidates;

  // Format 1: [1, 5, N] (cx, cy, w, h, conf)
  if (dims && dims.length === 3 && dims[1] >= 5) {
    const numDets = dims[2];

    for (let i = 0; i < numDets; i++) {
      const conf = raw[4 * numDets + i];
      if (conf < CONF_THRESH) continue;

      const cx_in = raw[0 * numDets + i];
      const cy_in = raw[1 * numDets + i];
      const w_in = raw[2 * numDets + i];
      const h_in = raw[3 * numDets + i];

      const x1 = (cx_in - w_in / 2 - padX) / scale;
      const y1 = (cy_in - h_in / 2 - padY) / scale;
      const x2 = (cx_in + w_in / 2 - padX) / scale;
      const y2 = (cy_in + h_in / 2 - padY) / scale;

      const rx0 = Math.max(0, Math.min(origW, Math.round(x1)));
      const ry0 = Math.max(0, Math.min(origH, Math.round(y1)));
      const rx1 = Math.max(0, Math.min(origW, Math.round(x2)));
      const ry1 = Math.max(0, Math.min(origH, Math.round(y2)));

      const rw = rx1 - rx0;
      const rh = ry1 - ry0;

      if (rw <= 0 || rh <= 0) continue;

      candidates.push({
        bbox: [rx0, ry0, rw, rh],
        confidence: conf,
      });
    }

    return nms(candidates, IOU_THRESH);
  }

  // Format 2: [1, N, 21] or [1, N, 5]
  if (dims && dims.length === 3 && dims[2] >= 5) {
    const numDets = dims[1];
    const detSize = dims[2];

    for (let i = 0; i < numDets; i++) {
      const base = i * detSize;
      const x1_in = raw[base + 0];
      const y1_in = raw[base + 1];
      const x2_in = raw[base + 2];
      const y2_in = raw[base + 3];
      const conf = raw[base + 4];

      if (conf < CONF_THRESH) continue;

      const x1 = (x1_in - padX) / scale;
      const y1 = (y1_in - padY) / scale;
      const x2 = (x2_in - padX) / scale;
      const y2 = (y2_in - padY) / scale;

      const rx0 = Math.max(0, Math.min(origW, Math.round(x1)));
      const ry0 = Math.max(0, Math.min(origH, Math.round(y1)));
      const rx1 = Math.max(0, Math.min(origW, Math.round(x2)));
      const ry1 = Math.max(0, Math.min(origH, Math.round(y2)));

      const rw = rx1 - rx0;
      const rh = ry1 - ry0;

      if (rw <= 0 || rh <= 0) continue;

      candidates.push({
        bbox: [rx0, ry0, rw, rh],
        confidence: conf,
      });
    }

    return nms(candidates, IOU_THRESH);
  }

  return candidates;
}
