// Pending OCR callbacks: jobId -> { resolve, reject }
const pendingOCR = {};

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
        if (message.type === "CAPTURE_SCREENSHOT") {
            chrome.tabs.captureVisibleTab(
                null,
                { format: "png" },
                (dataUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error("captureVisibleTab error:", chrome.runtime.lastError);
                        sendResponse({
                            success: false,
                            error: chrome.runtime.lastError.message
                        });
                        return;
                    }
                    sendResponse({ success: true, image: dataUrl });
                }
            );
            return true;
        }

        // Content script requests OCR
        if (message.type === "RUN_OCR") {
            handleOCR(message.imageDataUrl)
                .then((result) => {
                    sendResponse({
                        success: true,
                        text: result.text,
                        confidence: result.confidence,
                        entities: result.entities || []
                    });
                })
                .catch((err) => {
                    console.error("[BG] OCR error:", err);
                    sendResponse({ success: false, error: String(err) });
                });
            return true;
        }

        // Offscreen document sends back OCR result
        if (message.type === "OCR_RESULT") {
            const pending = pendingOCR[message.jobId];
            if (pending) {
                delete pendingOCR[message.jobId];
                if (message.success) {
                    pending.resolve({
                        text: message.text,
                        confidence: message.confidence,
                        entities: message.entities || []
                    });
                } else {
                    pending.reject(new Error(message.error || "Offscreen OCR failed"));
                }
            }
        }
    }
);

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"]
    });

    if (existingContexts.length > 0) return;

    if (creatingOffscreen) {
        await creatingOffscreen;
        return;
    }

    creatingOffscreen = chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification: "Run Tesseract.js OCR web worker"
    });

    try {
        await creatingOffscreen;
    } finally {
        creatingOffscreen = null;
    }
}

async function handleOCR(imageDataUrl) {
    await ensureOffscreenDocument();

    const jobId = "ocr_" + Date.now();

    return new Promise((resolve, reject) => {
        pendingOCR[jobId] = { resolve, reject };

        setTimeout(() => {
            if (pendingOCR[jobId]) {
                delete pendingOCR[jobId];
                reject(new Error("OCR timed out after 60s"));
            }
        }, 60000);

        chrome.runtime.sendMessage({
            type: "DO_OCR",
            jobId,
            imageDataUrl
        }).catch(err => {
            console.error("[BG] Failed to send DO_OCR:", err);
            if (pendingOCR[jobId]) {
                delete pendingOCR[jobId];
                reject(new Error("Failed to reach offscreen: " + err.message));
            }
        });
    });
}

console.log("Privacy Agent background ready");