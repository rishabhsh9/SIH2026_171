/**
 * server.js
 * Express Server for Privacy-Preserving Vision Agent.
 */

const express = require('express');
const cors = require('cors');
const { settings } = require('./config');
const {
  ScreenContextSchema,
  SessionStartRequestSchema,
  SessionEndRequestSchema,
} = require('./models');
const { sessionStore } = require('./sessionStore');
const { scanScreenContext, redactForLogging } = require('./privacyGuard');
const { vlmClient } = require('./vlmClient');
const { validateAction } = require('./actionValidator');

const app = express();

app.use(cors({ origin: settings.ALLOWED_ORIGINS }));
app.use(express.json({ limit: '10mb' }));

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: settings.VLM_MODEL, server: 'Node.js Express' });
});

// Start session
app.post('/session/start', (req, res) => {
  const parseResult = SessionStartRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ detail: parseResult.error.message });
  }

  const { task_goal, user_id } = parseResult.data;
  const sessionId = sessionStore.create(task_goal, user_id);
  console.log(`[session/start] created session=${sessionId} goal='${task_goal.slice(0, 80)}'`);
  res.json({ session_id: sessionId });
});

// End session
app.post('/session/end', (req, res) => {
  const parseResult = SessionEndRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ detail: parseResult.error.message });
  }

  const { session_id } = parseResult.data;
  const removed = sessionStore.end(session_id);
  if (!removed) {
    return res.status(404).json({ detail: 'session_id not found' });
  }

  console.log(`[session/end] closed session=${session_id}`);
  res.json({ status: 'ended', session_id });
});

// Analyze context
app.post('/context/analyze', async (req, res) => {
  const t0 = Date.now();

  const parseResult = ScreenContextSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ detail: parseResult.error.message });
  }

  const ctx = parseResult.data;

  if (!sessionStore.exists(ctx.session_id)) {
    return res
      .status(404)
      .json({ detail: 'Unknown or expired session_id. Call /session/start first.' });
  }

  // --- Defense-in-depth PII guard ---
  const findings = scanScreenContext(ctx.elements);
  if (findings.length > 0) {
    const safeLog = redactForLogging(ctx);
    console.warn(`[privacy_guard] possible unredacted PII detected, rejecting request.`, safeLog);
    return res.status(422).json({
      detail:
        `Request rejected: possible unredacted PII detected in ${findings.length} field(s). ` +
        `Ensure client-side redaction ran before sending.`,
    });
  }

  console.log(`[context/analyze] session=${ctx.session_id} payload=`, redactForLogging(ctx));

  const knownIds = new Set(ctx.elements.map((el) => el.id));
  const history = sessionStore.getHistory(ctx.session_id);

  // --- Call VLM ---
  let rawAction;
  try {
    rawAction = await vlmClient.getNextAction({
      task_goal: ctx.task_goal,
      elements: ctx.elements,
      redaction_manifest: ctx.redaction_manifest,
      history,
      image_b64: ctx.image_b64,
      image_media_type: ctx.image_media_type,
    });
  } catch (err) {
    console.error(`[context/analyze] VLM error: ${err.message}`);
    return res.status(502).json({ detail: `VLM backend error: ${err.message}` });
  }

  const latencyMs = rawAction._latency_ms || 0;
  const rawText = rawAction._raw_text || '';
  delete rawAction._latency_ms;
  delete rawAction._raw_text;

  // --- Validate Action ---
  let action;
  try {
    action = validateAction(rawAction, knownIds);
  } catch (err) {
    console.error(`[context/analyze] action validation failed: ${err.message}. raw='${rawText.slice(0, 300)}'`);
    return res.status(502).json({ detail: `Model produced an invalid action: ${err.message}` });
  }

  // --- Persist turn to session history ---
  sessionStore.appendTurn(ctx.session_id, 'user', `[screen context, ${ctx.elements.length} elements]`);
  sessionStore.appendTurn(ctx.session_id, 'assistant', rawText);

  const session = sessionStore.get(ctx.session_id);
  const turn = session ? session.turn : 0;
  const totalLatencyMs = Date.now() - t0;

  console.log(
    `[context/analyze] session=${ctx.session_id} turn=${turn} action=${action.action} ` +
      `vlm_latency_ms=${Math.round(latencyMs)} total_latency_ms=${totalLatencyMs}`
  );

  res.json({
    session_id: ctx.session_id,
    action,
    turn,
    latency_ms: totalLatencyMs,
  });
});

// Start listening
if (require.main === module) {
  app.listen(settings.PORT, settings.HOST, () => {
    console.log(`Privacy Vision Agent Node.js Server listening at http://${settings.HOST}:${settings.PORT}`);
  });
}

module.exports = app;
