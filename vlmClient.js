/**
 * vlmClient.js
 * Wraps the Google Gemini API call via @google/genai Node SDK.
 */

const { GoogleGenAI } = require('@google/genai');
const { settings } = require('./config');

const SYSTEM_PROMPT = `You are a browser automation vision agent operating on a PRIVACY-SANITIZED representation of a user's screen. Sensitive values have already been redacted by a local on-device model BEFORE reaching you. Redacted values appear as tokens such as:
[REDACTED_PII], [REDACTED_SECRET], [REDACTED_EMAIL], [REDACTED_PHONE], [REDACTED_NAME], [REDACTED_ADDRESS], [REDACTED_CARD], [REDACTED_FACE], [REDACTED_OTHER]

Rules you MUST follow:
1. NEVER ask the user to reveal a redacted value. NEVER attempt to guess, infer, or reconstruct it.
2. You may reason about the ROLE of a redacted field (e.g. "this is a password field") but not its content.
3. If a task requires a sensitive value to be typed into a field, emit a "type" action with "value_source" set to a semantic key (e.g. "user_profile.email") describing WHAT should go there. The value itself will be filled in locally on the client — you never see or send it.
4. You must choose target_element_id ONLY from the element ids provided in the current turn's context.
5. Respond with EXACTLY ONE JSON object and nothing else — no markdown fences, no prose before or after.

Output schema (all fields required unless noted):
{
  "action": "click" | "type" | "scroll" | "wait" | "navigate_back" | "done" | "ask_user",
  "target_element_id": string or null,
  "value_source": string or null,
  "scroll_direction": "up" | "down" or null,
  "scroll_amount_px": integer or null,
  "message_to_user": string or null,
  "reasoning": string
}

Use "done" when the task_goal has been achieved. Use "ask_user" if you need clarification that cannot be inferred from the sanitized screen (do not use it to ask for sensitive data).`;

class GeminiVLMClient {
  constructor() {
    if (!settings.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set. Put it in a .env file or environment variable.');
    }
    this.ai = new GoogleGenAI({ apiKey: settings.GEMINI_API_KEY });
  }

  async getNextAction({ task_goal, elements, redaction_manifest, history, image_b64, image_media_type }) {
    const userPromptText =
      `TASK GOAL: ${task_goal}\n\n` +
      `SANITIZED SCREEN ELEMENTS (JSON):\n${JSON.stringify(elements, null, 2)}\n\n` +
      `REDACTION MANIFEST (element_id -> redaction_type):\n${JSON.stringify(redaction_manifest || {}, null, 2)}\n\n` +
      `Return ONLY the JSON action object described in the system prompt.`;

    const contents = [];
    if (history && history.length > 0) {
      for (const turn of history) {
        if (turn.role && turn.content) {
          const role = turn.role === 'user' ? 'user' : 'model';
          contents.push({ role, parts: [{ text: String(turn.content) }] });
        }
      }
    }

    const currentParts = [{ text: userPromptText }];

    if (image_b64) {
      currentParts.push({
        inlineData: {
          mimeType: image_media_type || 'image/png',
          data: image_b64,
        },
      });
    }

    contents.push({ role: 'user', parts: currentParts });

    const t0 = Date.now();
    let response;
    try {
      response = await this.ai.models.generateContent({
        model: settings.VLM_MODEL,
        contents: contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          maxOutputTokens: settings.MAX_TOKENS,
          responseMimeType: 'application/json',
        },
      });
    } catch (err) {
      throw new Error(`VLM API call failed: ${err.message}`);
    }

    const latencyMs = Date.now() - t0;
    const rawText = response.text || '';
    const actionDict = this._parseJsonAction(rawText);
    actionDict._latency_ms = latencyMs;
    actionDict._raw_text = rawText;
    return actionDict;
  }

  _parseJsonAction(rawText) {
    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {}
      }
      throw new Error(`Model did not return valid JSON action: ${rawText.slice(0, 300)}`);
    }
  }
}

const vlmClient = new GeminiVLMClient();

module.exports = {
  GeminiVLMClient,
  vlmClient,
};
