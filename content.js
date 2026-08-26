console.log("SIH Privacy Agent loaded");

function detectSensitiveField(input) {

    const type = input.type?.toLowerCase() || "";
    const name = input.name?.toLowerCase() || "";
    const id = input.id?.toLowerCase() || "";
    const placeholder = input.placeholder?.toLowerCase() || "";
    const autocomplete = input.autocomplete?.toLowerCase() || "";

    const combined = `
        ${type}
        ${name}
        ${id}
        ${placeholder}
        ${autocomplete}
    `;

    if (type === "password") {
        return "PASSWORD";
    }
    if (
        combined.includes("email")
    ) {
        return "EMAIL";
    }
    if (combined.includes("dateofbirth") || combined.includes("dob")) {
        return "DATEOFBIRTH";
    }
    if (
        combined.includes("username") || combined.includes("name")
    ) {
        return "USERNAME";
    }
    if (
        combined.includes("number")
    ) {
        return "NUMBER";
    }
    if (
        type === "tel" ||
        combined.includes("phone") ||
        combined.includes("mobile") || combined.includes("contact")
    ) {
        return "PHONE";
    }
    if (
        combined.includes("card") ||
        combined.includes("credit")
    ) {
        return "CREDIT_CARD";
    }

    return null;
}

// Recursively find all input/textarea elements, including inside Shadow DOM
function getAllInputs(root = document) {
    const results = [];
    const elements = root.querySelectorAll("input, textarea");
    results.push(...elements);

    // Search inside Shadow DOM roots
    root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) {
            results.push(...getAllInputs(el.shadowRoot));
        }
    });

    return results;
}

// Scan page and collect sensitive field positions (no visible overlays)
function getSensitiveFields() {
    const inputs = getAllInputs();
    const fields = [];

    inputs.forEach((input) => {
        const type = detectSensitiveField(input);

        if (type) {
            const rect = input.getBoundingClientRect();

            // Skip hidden or zero-size elements
            if (rect.width === 0 || rect.height === 0) return;

            console.log(`Detected ${type}`, input);

            fields.push({
                type,
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
            });
        }
    });

    return fields;
}

// Ask background script to capture a screenshot
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

// Draw redaction boxes onto the screenshot off-screen using canvas
function redactImage(imageDataUrl, fields) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            // Use devicePixelRatio to match screenshot resolution
            const dpr = window.devicePixelRatio || 1;

            canvas.width = img.width;
            canvas.height = img.height;

            // Draw the original screenshot
            ctx.drawImage(img, 0, 0);

            // Draw black redaction boxes with labels
            ctx.fillStyle = "black";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            fields.forEach((field) => {
                const x = field.x * dpr;
                const y = field.y * dpr;
                const w = field.width * dpr;
                const h = field.height * dpr;

                // Black box
                ctx.fillStyle = "black";
                ctx.fillRect(x, y, w, h);

                // White label
                ctx.fillStyle = "white";
                ctx.font = `${Math.min(h * 0.6, 14 * dpr)}px sans-serif`;
                ctx.fillText(`[${field.type}]`, x + w / 2, y + h / 2);
            });

            resolve(canvas.toDataURL("image/png"));
        };
        img.src = imageDataUrl;
    });
}

// Download a data URL as a file
function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// Main scan flow: screenshot → redact off-screen → download
// No visible overlays on screen at all!
async function scanAndRedact() {

    // 1. Detect sensitive fields and get their positions
    const fields = getSensitiveFields();

    if (fields.length === 0) {
        console.log("No sensitive fields detected.");
        return;
    }

    console.log(`Found ${fields.length} sensitive field(s). Capturing screenshot...`);

    // 2. Take a clean screenshot (no overlays visible)
    const screenshotDataUrl = await captureScreenshot();

    // 3. Draw redaction boxes onto the image off-screen
    const redactedDataUrl = await redactImage(screenshotDataUrl, fields);

    // 4. Download the redacted image
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadDataUrl(redactedDataUrl, `privacy-scan-${timestamp}.png`);

    console.log("Redacted screenshot saved.");
}

// Listen for scan command from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "runMyFunction") {
        scanAndRedact()
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ error: err.message }));

        return true;
    }
});