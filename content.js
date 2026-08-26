/**
 * Content script for DOM scanning, non-destructive Vision Capture (applies instantaneous visual masks, takes snapshot, restores), and PII sanitization for AI context.
 */

let scanStats = {
  total: 0,
  byType: {},
  items: []
};

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SCAN_AND_REDACT' || request.action === 'GET_SANITIZED_TEXT') {
    const result = captureAndSanitizeDOM();
    sendResponse({ success: true, stats: result.stats, sanitizedText: result.sanitizedText });
  } else if (request.action === 'TAKE_REDACTED_SNAPSHOT') {
    takeRedactedVisionSnapshot().then(dataUrl => {
      sendResponse({ success: true, dataUrl });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'RESTORE_PAGE') {
    scanStats = { total: 0, byType: {}, items: [] };
    chrome.runtime.sendMessage({ action: 'UPDATE_BADGE', count: 0 });
    sendResponse({ success: true });
  }
  return true;
});

/**
 * Temporarily applies visual redaction ([EMAIL], [PASSWORD], etc.) onto the actual page DOM,
 * requests a tab screenshot from background service worker, and immediately restores original values.
 */
async function takeRedactedVisionSnapshot() {
  const originalInputsState = [];
  const originalTextNodesState = [];

  try {
    // 1. Temporarily replace sensitive Input values
    const realInputs = document.querySelectorAll('input, textarea');
    realInputs.forEach(input => {
      const val = input.value || '';
      const isAttrSensitive = isSensitiveInput(input);
      const valueMatches = scanTextContent(val);

      if (isAttrSensitive || (valueMatches && valueMatches.length > 0)) {
        originalInputsState.push({ input, originalVal: val, originalType: input.type });

        let tag = '[PASSWORD]';
        if (valueMatches && valueMatches.length > 0) {
          tag = valueMatches[0].tag; // [EMAIL], [PHONE], [CREDIT_CARD]
        }

        input.value = tag;
        input.classList.add('pii-input-masked');
      }
    });

    // 2. Temporarily replace sensitive Text Nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
          const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
          if (['script', 'style', 'noscript', 'code'].includes(parentTag)) {
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(textNode => {
      const matches = scanTextContent(textNode.nodeValue);
      if (matches && matches.length > 0) {
        const parent = textNode.parentElement;
        if (parent) {
          originalTextNodesState.push({ parent, originalNode: textNode, nextSibling: textNode.nextSibling });
          redactTextNodeForSnapshot(textNode, matches);
        }
      }
    });

    // Short delay to allow browser layout render
    await new Promise(r => setTimeout(r, 60));

    // Request tab screenshot from background script while DOM is visually redacted
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' }, resolve);
    });

    return response.dataUrl;

  } finally {
    // 3. IMMEDIATELY RESTORE original page input values and text nodes!
    originalInputsState.forEach(item => {
      item.input.value = item.originalVal;
      item.input.classList.remove('pii-input-masked');
    });

    originalTextNodesState.forEach(item => {
      // Remove created redacted spans and put back original text node
      const parent = item.parent;
      if (parent) {
        // Clean temporary redacted spans
        const tempSpans = parent.querySelectorAll('.pii-redacted-tag');
        tempSpans.forEach(s => s.remove());
        if (item.nextSibling) {
          parent.insertBefore(item.originalNode, item.nextSibling);
        } else {
          parent.appendChild(item.originalNode);
        }
      }
    });
  }
}

/**
 * Inline text node redactor helper for snapshot
 */
function redactTextNodeForSnapshot(textNode, matches) {
  const parent = textNode.parentElement;
  if (!parent) return;

  let text = textNode.nodeValue;
  const frag = document.createDocumentFragment();
  let lastIdx = 0;

  matches.sort((a, b) => a.index - b.index);

  matches.forEach(m => {
    if (m.index > lastIdx) {
      frag.appendChild(document.createTextNode(text.substring(lastIdx, m.index)));
    }

    const span = document.createElement('span');
    span.className = 'pii-redacted-tag';
    span.textContent = m.tag;
    frag.appendChild(span);
    lastIdx = m.index + m.length;
  });

  if (lastIdx < text.length) {
    frag.appendChild(document.createTextNode(text.substring(lastIdx)));
  }

  parent.replaceChild(frag, textNode);
}

/**
 * Captures page content and replaces sensitive data with placeholders IN MEMORY ONLY.
 */
function captureAndSanitizeDOM() {
  scanStats = { total: 0, byType: {}, items: [] };
  const clone = document.body.cloneNode(true);

  const realInputs = document.querySelectorAll('input, textarea');
  const cloneInputs = clone.querySelectorAll('input, textarea');

  realInputs.forEach((realInput, idx) => {
    const cloneInput = cloneInputs[idx];
    if (!cloneInput) return;

    const val = realInput.value || '';
    const isAttrSensitive = isSensitiveInput(realInput);
    const valueMatches = scanTextContent(val);

    let replacementTag = null;
    if (valueMatches && valueMatches.length > 0) {
      replacementTag = valueMatches[0].tag;
      recordStat(valueMatches[0].type, val, replacementTag);
    } else if (isAttrSensitive && val) {
      replacementTag = realInput.type === 'password' ? '[PASSWORD]' : '[SENSITIVE_INPUT]';
      recordStat('Sensitive Input', val, replacementTag);
    }

    const textReplacement = document.createElement('span');
    textReplacement.textContent = replacementTag ? ` ${replacementTag} ` : ` ${val} `;
    if (cloneInput.parentNode) {
      cloneInput.parentNode.replaceChild(textReplacement, cloneInput);
    }
  });

  const walker = document.createTreeWalker(
    clone,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
        const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
        if (['script', 'style', 'noscript', 'code'].includes(parentTag)) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodesToProcess = [];
  while (walker.nextNode()) {
    nodesToProcess.push(walker.currentNode);
  }

  nodesToProcess.forEach(textNode => {
    const matches = scanTextContent(textNode.nodeValue);
    if (matches && matches.length > 0) {
      sanitizeTextNodeInClone(textNode, matches);
    }
  });

  chrome.runtime.sendMessage({ action: 'UPDATE_BADGE', count: scanStats.total });

  const sanitizedText = clone.innerText || clone.textContent || '';
  return { stats: scanStats, sanitizedText };
}

function sanitizeTextNodeInClone(textNode, matches) {
  const parent = textNode.parentElement;
  if (!parent) return;

  let text = textNode.nodeValue;
  const frag = document.createDocumentFragment();
  let lastIdx = 0;

  matches.sort((a, b) => a.index - b.index);

  matches.forEach(m => {
    if (m.index > lastIdx) {
      frag.appendChild(document.createTextNode(text.substring(lastIdx, m.index)));
    }

    frag.appendChild(document.createTextNode(` ${m.tag} `));
    lastIdx = m.index + m.length;

    recordStat(m.type, m.value, m.tag);
  });

  if (lastIdx < text.length) {
    frag.appendChild(document.createTextNode(text.substring(lastIdx)));
  }

  parent.replaceChild(frag, textNode);
}

function recordStat(type, val, tag) {
  scanStats.total++;
  scanStats.byType[type] = (scanStats.byType[type] || 0) + 1;
  const maskedVal = val.length > 6 ? val.substring(0, 3) + '***' + val.substring(val.length - 2) : '***';
  scanStats.items.push({ type, maskedVal, tag });
}
