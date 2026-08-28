console.log("SIH Privacy Agent loaded");

// Fast, clean DOM field detector for sensitive inputs
function detectSensitiveDOMField(el) {
    const tag = el.tagName?.toLowerCase() || "";
    const type = el.type?.toLowerCase() || "";
    const name = el.name?.toLowerCase() || "";
    const id = el.id?.toLowerCase() || "";
    const placeholder = (el.placeholder || el.getAttribute("placeholder") || "").toLowerCase();
    const autocomplete = (el.autocomplete || el.getAttribute("autocomplete") || "").toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "").toLowerCase();
    const dataTestId = (el.getAttribute("data-testid") || "").toLowerCase();
    const title = (el.title || "").toLowerCase();
    const val = (el.value || el.getAttribute("value") || el.innerText || el.textContent || "").trim();

    // 1. Password inputs
    if (type === "password") return "PASSWORD";

    // 2. Metadata string (lowercased)
    const combined = `${tag} ${type} ${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel} ${dataTestId} ${title}`;

    if (combined.includes("password") || combined.includes("pwd")) return "PASSWORD";
    if (type === "email" || combined.includes("email")) return "EMAIL";
    if (type === "tel" || combined.includes("phone") || combined.includes("mobile") || combined.includes("contact")) return "PHONE";
    if (combined.includes("card") || combined.includes("credit") || combined.includes("debit") || combined.includes("cvv")) return "CREDIT_CARD";
    if (combined.includes("aadhaar") || combined.includes("aadhar") || combined.includes("uidai")) return "AADHAAR";
    if (combined.includes("pan") && !combined.includes("panel") && !combined.includes("span")) return "PAN";
    if (combined.includes("passport")) return "PASSPORT";
    if (combined.includes("voter")) return "VOTER_ID";
    if (combined.includes("driving") || combined.includes("licence") || combined.includes("license")) return "DRIVING_LICENCE";
    if (combined.includes("dateofbirth") || combined.includes("birthdate") || combined.includes("dob")) return "DOB";
    if (combined.includes("address")) return "ADDRESS";
    if (combined.includes("zip") || combined.includes("pincode") || combined.includes("postal")) return "PINCODE";

    // 3. Entered value heuristics
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(val)) return "EMAIL";
    if (/^[6-9]\d{9}$/.test(val.replace(/\D/g, ""))) return "PHONE";

    return null;
}

// Collect all sensitive DOM elements with pixel coordinates
function getSensitiveDOMFields() {
    const fields = [];
    const dpr = window.devicePixelRatio || 1;

    // 1. Form Inputs & Interactive Textboxes
    const inputs = document.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']");
    inputs.forEach((input) => {
        const type = detectSensitiveDOMField(input);
        if (type) {
            const rect = input.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            fields.push({
                type,
                text: input.value || input.innerText || type,
                bbox: {
                    x0: rect.left * dpr,
                    y0: rect.top * dpr,
                    x1: (rect.left + rect.width) * dpr,
                    y1: (rect.top + rect.height) * dpr,
                    width: rect.width * dpr,
                    height: rect.height * dpr
                }
            });
        }
    });

    // 2. Explicit User Avatar Images (only real images, ignoring buttons/icons)
    const images = document.querySelectorAll("img.avatar, img.profile-photo, img.user-avatar, img.profile-pic, img[src*='profile'], img[src*='avatar']");
    images.forEach((img) => {
        const rect = img.getBoundingClientRect();
        // Reasonable avatar size (between 24px and 300px)
        if (rect.width >= 24 && rect.width <= 300 && rect.height >= 24 && rect.height <= 300) {
            fields.push({
                type: "FACE",
                text: "AVATAR",
                bbox: {
                    x0: rect.left * dpr,
                    y0: rect.top * dpr,
                    x1: (rect.left + rect.width) * dpr,
                    y1: (rect.top + rect.height) * dpr,
                    width: rect.width * dpr,
                    height: rect.height * dpr
                }
            });
        }
    });

    return fields;
}

// Request screenshot from background worker
function captureScreenshot() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: "CAPTURE_SCREENSHOT" },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (!response?.success) {
                    reject(new Error(response?.error || "Screenshot failed"));
                    return;
                }
                resolve(response.image);
            }
        );
    });
}

/**
 * High-Speed Privacy Pipeline:
 * 1. Capture clean screenshot & scan DOM inputs + avatars.
 * 2. Run OCR & YOLO face detection.
 * 3. Single-Pass Canvas Redaction.
 * 4. Auto-Download immediately.
 */
async function runFastPrivacyScan() {
    const startTime = performance.now();

    // 1. Gather DOM fields & capture screenshot in parallel
    const [domFields, rawScreenshot] = await Promise.all([
        Promise.resolve(getSensitiveDOMFields()),
        captureScreenshot()
    ]);

    console.log(`[Privacy Agent] DOM scan: ${domFields.length} field(s). Running OCR & Face detection...`);

    // 2. Run OCR document & YOLO face detection
    const ocrResult = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: "RUN_OCR", imageDataUrl: rawScreenshot },
            (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(res);
            }
        );
    });

    const ocrEntities = (ocrResult && ocrResult.success) ? (ocrResult.entities || []) : [];
    console.log(`[Privacy Agent] AI models found ${ocrEntities.length} item(s).`);

    // Merge entities avoiding overlapping boxes
    const allEntities = [...ocrEntities];
    domFields.forEach((dom) => {
        const isOverlap = allEntities.some(
            (e) =>
                Math.abs(e.bbox.x0 - dom.bbox.x0) < 25 &&
                Math.abs(e.bbox.y0 - dom.bbox.y0) < 25
        );
        if (!isOverlap) {
            allEntities.push(dom);
        }
    });

    // 3. Single-Pass Redaction & Download
    const redactedDataUrl = await redactAllOnCanvas(rawScreenshot, allEntities);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `privacy-scan-${timestamp}.png`;
    downloadFile(redactedDataUrl, filename);

    const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[Privacy Agent] Scan complete and downloaded in ${totalTime}s (${allEntities.length} redacted items).`);

    // 4. Send redacted image + DOM snapshot to server for LLM guidance
    try {
        const domSnapshot = getDOMSnapshot();
        console.log("[Privacy Agent] Sending redacted image + DOM to server...");
        const response = await fetch("http://localhost:3000/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: redactedDataUrl, dom: domSnapshot })
        });

        const data = await response.json();
        if (data.success && data.action) {
            console.log("[Privacy Agent] Action:", JSON.stringify(data.action));
            showActionOverlay(data.action);
        } else {
            console.warn("[Privacy Agent] Server returned error:", data.error || "Unknown error");
        }
    } catch (serverErr) {
        console.warn("[Privacy Agent] Could not reach server:", serverErr.message);
    }
}

// Extract a compact DOM snapshot of interactive elements for the LLM
function getDOMSnapshot() {
    const elements = [];

    // Inputs & textareas
    document.querySelectorAll("input, textarea, select").forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const type = el.type || "";
        const name = el.name || el.id || "";
        const placeholder = el.placeholder || "";
        const filled = el.value ? "[filled]" : "[empty]";
        const label = el.labels?.[0]?.textContent?.trim() || "";
        const disabled = el.disabled ? " [disabled]" : "";
        const required = el.required ? " [required]" : "";

        if (tag === "select") {
            const selected = el.options[el.selectedIndex]?.text || "";
            elements.push(`<select name="${name}" label="${label}" selected="${selected}"${disabled}${required}/>`);
        } else {
            elements.push(`<${tag} type="${type}" name="${name}" label="${label}" placeholder="${placeholder}" ${filled}${disabled}${required}/>`);
        }
    });

    // Buttons
    document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']").forEach((el) => {
        const text = el.textContent?.trim() || el.value || "";
        if (text) {
            const disabled = el.disabled ? " [disabled]" : "";
            elements.push(`<button${disabled}>${text}</button>`);
        }
    });

    // Links
    document.querySelectorAll("a[href]").forEach((el) => {
        const text = el.textContent?.trim() || "";
        if (text && text.length < 100) {
            elements.push(`<a>${text}</a>`);
        }
    });

    // Headings for page context
    document.querySelectorAll("h1, h2, h3").forEach((el) => {
        const text = el.textContent?.trim() || "";
        if (text) {
            elements.push(`<${el.tagName.toLowerCase()}>${text}</${el.tagName.toLowerCase()}>`);
        }
    });

    return elements.join("\n");
}

// Floating overlay — shows only the action from the LLM
function showActionOverlay(action) {
    const existing = document.getElementById("privacy-agent-guidance");
    if (existing) existing.remove();

    if (!action || action.type === "none") return;

    let text = action.type.toUpperCase();
    if (action.target) text += `: ${action.target}`;
    if (action.value) text += ` → "${action.value}"`;

    const overlay = document.createElement("div");
    overlay.id = "privacy-agent-guidance";
    overlay.textContent = text;

    Object.assign(overlay.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        maxWidth: "420px",
        padding: "12px 18px",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        color: "#7cb8ff",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: "14px",
        fontWeight: "600",
        letterSpacing: "0.5px",
        lineHeight: "1.4",
        borderRadius: "10px",
        border: "1px solid rgba(100, 180, 255, 0.4)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: "2147483647",
        cursor: "pointer",
        opacity: "0",
        transform: "translateY(20px)",
        transition: "opacity 0.3s ease, transform 0.3s ease"
    });

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = "1";
        overlay.style.transform = "translateY(0)";
    });

    overlay.addEventListener("click", () => {
        overlay.style.opacity = "0";
        overlay.style.transform = "translateY(20px)";
        setTimeout(() => overlay.remove(), 300);
    });

    setTimeout(() => {
        if (overlay.parentNode) {
            overlay.style.opacity = "0";
            overlay.style.transform = "translateY(20px)";
            setTimeout(() => overlay.remove(), 300);
        }
    }, 15000);
}

// Listen for popup trigger
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "runMyFunction") {
        runFastPrivacyScan()
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
                console.error("[Privacy Agent] Error:", err);
                sendResponse({ error: err.message });
            });

        return true;
    }
});