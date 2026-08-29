require("dotenv").config();
const express = require("express");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

// Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Parse large JSON payloads (base64 screenshots can be several MB)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// CORS — allow requests from the Chrome extension
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// Health check
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// System prompt — precise decision hierarchy for browser action recommendations
const SYSTEM_PROMPT = `You are an expert autonomous browser AI assistant. You analyze a webpage screenshot and a structured DOM snapshot of interactive elements to determine the single next logical action the user should take.

CRITICAL RULES & DOM PARSING:
1. PRIVACY REDACTIONS: Blacked-out / solid black rectangles on the screenshot are redacted areas where sensitive user data (passwords, emails, phone numbers, identity numbers, names) has ALREADY been filled in by the user and protected on-device.
2. DOM STATE [filled] vs [empty]:
   - [filled]: The user has ALREADY entered data into this field. DO NOT ask the user to fill it again.
   - [empty]: The field currently has no value and is awaiting user input.

STRICT ACTION SELECTION PRIORITY:

Priority 1: FORM COMPLETION -> "click" SUBMIT / ACTION BUTTON
- If all interactive/required input fields are [filled] , the form is READY to be submitted.
- Your action MUST BE "click".
- Set "target" to the exact label/text of the submit or primary action button (e.g., "Submit", "Log In", "Sign In", "Continue", "Next", "Register", "Create Account", "Search", "Save", "Pay", "Proceed", "Confirm", "Done", "Checkout").
- Set "value" to null.
- CRITICAL: DO NOT return "fill" if all relevant form fields are already [filled]!

Priority 2: UNFILLED INPUT FIELDS -> "fill"
- If there are empty required or necessary input fields marked [empty], select the first empty field to fill.
- Your action MUST BE "fill".
- Set "target" to the label, placeholder, or name of that empty field.
- Set "value" to a suggested value (if obvious from context) or null.

Priority 3: SEARCH FORMS -> "click" SEARCH
- If a search input is [filled] and there is a Search / Submit button or icon, return "click" targeting that button.

Priority 4: DIALOGS / POPUPS / COOKIE BANNERS -> "click"
- If a modal or cookie consent banner is blocking the page, return "click" with target matching "Accept", "Agree", "Confirm", or "Close".

Priority 5: SCROLLING
- If content or the submit button is cut off below/above the viewport, return "scroll" with target = "down" or "up".

Priority 6: NO ACTION NEEDED -> "none"
- If the workflow on this page is finished or no action is possible, return "none".

OUTPUT FORMAT:
Return ONLY valid JSON matching this schema:
{"action":{"type":"click"|"fill"|"scroll"|"wait"|"navigate"|"none","target":"<button text, field label, or null>","value":"<text to fill or null>"}}

EXAMPLES:
- When all fields are filled:
  DOM: <input type="text" name="email" [filled]/> <input type="password" name="password" [filled]/> <button>Sign In</button>
  Response: {"action":{"type":"click","target":"Sign In","value":null}}

- When a field is empty:
  DOM: <input type="text" name="name" [empty] placeholder="Full Name"/> <button>Submit</button>
  Response: {"action":{"type":"fill","target":"Full Name","value":null}}

- When search query is entered:
  DOM: <input type="text" name="q" [filled] placeholder="Search"/> <button>Search</button>
  Response: {"action":{"type":"click","target":"Search","value":null}}`;

/**
 * POST /api/analyze
 * Body: { image: "data:image/png;base64,...", dom: "<input .../>\\n<button>..." }
 * Returns: { success: true, action: { type, target, value } }
 */
app.post("/api/analyze", async (req, res) => {
    try {
        const { image, dom } = req.body;

        if (!image) {
            return res.status(400).json({ success: false, error: "No image data provided" });
        }

        console.log("[Server] Received image + DOM for analysis, forwarding to Groq...");
        if (dom) console.log("[Server] DOM snapshot:\n", dom.substring(0, 500));

        // Build user message content with clear instruction
        const userPromptText = dom
            ? `Determine the next user action based on the DOM snapshot and screenshot.\n\nDOM SNAPSHOT:\n${dom}\n\nIMPORTANT RULE: If the input fields in the DOM are [filled] , DO NOT ask to fill them. Instead, return a "click" action for the primary submit/continue/action button.`
            : `Determine the next user action on this page. If fields are already filled or redacted, return "click" for the submit button.`;

        const userContent = [
            {
                type: "text",
                text: userPromptText
            },
            {
                type: "image_url",
                image_url: { url: image }
            }
        ];

        const chatCompletion = await groq.chat.completions.create({
            model: "qwen/qwen3.6-27b",
            reasoning_effort: "none",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT
                },
                {
                    role: "user",
                    content: userContent
                }
            ],
            max_tokens: 256,
            temperature: 0.1
        });

        let rawContent = chatCompletion.choices?.[0]?.message?.content || "";
        console.log("[Server] Groq raw response:", rawContent);

        // Strip <think>...</think> tags just in case
        rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

        // Parse JSON
        let action;
        try {
            const parsed = JSON.parse(rawContent);
            action = parsed.action || parsed;
        } catch (parseErr) {
            console.warn("[Server] LLM did not return valid JSON, using fallback.");
            action = { type: "none", target: null, value: null };
        }

        console.log("[Server] Action:", JSON.stringify(action));
        res.json({ success: true, action });
    } catch (error) {
        console.error("[Server] Groq API error:", error.message || error);
        res.status(500).json({
            success: false,
            error: "Failed to analyze image",
            details: error.message || String(error)
        });
    }
});

app.listen(PORT, () => {
    console.log(`[Server] Privacy Agent server running on http://localhost:${PORT}`);
});
