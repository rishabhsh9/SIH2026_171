// Pending OCR callbacks: jobId -> { resolve, reject }
const pendingOCR = {};

// Handle LLM analysis request from content script or popup
async function handleAnalyze(image, dom) {
    try {
        console.log("[BG] Forwarding image + DOM to server http://localhost:3000/api/analyze");
        const response = await fetch("https://agastya-gules.vercel.app/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image, dom })
        });

        const data = await response.json();
        console.log("[BG] Server response:", data);

        if (data.success && data.action) {
            await chrome.storage.local.set({
                lastAction: data.action,
                lastActionTime: Date.now(),
                scanStatus: "ready",
                sanitizedImage: image,
                scanError: null
            });
            return { success: true, action: data.action };
        } else {
            const errorMsg = data.error || "Server returned an error";
            await chrome.storage.local.set({
                scanStatus: "error",
                scanError: errorMsg
            });
            return { success: false, error: errorMsg };
        }
    } catch (err) {
        console.error("[BG] Server fetch error:", err);
        const errorMsg = "Could not reach server (http://localhost:3000). Please ensure server is running.";
        await chrome.storage.local.set({
            scanStatus: "error",
            scanError: errorMsg
        });
        return { success: false, error: errorMsg };
    }
}

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
        // Screenshot capture
        if (message.type === "CAPTURE_SCREENSHOT") {
            const sendCaptureResponse = (dataUrl) => {
                if (chrome.runtime.lastError) {
                    console.error("captureVisibleTab error:", chrome.runtime.lastError);
                    sendResponse({
                        success: false,
                        error: chrome.runtime.lastError.message
                    });
                    return;
                }
                sendResponse({ success: true, image: dataUrl });
            };

            try {
                chrome.tabs.captureVisibleTab(
                    null,
                    { format: "png" },
                    sendCaptureResponse
                );
            } catch (err) {
                // Fallback for browsers requiring omitted windowId
                try {
                    chrome.tabs.captureVisibleTab(
                        { format: "png" },
                        sendCaptureResponse
                    );
                } catch (err2) {
                    sendResponse({ success: false, error: err2.message });
                }
            }
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

        // Analysis request from content script (avoids Mixed Content / CORS restrictions)
        if (message.type === "ANALYZE_IMAGE") {
            handleAnalyze(message.image, message.dom)
                .then((result) => sendResponse(result))
                .catch((err) => sendResponse({ success: false, error: err.message }));
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
    // 1. Chrome MV3 Offscreen API
    if (typeof chrome !== "undefined" && chrome.offscreen && typeof chrome.offscreen.createDocument === "function") {
        if (chrome.runtime.getContexts) {
            const existingContexts = await chrome.runtime.getContexts({
                contextTypes: ["OFFSCREEN_DOCUMENT"]
            });
            if (existingContexts.length > 0) return;
        }

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
        } catch (err) {
            // Document might already exist in concurrent calls
            if (!err.message?.includes("already exists")) {
                throw err;
            }
        } finally {
            creatingOffscreen = null;
        }
        return;
    }

    // 2. Firefox MV3 / background page with DOM & Web Worker access
    if (typeof document !== "undefined") {
        if (document.getElementById("offscreen-frame")) return;

        return new Promise((resolve) => {
            const iframe = document.createElement("iframe");
            iframe.id = "offscreen-frame";
            iframe.src = chrome.runtime.getURL("offscreen.html");
            iframe.style.display = "none";
            iframe.onload = () => resolve();
            iframe.onerror = () => resolve();

            const targetParent = document.body || document.documentElement;
            if (targetParent) {
                targetParent.appendChild(iframe);
            } else {
                document.addEventListener("DOMContentLoaded", () => {
                    (document.body || document.documentElement).appendChild(iframe);
                });
            }

            // Safety timeout in case onload event was missed
            setTimeout(resolve, 500);
        });
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
