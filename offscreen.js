/**
 * Offscreen document script — runs in extension origin.
 * High-Speed Multi-Orientation Detection for Indian Sensitive Documents + YOLO Face Detection:
 * 1. Aadhaar Card (12-digit UID with Verhoeff validation, VID)
 * 2. Date of Birth / DOB (e.g. "DOB : 05/07/2002", "DD/MM/YYYY")
 * 3. PAN Card (10-char PAN format [A-Z]{5}\d{4}[A-Z])
 * 4. Credit / Debit Cards (16-digit card numbers, CVV)
 * 5. Voter ID / EPIC Card ([A-Z]{3}\d{7})
 * 6. Driving Licence (DL format e.g. DL-0420110012345)
 * 7. Indian Passport (Passport format e.g. A1234567)
 * 8. Email Addresses & Indian Phone Numbers
 * 9. Face Detection via YOLOv8n-face ONNX
 */

import { loadModel as loadYoloModel, detectFaces } from "./yolo.js";

console.log("[OCR Offscreen] Document loaded and ready");

// Persistent warm Tesseract Worker singleton
let cachedWorkerPromise = null;

function getWorker() {
    if (!cachedWorkerPromise) {
        cachedWorkerPromise = (async () => {
            console.log("[OCR Offscreen] Initializing hardware-accelerated Tesseract worker...");
            const worker = await Tesseract.createWorker("eng", 1, {
                workerBlobURL: false,
                workerPath: chrome.runtime.getURL("node_modules/tesseract.js/dist/worker.min.js"),
                corePath: chrome.runtime.getURL("node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js"),
                langPath: chrome.runtime.getURL("tessdata"),
                gzip: false
            });
            console.log("[OCR Offscreen] Tesseract worker ready (offline & SIMD accelerated).");
            return worker;
        })();
    }
    return cachedWorkerPromise;
}

// Pre-warm Tesseract & YOLO models immediately upon offscreen load
getWorker().catch((err) => console.warn("[OCR Offscreen] Pre-warm OCR notice:", err));
loadYoloModel().catch((err) => console.warn("[OCR Offscreen] Pre-warm YOLO notice:", err));

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DO_OCR") {
        performScan(message.imageDataUrl, message.jobId);
    }
});

// Verhoeff checksum algorithm for Aadhaar validation
const VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
const VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

function validateAadhaar(str) {
    const clean = str.replace(/\D/g, "");
    if (clean.length !== 12 || clean.startsWith("0") || clean.startsWith("1")) return false;
    let c = 0;
    const array = clean.split("").map(Number).reverse();
    for (let i = 0; i < array.length; i++) {
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][array[i]]];
    }
    return c === 0 || /^[2-9]\d{3}[ -]\d{4}[ -]\d{4}$/.test(str.trim());
}

// Indian Sensitive Document Document & Card Rules (No generic name regexes)
const INDIAN_DOC_PATTERNS = [
    {
        type: "AADHAAR CARD",
        regex: /(?<!\d\s*)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?!\s*\d)|(?<!\d)[2-9]\d{11}(?!\d)/g,
        validate: (m) => validateAadhaar(m)
    },
    {
        type: "DOB",
        regex: /\b(?:(?:DOB|D\.O\.B|Birth|Date of Birth|जन्म तिथि)[:\s\/]*)?((?:0?[1-9]|[12]\d|3[01])[\/\-\.](?:0?[1-9]|1[012])[\/\-\.](?:19|20)\d{2})\b/gi,
        extractGroup: 1
    },
    {
        type: "PAN CARD",
        regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g
    },
    {
        type: "CREDIT/DEBIT CARD",
        regex: /\b(?:\d{4}[ -]){3}\d{4}\b|\b(?:\d{4}[ -]\d{6}[ -]\d{5})\b|\b(?:4\d{15}|5[1-5]\d{14}|6011\d{12}|3[47]\d{13})\b/g,
        validate: (m) => {
            const digits = m.replace(/\D/g, "");
            return digits.length >= 13 && digits.length <= 19;
        }
    },
    {
        type: "VOTER ID",
        regex: /\b[A-Z]{3}\d{7}\b/g
    },
    {
        type: "DRIVING LICENCE",
        regex: /\b[A-Z]{2}[ -]?[0-9]{2}[ -]?(?:19|20)\d{2}\d{7}\b|\b[A-Z]{2}\d{13,15}\b/g
    },
    {
        type: "PASSPORT",
        regex: /\b[A-PR-WYa-pr-wy][1-9]\d{6}\b/g
    },
    {
        type: "EMAIL",
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
    },
    {
        type: "PHONE",
        regex: /(?:\+91[\-\s]?)?[6-9]\d{9}\b/g
    }
];

function extractAllLines(data) {
    const lines = [];
    if (data.blocks) {
        data.blocks.forEach((block) => {
            if (block.paragraphs) {
                block.paragraphs.forEach((p) => {
                    if (p.lines) lines.push(...p.lines);
                });
            } else if (block.lines) {
                lines.push(...block.lines);
            }
        });
    }
    return lines;
}

function getMatchBBox(line, matchStr, matchIndex) {
    if (!line.words || line.words.length === 0) {
        return line.bbox;
    }

    let currentPos = 0;
    const matchingWords = [];

    for (const word of line.words) {
        const wordStart = line.text.indexOf(word.text, currentPos);
        const wordEnd = wordStart !== -1 ? wordStart + word.text.length : currentPos + word.text.length;
        currentPos = wordEnd;

        const matchStart = matchIndex;
        const matchEnd = matchIndex + matchStr.length;

        if (wordStart < matchEnd && wordEnd > matchStart) {
            matchingWords.push(word);
        }
    }

    if (matchingWords.length === 0) {
        return line.bbox;
    }

    return {
        x0: Math.min(...matchingWords.map((w) => w.bbox.x0)),
        y0: Math.min(...matchingWords.map((w) => w.bbox.y0)),
        x1: Math.max(...matchingWords.map((w) => w.bbox.x1)),
        y1: Math.max(...matchingWords.map((w) => w.bbox.y1))
    };
}

function mapRotatedBBoxToOriginal(bbox, degrees, canvasWidth, canvasHeight) {
    const { x0, y0, x1, y1 } = bbox;

    if (degrees === 90) {
        return {
            x0: Math.round(canvasWidth - y1),
            y0: Math.round(x0),
            x1: Math.round(canvasWidth - y0),
            y1: Math.round(x1)
        };
    } else if (degrees === 270) {
        return {
            x0: Math.round(y0),
            y0: Math.round(canvasHeight - x1),
            x1: Math.round(y1),
            y1: Math.round(canvasHeight - x0)
        };
    }

    return { x0, y0, x1, y1 };
}

function detectIndianSensitiveDocuments(data, scaleFactor = 1, rotationDegrees = 0, scaledWidth = 0, scaledHeight = 0) {
    const detected = [];
    const lines = extractAllLines(data);

    lines.forEach((line) => {
        const lineText = (line.text || "").trim();
        if (!lineText) return;

        // High-Confidence Regex Documents (Aadhaar, PAN, CC, DL, Voter ID, Passport, DOB, Email, Phone)
        INDIAN_DOC_PATTERNS.forEach((pattern) => {
            pattern.regex.lastIndex = 0;
            let match;
            while ((match = pattern.regex.exec(lineText)) !== null) {
                const matchedText = pattern.extractGroup ? match[pattern.extractGroup] : match[0];
                if (!matchedText) continue;

                if (pattern.validate && !pattern.validate(matchedText)) {
                    continue;
                }

                const offset = pattern.extractGroup
                    ? match.index + match[0].indexOf(matchedText)
                    : match.index;

                let bbox = getMatchBBox(line, matchedText, offset);

                if (rotationDegrees !== 0) {
                    bbox = mapRotatedBBoxToOriginal(bbox, rotationDegrees, scaledWidth, scaledHeight);
                }

                addPaddedEntity(detected, pattern.type, matchedText.trim(), bbox, scaleFactor);
            }
        });
    });

    return detected;
}

function addPaddedEntity(list, type, text, bbox, scaleFactor = 1) {
    if (!bbox) return;

    const pad = 4;
    const x0 = Math.max(0, (bbox.x0 ?? 0) * scaleFactor - pad);
    const y0 = Math.max(0, (bbox.y0 ?? 0) * scaleFactor - pad);
    const x1 = ((bbox.x1 ?? (bbox.x0 + bbox.width)) * scaleFactor) + pad;
    const y1 = ((bbox.y1 ?? (bbox.y0 + bbox.height)) * scaleFactor) + pad;

    const isDuplicate = list.some(
        (e) =>
            e.type === type &&
            Math.abs(e.bbox.x0 - x0) < 25 &&
            Math.abs(e.bbox.y0 - y0) < 25
    );

    if (!isDuplicate) {
        list.push({
            type,
            text,
            bbox: { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 }
        });
    }
}

function createRotatedCanvas(sourceCanvas, degrees) {
    const is90or270 = degrees === 90 || degrees === 270;
    const w = is90or270 ? sourceCanvas.height : sourceCanvas.width;
    const h = is90or270 ? sourceCanvas.width : sourceCanvas.height;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.translate(w / 2, h / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
    return canvas;
}

function prepareImageForFastOCR(imageDataUrl, maxDimension = 1280) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            let scaleFactor = 1;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    scaleFactor = width / maxDimension;
                    height = Math.round(height / scaleFactor);
                    width = maxDimension;
                } else {
                    scaleFactor = height / maxDimension;
                    width = Math.round(width / scaleFactor);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            resolve({
                canvas: canvas,
                ocrImage0: canvas.toDataURL("image/jpeg", 0.85),
                scaleFactor: scaleFactor,
                scaledWidth: width,
                scaledHeight: height
            });
        };
        img.src = imageDataUrl;
    });
}

async function performScan(imageDataUrl, jobId) {
    try {
        const t0 = performance.now();

        // 1. Prepare base image
        const { canvas, ocrImage0, scaleFactor, scaledWidth, scaledHeight } = await prepareImageForFastOCR(imageDataUrl, 1280);

        const worker = await getWorker();

        // 2. Pass 1: Standard 0 deg Orientation OCR
        const res0 = await worker.recognize(ocrImage0, {}, { blocks: true });
        let allEntities = detectIndianSensitiveDocuments(res0.data, scaleFactor, 0, scaledWidth, scaledHeight);

        // 3. Pass 2: Rotated 270 deg (vertical cards)
        if (allEntities.length === 0) {
            const rotatedCanvas270 = createRotatedCanvas(canvas, 270);
            const res270 = await worker.recognize(rotatedCanvas270.toDataURL("image/jpeg", 0.85), {}, { blocks: true });
            const entities270 = detectIndianSensitiveDocuments(res270.data, scaleFactor, 270, scaledWidth, scaledHeight);
            allEntities.push(...entities270);

            // Pass 3: Rotated 90 deg
            if (allEntities.length === 0) {
                const rotatedCanvas90 = createRotatedCanvas(canvas, 90);
                const res90 = await worker.recognize(rotatedCanvas90.toDataURL("image/jpeg", 0.85), {}, { blocks: true });
                const entities90 = detectIndianSensitiveDocuments(res90.data, scaleFactor, 90, scaledWidth, scaledHeight);
                allEntities.push(...entities90);
            }
        }

        // 4. YOLO Face Detection
        try {
            console.log("[OCR Offscreen] Running YOLOv8 Face Detection...");
            const detectedFaces = await detectFaces(canvas);
            console.log(`[OCR Offscreen] Found ${detectedFaces.length} face(s).`);

            detectedFaces.forEach((f) => {
                const [fx, fy, fw, fh] = f.bbox;
                const pad = 4;
                const x0 = Math.max(0, Math.round(fx * scaleFactor) - pad);
                const y0 = Math.max(0, Math.round(fy * scaleFactor) - pad);
                const width = Math.round(fw * scaleFactor) + pad * 2;
                const height = Math.round(fh * scaleFactor) + pad * 2;

                allEntities.push({
                    type: "FACE",
                    text: `FACE (${(f.confidence * 100).toFixed(0)}%)`,
                    bbox: {
                        x0,
                        y0,
                        x1: x0 + width,
                        y1: y0 + height,
                        width,
                        height
                    }
                });
            });
        } catch (faceErr) {
            console.warn("[OCR Offscreen] Face detection notice:", faceErr);
        }

        const duration = ((performance.now() - t0) / 1000).toFixed(2);
        console.log(`[OCR Offscreen] Scan completed in ${duration}s. Found ${allEntities.length} sensitive item(s).`);

        chrome.runtime.sendMessage({
            type: "OCR_RESULT",
            jobId,
            success: true,
            text: res0.data.text,
            confidence: res0.data.confidence,
            entities: allEntities
        });
    } catch (err) {
        console.error("[OCR Offscreen] Error:", err);
        chrome.runtime.sendMessage({
            type: "OCR_RESULT",
            jobId,
            success: false,
            error: String(err)
        });
    }
}
