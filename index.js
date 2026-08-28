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

// System prompt — output ONLY the action JSON, nothing else
const SYSTEM_PROMPT = `You are a browser assistant. You receive a screenshot and a DOM snapshot of interactive elements on the page. Analyze both and return the next action the user should take as JSON.

Return ONLY this JSON format:
{"action":{"type":"<type>","target":"<target_or_null>","value":"<value_or_null>"}}

Action types: click, scroll, fill, wait, navigate, none.
- click: target = button/link label.
- scroll: target = "down", "up", or section name.
- fill: target = field name/label, value = what to enter (or null if unknown).
- wait: target = null, value = null.
- navigate: target = link/section name.
- none: target = null, value = null.

The DOM snapshot shows input fields with their current values, buttons, links, selects, and headings. Use this to understand what fields are filled or empty.
Ignore blacked-out redacted areas in the screenshot. Be specific with button/field names from the DOM.`;

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

        // Build user message content
        const userContent = [
            {
                type: "text",
                text: dom
                    ? `What action should I take on this page?\n\nDOM snapshot:\n${dom}`
                    : "What action should I take on this page?"
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
            temperature: 0.2
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
