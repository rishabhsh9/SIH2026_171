/**
 * Popup Script for Non-Destructive AI Prompt & Vision Extraction
 */

document.addEventListener('DOMContentLoaded', async () => {
  const autoToggle = document.getElementById('autoToggle');
  const scanBtn = document.getElementById('scanBtn');
  const restoreBtn = document.getElementById('restoreBtn');
  const copyAiPromptBtn = document.getElementById('copyAiPromptBtn');
  const captureVisionBtn = document.getElementById('captureVisionBtn');
  const userQuestion = document.getElementById('userQuestion');
  const statusBadge = document.getElementById('statusBadge');
  const toast = document.getElementById('toast');

  // Stats elements
  const totalCountEl = document.getElementById('totalCount');
  const emailCountEl = document.getElementById('emailCount');
  const cardCountEl = document.getElementById('cardCount');
  const tokenCountEl = document.getElementById('tokenCount');

  // Vision Elements
  const visionPreviewBox = document.getElementById('visionPreviewBox');
  const visionImg = document.getElementById('visionImg');
  const downloadVisionBtn = document.getElementById('downloadVisionBtn');

  let currentCapturedDataUrl = null;

  // Load saved state
  chrome.storage.sync.get(['autoRedact'], (data) => {
    autoToggle.checked = !!data.autoRedact;
  });

  autoToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ autoRedact: autoToggle.checked });
  });

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // Scan & Analyze Page Data (Non-destructive)
  scanBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;

    statusBadge.textContent = 'Scanning Data...';
    statusBadge.className = 'status-badge';

    chrome.tabs.sendMessage(tab.id, { action: 'SCAN_AND_REDACT' }, (res) => {
      if (chrome.runtime.lastError) {
        alert('Please refresh the active web page to activate the extension.');
        statusBadge.textContent = 'Error';
        return;
      }
      if (res && res.stats) {
        updateDashboardUI(res.stats);
        statusBadge.textContent = 'Scanned & Safe';
        statusBadge.className = 'status-badge active';
        showToast('Page scanned & PII converted to tags!');
      }
    });
  });

  // Clear Stats
  restoreBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: 'RESTORE_PAGE' }, () => {
      updateDashboardUI({ total: 0, byType: {}, items: [] });
      statusBadge.textContent = 'Idle';
      statusBadge.className = 'status-badge';
      visionPreviewBox.classList.add('hidden');
    });
  });

  // Copy Sanitized AI Prompt
  copyAiPromptBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, { action: 'GET_SANITIZED_TEXT' }, (res) => {
      if (res && res.sanitizedText) {
        const promptText = buildFormattedAiPrompt(userQuestion.value.trim(), res.sanitizedText);
        navigator.clipboard.writeText(promptText).then(() => {
          showToast('Copied sanitized prompt for AI automation!');
        });
      } else {
        showToast('Click "1. Scan & Redact Data" first!');
      }
    });
  });

  // Capture Vision Screen Click (Redacted Snapshot)
  captureVisionBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;

    statusBadge.textContent = 'Capturing Redacted Vision...';
    
    chrome.tabs.sendMessage(tab.id, { action: 'TAKE_REDACTED_SNAPSHOT' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.success || !res.dataUrl) {
        alert('Please refresh the active page to capture redacted screen vision.');
        statusBadge.textContent = 'Ready';
        return;
      }
      
      currentCapturedDataUrl = res.dataUrl;
      visionImg.src = res.dataUrl;
      visionPreviewBox.classList.remove('hidden');
      statusBadge.textContent = 'Scanned & Safe';
      statusBadge.className = 'status-badge active';
      showToast('Captured redacted vision screen with [EMAIL] tags!');
    });
  });

  // Download Vision Screenshot
  downloadVisionBtn.addEventListener('click', () => {
    if (!currentCapturedDataUrl) return;
    const a = document.createElement('a');
    a.href = currentCapturedDataUrl;
    a.download = 'ai-vision-context.png';
    a.click();
  });

  function buildFormattedAiPrompt(question, sanitizedPageText) {
    const header = `--- SANITIZED PAGE DATA CONTEXT (Sensitive PII replaced with [EMAIL], [PHONE], [CREDIT_CARD], [PASSWORD]) ---`;
    const qHeader = `--- USER AUTOMATION TASK / QUESTION ---`;
    const userQ = question ? question : `Please help me automate this form/page using the sanitized DOM context provided above.`;

    return `${header}\n\n${sanitizedPageText.trim()}\n\n${qHeader}\n${userQ}`;
  }

  function updateDashboardUI(stats) {
    totalCountEl.textContent = stats.total || 0;
    emailCountEl.textContent = stats.byType['Email'] || 0;
    
    const cards = (stats.byType['Credit Card'] || 0) + (stats.byType['SSN / National ID'] || 0) + (stats.byType['Aadhaar / ID'] || 0) + (stats.byType['Tax ID / PAN'] || 0);
    cardCountEl.textContent = cards;

    const tokens = (stats.byType['API Key/Secret'] || 0) + (stats.byType['JWT Auth Token'] || 0) + (stats.byType['Sensitive Input'] || 0);
    tokenCountEl.textContent = tokens;
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2200);
  }
});
