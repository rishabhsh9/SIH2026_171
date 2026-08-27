/**
 * config.js
 * Central configuration for Node.js Privacy-Preserving Vision Agent Server.
 */

require('dotenv').config();

const settings = {
  // --- AI API Config ---
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
  VLM_MODEL: process.env.VLM_MODEL || 'gemini-2.5-flash',
  MAX_TOKENS: parseInt(process.env.MAX_TOKENS || '500', 10),

  // --- Server Config ---
  HOST: process.env.HOST || '0.0.0.0',
  PORT: parseInt(process.env.PORT || '8000', 10),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '*').split(','),

  // --- Session Config ---
  SESSION_TTL_SECONDS: parseInt(process.env.SESSION_TTL_SECONDS || '1800', 10), // 30 min
  MAX_HISTORY_TURNS: parseInt(process.env.MAX_HISTORY_TURNS || '6', 10),

  // --- Privacy / Redaction Config ---
  REDACTION_TOKENS: [
    '[REDACTED_PII]',
    '[REDACTED_SECRET]',
    '[REDACTED_EMAIL]',
    '[REDACTED_PHONE]',
    '[REDACTED_NAME]',
    '[REDACTED_ADDRESS]',
    '[REDACTED_CARD]',
    '[REDACTED_FACE]',
    '[REDACTED_OTHER]',
  ],

  PII_GUARD_PATTERNS: {
    email: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/,
    phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{3,4}\b/,
    credit_card: /\b(?:\d[ -]*?){13,19}\b/,
  },

  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
};

module.exports = { settings };
