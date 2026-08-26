/**
 * Shared detection contract for all detectors (YOLO, OCR, DOM).
 *
 * @typedef {Object} Detection
 * @property {string}  type       — 'face' | 'text' | (future: 'signature', etc.)
 * @property {[number,number,number,number]} bbox — [x, y, width, height] in source pixel coords
 * @property {number}  confidence — 0..1
 * @property {string}  source     — 'yolo' | 'ocr' | 'dom'
 * @property {string}  [text]     — recognized text, optional, present for OCR detections only
 */
export const DETECTION_SCHEMA_VERSION = 1;
