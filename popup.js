// ── State & DOM References ───────────────────────────
const btnScan = document.getElementById("btn-scan");
const btnScanText = document.getElementById("scan-btn-text");
const scanSpinner = document.getElementById("scan-spinner");
const scansCountText = document.getElementById("scans-count-text");
const globalStatusBadge = document.getElementById("global-status-badge");
const globalStatusText = document.getElementById("global-status-text");

const btnBackToScan = document.getElementById("btn-back-to-scan");
const navHome = document.getElementById("nav-home");
const navAbout = document.getElementById("nav-about");
const brandHeader = document.getElementById("brand-header");

const agentStatusIndicator = document.getElementById("agent-status-indicator");
const agentStatusText = document.getElementById("agent-status-text");
const stepIconContext = document.getElementById("step-icon-context");
const stepTextContext = document.getElementById("step-text-context");
const stepInterpreting = document.getElementById("step-interpreting");
const stepIconInterpreting = document.getElementById("step-icon-interpreting");
const stepTextInterpreting = document.getElementById("step-text-interpreting");
const stepDecision = document.getElementById("step-decision");
const stepIconDecision = document.getElementById("step-icon-decision");
const stepTextDecision = document.getElementById("step-text-decision");
const codeSnippetBox = document.getElementById("code-snippet-box");
const agentActionCode = document.getElementById("agent-action-code");
const btnDownloadSanitized = document.getElementById("btn-download-sanitized");

// ── View Navigation ─────────────────────────────────
function navigateTo(viewId) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));

    const target = document.getElementById(viewId);
    if (target) target.classList.add("active");

    if (viewId === "view-home") navHome?.classList.add("active");
    if (viewId === "view-about") navAbout?.classList.add("active");
    if (viewId === "view-agent") navHome?.classList.add("active");
}

// ── Update Global Status Badge ──────────────────────
function updateGlobalBadge(text, state = "idle") {
    if (!globalStatusText || !globalStatusBadge) return;
    globalStatusText.textContent = text;
    globalStatusBadge.className = "status-badge";
    if (state === "active") globalStatusBadge.classList.add("active");
    if (state === "analyzing") globalStatusBadge.classList.add("analyzing");
    if (state === "error") globalStatusBadge.classList.add("error");
}

// ── Render Agent Activity Page ──────────────────────
function renderAgentState(status, action, errorMsg, hasImage = false) {
    if (status === "processing" || status === "analyzing") {
        updateGlobalBadge("ANALYZING...", "analyzing");

        if (agentStatusIndicator) {
            agentStatusIndicator.className = "agent-status-indicator analyzing";
            agentStatusText.textContent = "AI AGENT INFERENCE IN PROGRESS";
        }

        if (stepIconContext) {
            stepIconContext.className = "action-arrow done";
            stepIconContext.innerHTML = "✓";
        }
        if (stepTextContext) stepTextContext.textContent = "Sanitizing DOM & vision on-device...";

        if (stepInterpreting) stepInterpreting.className = "action-step";
        if (stepIconInterpreting) stepIconInterpreting.innerHTML = '<span class="step-spinner"></span>';
        if (stepTextInterpreting) stepTextInterpreting.textContent = "Analyzing sanitized state with Groq LLM...";

        if (stepDecision) stepDecision.className = "action-step pending";
        if (stepIconDecision) stepIconDecision.innerHTML = "❯";
        if (stepTextDecision) stepTextDecision.textContent = "Awaiting optimal next action decision...";

        if (codeSnippetBox) codeSnippetBox.className = "code-snippet loading";
        if (agentActionCode) agentActionCode.textContent = "Waiting for AI model decision...";

        if (btnDownloadSanitized) {
            btnDownloadSanitized.style.display = hasImage ? "flex" : "none";
        }
        return;
    }

    if (status === "error") {
        updateGlobalBadge("ERROR", "error");

        if (agentStatusIndicator) {
            agentStatusIndicator.className = "agent-status-indicator error";
            agentStatusText.textContent = "ANALYSIS ERROR";
        }

        if (stepIconInterpreting) stepIconInterpreting.innerHTML = "✕";
        if (stepTextInterpreting) stepTextInterpreting.textContent = "Failed to communicate with LLM server";

        if (codeSnippetBox) codeSnippetBox.className = "code-snippet";
        if (agentActionCode) agentActionCode.textContent = errorMsg || "Error: Ensure http://localhost:3000 is running";

        if (btnDownloadSanitized) {
            btnDownloadSanitized.style.display = hasImage ? "flex" : "none";
        }
        return;
    }

    // Default / Ready State
    updateGlobalBadge("READY", "idle");

    if (agentStatusIndicator) {
        agentStatusIndicator.className = "agent-status-indicator";
        agentStatusText.textContent = "SANITIZED CONTEXT ACTIVE";
    }

    if (stepIconContext) {
        stepIconContext.className = "action-arrow done";
        stepIconContext.innerHTML = "✓";
    }
    if (stepTextContext) stepTextContext.textContent = "Sanitized context received";

    if (stepInterpreting) stepInterpreting.className = "action-step";
    if (stepIconInterpreting) {
        stepIconInterpreting.className = "action-arrow done";
        stepIconInterpreting.innerHTML = "✓";
    }
    if (stepTextInterpreting) stepTextInterpreting.textContent = "Page state analyzed by LLM";

    if (stepDecision) stepDecision.className = "action-step";
    if (stepIconDecision) {
        stepIconDecision.className = "action-arrow done";
        stepIconDecision.innerHTML = "✓";
    }
    if (stepTextDecision) stepTextDecision.textContent = "Optimal browser action generated";

    if (codeSnippetBox) codeSnippetBox.className = "code-snippet";

    if (action) {
        const type = action.type || "none";
        const target = action.target ? `"${action.target}"` : "null";
        const value = action.value ? `"${action.value}"` : "null";
        agentActionCode.textContent = `{type: "${type}", target: ${target}, value: ${value}}`;
    } else {
        agentActionCode.textContent = '{type: "none", target: null, value: null}';
    }

    if (btnDownloadSanitized) {
        btnDownloadSanitized.style.display = hasImage ? "flex" : "none";
    }
}

// ── Load Initial Stored State ────────────────────────
function init() {
    chrome.storage.local.get(["scansToday", "lastAction", "scanStatus", "scanError", "sanitizedImage"], (data) => {
        const count = data.scansToday || 0;
        if (scansCountText) {
            scansCountText.textContent = `${count} scan${count === 1 ? "" : "s"} today`;
        }

        const status = data.scanStatus || (data.lastAction ? "ready" : "idle");
        const hasImage = Boolean(data.sanitizedImage);
        renderAgentState(status, data.lastAction, data.scanError, hasImage);

        // If a scan was initiated or just finished, show the Agent Activity view
        if (status === "processing" || status === "analyzing" || status === "ready") {
            navigateTo("view-agent");
        }
    });
}

// ── Trigger Scan Flow ────────────────────────────────
function startScanProcess() {
    // 1. Immediately switch to Agent Activity view
    navigateTo("view-agent");

    // 2. Set UI and storage to analyzing
    renderAgentState("analyzing", null, null, false);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const tab = tabs[0];
        if (!tab.id) return;

        // Increment scan count and set processing status
        chrome.storage.local.get("scansToday", (data) => {
            const count = (data.scansToday || 0) + 1;
            chrome.storage.local.set({
                scansToday: count,
                scanStatus: "analyzing",
                lastAction: null,
                scanError: null
            });
            if (scansCountText) {
                scansCountText.textContent = `${count} scan${count === 1 ? "" : "s"} today`;
            }
        });

        // Send scan command with dynamic injection fallback if tab was not refreshed
        chrome.tabs.sendMessage(tab.id, { action: "runMyFunction" }, async () => {
            if (chrome.runtime.lastError) {
                console.log("[Popup] Content script not connected, dynamically injecting scripts...");
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ["ocr.js", "content.js"]
                    });

                    setTimeout(() => {
                        chrome.tabs.sendMessage(tab.id, { action: "runMyFunction" }, () => {
                            if (chrome.runtime.lastError) {
                                console.warn("[Popup] Second attempt failed:", chrome.runtime.lastError.message);
                                renderAgentState("error", null, "Please refresh the target webpage tab and try again.", false);
                            }
                        });
                    }, 300);
                } catch (injectErr) {
                    console.warn("[Popup] Injection error:", injectErr.message);
                    renderAgentState("error", null, "Cannot scan internal browser pages (e.g. chrome://, new tab). Please open a normal webpage.", false);
                }
            }
        });
    });
}

// ── Listen for Real-Time Storage Updates ─────────────
chrome.storage.onChanged.addListener((changes) => {
    chrome.storage.local.get(["scanStatus", "lastAction", "scanError", "sanitizedImage"], (data) => {
        const status = data.scanStatus || "idle";
        const hasImage = Boolean(data.sanitizedImage);
        renderAgentState(status, data.lastAction, data.scanError, hasImage);

        if (status === "analyzing" || status === "ready") {
            navigateTo("view-agent");
        }
    });
});

// ── Event Listeners ──────────────────────────────────
btnScan?.addEventListener("click", startScanProcess);
btnBackToScan?.addEventListener("click", () => navigateTo("view-home"));
navHome?.addEventListener("click", () => navigateTo("view-home"));
navAbout?.addEventListener("click", () => navigateTo("view-about"));
brandHeader?.addEventListener("click", () => navigateTo("view-home"));

// Download sanitized screenshot directly on click
btnDownloadSanitized?.addEventListener("click", () => {
    chrome.storage.local.get("sanitizedImage", (data) => {
        if (!data.sanitizedImage) return;

        const link = document.createElement("a");
        link.href = data.sanitizedImage;
        link.download = `sanitized-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    });
});

// Run init
init();
