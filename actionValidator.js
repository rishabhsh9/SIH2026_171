/**
 * actionValidator.js
 * Validates and whitelists VLM returned actions before sending to browser.
 */

const { AgentActionSchema } = require('./models');
const { settings } = require('./config');

function validateAction(rawAction, knownElementIds = new Set()) {
  // Parse with Zod schema
  const parseResult = AgentActionSchema.safeParse(rawAction);
  if (!parseResult.success) {
    throw new Error(`Action validation failed: ${parseResult.error.message}`);
  }

  const action = parseResult.data;

  // 1. Target Element Validation
  if (['click', 'type'].includes(action.action)) {
    if (!action.target_element_id) {
      throw new Error(`Action '${action.action}' requires a 'target_element_id'.`);
    }

    if (!knownElementIds.has(action.target_element_id)) {
      throw new Error(
        `target_element_id '${action.target_element_id}' was not in current turn's element list.`
      );
    }
  }

  // 2. Value Source Validation
  if (action.action === 'type') {
    if (!action.value_source) {
      throw new Error(`Action 'type' requires a 'value_source' key.`);
    }

    // Guard against literal PII in value_source
    for (const [patternName, patternRegex] of Object.entries(settings.PII_GUARD_PATTERNS)) {
      if (patternRegex.test(action.value_source)) {
        throw new Error(
          `value_source appears to contain raw PII (${patternName}). Must be a semantic key like 'user_profile.email'.`
        );
      }
    }
  }

  // 3. Scroll Direction Validation
  if (action.action === 'scroll') {
    if (!action.scroll_direction) {
      action.scroll_direction = 'down';
    }
    if (!action.scroll_amount_px) {
      action.scroll_amount_px = 500;
    }
  }

  return action;
}

module.exports = { validateAction };
