/**
 * PII and Sensitive Data Detector Engine with AI Placeholder Tagging
 */

// Regex patterns for sensitive data
const PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  creditCard: /\b(?:\d[ -]*?){13,19}\b/g,
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
  apiKey: /\b(?:sk-[a-zA-Z0-9]{32,48}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|AIza[0-9A-Za-z-_]{35}|[a-f0-9]{32,64})\b/gi,
  jwtToken: /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g,
  aadhaar: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g,
  panCard: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g
};

// Map detection types to exact AI prompt placeholders
const PLACEHOLDER_MAP = {
  'Email': '[EMAIL]',
  'Credit Card': '[CREDIT_CARD]',
  'Phone Number': '[PHONE]',
  'SSN / National ID': '[SSN]',
  'Aadhaar / ID': '[NATIONAL_ID]',
  'Tax ID / PAN': '[TAX_ID]',
  'API Key/Secret': '[API_KEY]',
  'JWT Auth Token': '[AUTH_TOKEN]',
  'Sensitive Input': '[PASSWORD]'
};

// Check credit card number using Luhn algorithm
function isValidLuhn(cardNumberStr) {
  const digits = cardNumberStr.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// Sensitive keywords for input attributes (name, id, placeholder, label)
const SENSITIVE_INPUT_KEYWORDS = [
  'password', 'passwd', 'pwd', 'ssn', 'social', 'credit', 'card', 'cvv', 'cvc',
  'security', 'secret', 'token', 'auth', 'apikey', 'api_key', 'private',
  'account_number', 'routing', 'pin', 'dob', 'birth', 'tax', 'aadhaar', 'pan'
];

/**
 * Scan text string for PII matches and assign AI placeholders
 */
function scanTextContent(text) {
  const matches = [];

  // Emails -> [EMAIL]
  let match;
  const emailRegex = new RegExp(PATTERNS.email);
  while ((match = emailRegex.exec(text)) !== null) {
    matches.push({ type: 'Email', tag: '[EMAIL]', value: match[0], index: match.index, length: match[0].length });
  }

  // Credit Cards -> [CREDIT_CARD]
  const ccRegex = new RegExp(PATTERNS.creditCard);
  while ((match = ccRegex.exec(text)) !== null) {
    const rawVal = match[0];
    if (isValidLuhn(rawVal)) {
      matches.push({ type: 'Credit Card', tag: '[CREDIT_CARD]', value: rawVal, index: match.index, length: rawVal.length });
    }
  }

  // API Keys -> [API_KEY]
  const apiKeyRegex = new RegExp(PATTERNS.apiKey);
  while ((match = apiKeyRegex.exec(text)) !== null) {
    matches.push({ type: 'API Key/Secret', tag: '[API_KEY]', value: match[0], index: match.index, length: match[0].length });
  }

  // JWT Tokens -> [AUTH_TOKEN]
  const jwtRegex = new RegExp(PATTERNS.jwtToken);
  while ((match = jwtRegex.exec(text)) !== null) {
    matches.push({ type: 'JWT Auth Token', tag: '[AUTH_TOKEN]', value: match[0], index: match.index, length: match[0].length });
  }

  // SSNs -> [SSN]
  const ssnRegex = new RegExp(PATTERNS.ssn);
  while ((match = ssnRegex.exec(text)) !== null) {
    if (!matches.some(m => m.index <= match.index && m.index + m.length >= match.index + match[0].length)) {
      matches.push({ type: 'SSN / National ID', tag: '[SSN]', value: match[0], index: match.index, length: match[0].length });
    }
  }

  // Phone Numbers -> [PHONE]
  const phoneRegex = new RegExp(PATTERNS.phone);
  while ((match = phoneRegex.exec(text)) !== null) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) {
      if (!matches.some(m => m.index <= match.index && m.index + m.length >= match.index + match[0].length)) {
        matches.push({ type: 'Phone Number', tag: '[PHONE]', value: match[0], index: match.index, length: match[0].length });
      }
    }
  }

  // Aadhaar Card -> [NATIONAL_ID]
  const aadhaarRegex = new RegExp(PATTERNS.aadhaar);
  while ((match = aadhaarRegex.exec(text)) !== null) {
    if (!matches.some(m => m.index <= match.index && m.index + m.length >= match.index + match[0].length)) {
      matches.push({ type: 'Aadhaar / ID', tag: '[NATIONAL_ID]', value: match[0], index: match.index, length: match[0].length });
    }
  }

  // PAN Card -> [TAX_ID]
  const panRegex = new RegExp(PATTERNS.panCard);
  while ((match = panRegex.exec(text)) !== null) {
    matches.push({ type: 'Tax ID / PAN', tag: '[TAX_ID]', value: match[0], index: match.index, length: match[0].length });
  }

  return matches;
}

/**
 * Test an HTML Input element for sensitive attributes
 */
function isSensitiveInput(inputEl) {
  if (!inputEl) return false;
  
  const type = (inputEl.getAttribute('type') || 'text').toLowerCase();
  if (type === 'password' || type === 'hidden') return true;

  const attrsToTest = [
    inputEl.id,
    inputEl.name,
    inputEl.getAttribute('placeholder'),
    inputEl.getAttribute('aria-label'),
    inputEl.getAttribute('autocomplete')
  ].filter(Boolean).map(s => s.toLowerCase());

  for (const attr of attrsToTest) {
    for (const kw of SENSITIVE_INPUT_KEYWORDS) {
      if (attr.includes(kw)) return true;
    }
  }

  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scanTextContent, isSensitiveInput, isValidLuhn, PATTERNS, PLACEHOLDER_MAP };
}
