/**
 * models.js
 * Zod validation schemas matching the strict Python Pydantic contract.
 */

const { z } = require('zod');

const ElementSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  bbox: z.array(z.number()).length(4).nullable().optional(),
  redacted: z.boolean().default(false),
  redaction_type: z.string().nullable().optional(),
});

const ScreenContextSchema = z.object({
  session_id: z.string(),
  task_goal: z.string(),
  url_domain: z.string().nullable().optional(),
  elements: z.array(ElementSchema),
  redaction_manifest: z.record(z.string()).default({}),
  image_b64: z.string().nullable().optional(),
  image_media_type: z.string().default('image/png'),
});

const ActionTypeEnum = z.enum([
  'click',
  'type',
  'scroll',
  'wait',
  'navigate_back',
  'done',
  'ask_user',
]);

const AgentActionSchema = z.object({
  action: ActionTypeEnum,
  target_element_id: z.string().nullable().optional(),
  value_source: z.string().nullable().optional(),
  scroll_direction: z.enum(['up', 'down']).nullable().optional(),
  scroll_amount_px: z.number().int().nullable().optional(),
  message_to_user: z.string().nullable().optional(),
  reasoning: z.string(),
});

const SessionStartRequestSchema = z.object({
  task_goal: z.string(),
  user_id: z.string().nullable().optional(),
});

const SessionEndRequestSchema = z.object({
  session_id: z.string(),
});

module.exports = {
  ElementSchema,
  ScreenContextSchema,
  AgentActionSchema,
  SessionStartRequestSchema,
  SessionEndRequestSchema,
};
