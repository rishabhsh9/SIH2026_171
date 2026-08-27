/**
 * privacyGuard.js
 * Server-side defense-in-depth PII scanner & safe logging helper.
 */

const { settings } = require('./config');

function scanScreenContext(elements) {
  const findings = [];

  for (const el of elements || []) {
    const textToScan = [el.value, el.label].filter(Boolean).join(' ');
    if (!textToScan) continue;

    // Check if element is already marked redacted
    if (el.redacted || settings.REDACTION_TOKENS.some((t) => textToScan.includes(t))) {
      continue;
    }

    for (const [patternName, patternRegex] of Object.entries(settings.PII_GUARD_PATTERNS)) {
      if (patternRegex.test(textToScan)) {
        findings.push({
          element_id: el.id,
          pattern: patternName,
        });
      }
    }
  }

  return findings;
}

function redactForLogging(data) {
  if (!data || typeof data !== 'object') return data;
  const cloned = JSON.parse(JSON.stringify(data));

  if (cloned.image_b64) {
    cloned.image_b64 = `<base64_image_${cloned.image_b64.length}_bytes>`;
  }

  if (Array.isArray(cloned.elements)) {
    cloned.elements = cloned.elements.map((el) => {
      if (el.value && !el.redacted) {
        for (const patternRegex of Object.values(settings.PII_GUARD_PATTERNS)) {
          if (patternRegex.test(el.value)) {
            el.value = '[REDACTED_BY_SERVER_LOG_GUARD]';
            break;
          }
        }
      }
      return el;
    });
  }

  return cloned;
}

module.exports = {
  scanScreenContext,
  redactForLogging,
};
