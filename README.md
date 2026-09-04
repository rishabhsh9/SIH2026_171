# Privacy Agent — SIH 2026

**Problem Statement:** SIH 2026 — *On-device Visual Perception for Light-weight Browser Agents*  
**Problem Statement ID:** 26171  
**Organization:** Indian Space Research Organisation (ISRO)

Privacy Agent is a Chrome Manifest V3 browser-extension prototype for privacy-preserving visual browser assistance. It captures the current browser viewport, performs sensitive-data detection locally, redacts detected regions, and sends the sanitized visual context together with a DOM snapshot to an AI backend for the next-action decision.

> **Important:** This repository is currently a perception + decision prototype. The server returns an action, but the current `background.js` stores the returned action rather than executing it automatically.

---

## 1. What the Project Does

The current pipeline is:

```text
Browser Page
    │
    ├── DOM inspection
    │       └── Detect sensitive form fields
    │
    ├── Screenshot capture
    │
    ▼
Local Privacy Processing
    │
    ├── Tesseract.js OCR
    │       └── Detect Indian PII / sensitive document patterns
    │
    ├── YOLOv8n Face Detection
    │       └── Detect faces locally
    │
    └── Canvas Redaction
            └── Black out detected regions
    │
    ▼
Sanitized Screenshot + DOM Snapshot
    │
    ▼
Browser Background Service Worker
    │
    ▼
POST /api/analyze
    │
    ▼
Groq / Qwen Vision Model
    │
    └── Returns structured next action
            { type, target, value }
    │
    ▼
Extension stores the action/result
```

The privacy boundary is intended to ensure that the screenshot sent to the AI backend is the **redacted/sanitized image**, rather than the original screenshot.

---

## 2. Main Features

### Local visual privacy processing

- Screenshot capture through the Chrome extension background service worker.
- OCR using **Tesseract.js**.
- Local Indian sensitive-data detection using OCR text and regular expressions.
- Local **YOLOv8n-face ONNX** inference for face detection.
- Canvas-based black-box redaction of detected sensitive regions.

### DOM-based sensitive-field detection

The content script inspects page inputs and related metadata and can identify categories including:

- Password
- Email
- Phone
- Credit/debit card
- Aadhaar
- PAN
- Passport
- Voter ID
- Driving licence
- Date of birth
- Address
- PIN/postal code

DOM metadata such as `type`, `name`, `id`, `placeholder`, `autocomplete`, ARIA attributes and related attributes are used as detection signals.

### DOM snapshot

The extension also collects a structured representation of the page containing information such as:

- Input fields
- Textareas
- Select elements
- Buttons
- Links
- Headings
- Filled/empty field state

This DOM context is sent alongside the sanitized screenshot so the server-side model can reason about the page.

### Vision-based action decision

The backend sends the sanitized screenshot and DOM snapshot to a Groq-hosted Qwen vision model and requests a structured action:

```json
{
  "action": {
    "type": "click",
    "target": "Submit",
    "value": null
  }
}
```

Supported action types in the backend prompt are:

```text
click
fill
scroll
wait
navigate
none
```

---

## 3. Project Structure

```text
SIH2026_171-Abhijeet/
│
├── manifest.json
├── background.js
├── content.js
├── ocr.js
├── yolo.js
├── offscreen.html
├── offscreen.js
│
├── popup.html
├── popup.js
├── css/
│   └── style.css
│
├── models/
│   └── yolov8n-face.onnx
│
├── tessdata/
│   └── eng.traineddata
│
├── assets/
│   └── gopya_logo_lockup_exact.png
│
├── eng.traineddata
│
├── package.json
├── package-lock.json
├── index.js
│
└── server2/
    ├── index.js
    ├── package.json
    └── package-lock.json
```

---

## 4. Role of Each Important File

### `manifest.json`

Defines the Chrome Manifest V3 extension.

It configures:

- Extension permissions
- Background service worker
- Popup
- Content scripts
- Web-accessible model/OCR assets
- WASM execution support
- Host permissions

The current manifest is configured for the local backend at:

```text
http://localhost:3000/*
```

---

### `content.js`

Runs in the webpage context.

Its main responsibilities are:

1. Inspect the DOM.
2. Detect sensitive form fields.
3. Request a screenshot from the background service worker.
4. Trigger the local OCR/face-detection scan.
5. Merge DOM and visual detections.
6. Redact detected regions.
7. Send the sanitized image and DOM snapshot for analysis.

---

### `background.js`

Runs as the Manifest V3 service worker.

It handles:

- Screenshot capture using `chrome.tabs.captureVisibleTab`
- Communication with the offscreen document
- OCR job management
- Requests to `/api/analyze`
- Storing the latest action and scan state in `chrome.storage.local`

The backend request is currently:

```text
POST http://localhost:3000/api/analyze
```

---

### `offscreen.js`

Provides an offscreen execution environment for the local OCR pipeline.

It performs:

1. Image preparation/downscaling.
2. Tesseract OCR.
3. OCR-based sensitive-data detection.
4. Rotated OCR passes for vertical content.
5. YOLOv8 face detection.
6. Collection of all detected entities.
7. Return of detection results to `background.js`.

---

### `ocr.js`

Contains the browser-side image redaction functionality.

The detected bounding boxes are drawn over the screenshot and the sensitive regions are blacked out before the sanitized image is passed onward.

---

### `yolo.js`

Loads and runs the local YOLOv8 face-detection ONNX model using ONNX Runtime Web.

The model file is:

```text
models/yolov8n-face.onnx
```

Inference therefore happens locally in the browser rather than through the backend.

---

### `popup.html` / `popup.js`

Provide the extension popup interface for displaying the current scan/analysis state and related results.

---

### `index.js`

A Node/Express backend implementation that exposes:

```text
POST /api/analyze
GET  /health
```

It receives the sanitized screenshot and DOM snapshot and forwards them to Groq.

---

### `server2/index.js`

Contains another backend implementation with a more explicit browser-agent decision hierarchy.

Its system prompt prioritizes:

1. Submit/action button when required fields are already filled.
2. Empty required fields.
3. Search actions.
4. Dialog/cookie interactions.
5. Scrolling.
6. No action.

It also exposes:

```text
GET  /health
POST /api/analyze
```

---

## 5. Backend API

### `POST /api/analyze`

Request body:

```json
{
  "image": "data:image/png;base64,...",
  "dom": "<DOM snapshot>"
}
```

The backend sends both pieces of information to the vision model.

### Response

Successful responses follow this general structure:

```json
{
  "success": true,
  "action": {
    "type": "click",
    "target": "Submit",
    "value": null
  }
}
```

If the model output cannot be parsed as JSON, the backend falls back to:

```json
{
  "type": "none",
  "target": null,
  "value": null
}
```

---

## 6. Requirements

### Browser

- Google Chrome or another Chromium-based browser supporting Manifest V3.

### Node.js

- Node.js with npm.

### Backend

The backend requires:

```text
GROQ_API_KEY
```

The API key must be supplied through an environment variable.

---

## 7. Installation

### Step 1 — Install extension dependencies

From the project root:

```bash
npm install
```

### Step 2 — Configure the backend

Go to:

```text
server2/
```

Create a `.env` file:

```env
GROQ_API_KEY=your_groq_api_key
```

### Step 3 — Install backend dependencies

```bash
cd server2
npm install
```

### Step 4 — Start the backend

```bash
npm run start
```

The server listens on:

```text
http://localhost:3000
```

Health check:

```text
GET /health
```

---

## 8. Load the Extension

1. Open Chrome.
2. Navigate to:

```text
chrome://extensions
```

3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the project directory:

```text
SIH2026_171-Abhijeet/
```

6. Open the extension popup and test it on a webpage.

---

## 9. Privacy Processing

The intended privacy flow is:

```text
Original Screenshot
       │
       ▼
Local Detection
       │
       ├── OCR → PII/document detection
       │
       ├── YOLO → face detection
       │
       └── DOM → sensitive field detection
       │
       ▼
Bounding Boxes
       │
       ▼
Canvas Redaction
       │
       ▼
Sanitized Screenshot
       │
       ▼
Backend / Vision Model
```

Examples of data intended to be protected include:

- Password fields
- Email addresses
- Phone numbers
- Aadhaar numbers
- PAN numbers
- Passport numbers
- Voter IDs
- Driving-licence identifiers
- Payment-card information
- Faces

---

## 10. Why Both DOM and Vision Are Used

The project uses two complementary sources of browser context.

### DOM

DOM inspection provides semantic information such as:

```text
<input type="password">
<button>Submit</button>
<input placeholder="Email">
```

This can identify sensitive fields even when OCR cannot recognize their contents.

### Vision

The screenshot provides visual context that DOM inspection cannot fully represent:

- Page layout
- Images
- Visual buttons
- Faces
- Position of elements
- Content rendered visually
- Elements whose semantic DOM information is insufficient

The combination gives the backend model both **visual context** and **structured page context**.

---

## 11. Current Action Decision Flow

The backend asks the vision model to determine the next action from the sanitized screenshot and DOM snapshot.

Example:

```text
Screenshot:
    [redacted email]
    [redacted password]
    [ Sign In ]

DOM:
    email    [filled]
    password [filled]
    button   Sign In

                ↓

Vision/LLM decision

                ↓

{
  "action": {
    "type": "click",
    "target": "Sign In",
    "value": null
  }
}
```

The current prototype **returns and stores this action**. It does not yet contain the complete browser-side Observe → Act → Observe execution loop.

---

## 12. Current Architecture Status

### Implemented

- [x] Chrome MV3 extension
- [x] Screenshot capture
- [x] DOM inspection
- [x] Sensitive DOM-field detection
- [x] Local Tesseract OCR
- [x] Indian PII/document regex detection
- [x] Local YOLOv8 face detection
- [x] Bounding-box based visual redaction
- [x] Sanitized screenshot generation
- [x] DOM + sanitized image transmission
- [x] Groq/Qwen vision analysis
- [x] Structured action response
- [x] Local storage of analysis state

### Not fully implemented in this snapshot

- [ ] Automatic execution of returned `click` / `fill` / `scroll` actions
- [ ] Complete Observe → Act → Observe autonomous loop
- [ ] Robust action-result verification
- [ ] Automatic recovery/re-planning after a failed action
- [ ] Full multi-step task orchestration
- [ ] Comprehensive benchmark/evaluation harness
- [ ] Production deployment configuration

---

## 13. Known Limitations

### Backend dependency

The current architecture relies on the Groq API for the reasoning/vision stage. Local privacy detection is separate from the server-side reasoning stage.

### Action execution

The backend returns an action, but the current extension does not yet execute that action automatically.

Therefore the current flow is closer to:

```text
OBSERVE
   ↓
LOCAL PRIVACY PROCESSING
   ↓
ANALYZE
   ↓
RETURN ACTION
```

rather than a complete:

```text
OBSERVE
   ↓
UNDERSTAND
   ↓
PLAN
   ↓
ACT
   ↓
OBSERVE CHANGE
   ↓
VERIFY
   ↓
CONTINUE / RECOVER / COMPLETE
```

### Detection accuracy

OCR and regex detection are heuristic. They can produce false positives or miss sensitive information that does not match the implemented patterns.

### Browser compatibility

The current project is primarily structured around Chrome Manifest V3 APIs and has not been presented as a production-ready cross-browser implementation.

---

## 14. Relation to SIH Problem Statement 26171

The SIH problem statement asks for a privacy-preserving browser agent in which visual context is processed locally and sensitive/PII information is sanitized before visual context is sent to a server.

This prototype addresses those requirements through:

```text
Local browser screenshot
        +
Local DOM inspection
        +
Local OCR
        +
Local face detection
        +
Local redaction
        ↓
Sanitized visual context
        ↓
Server-side vision reasoning
        ↓
Structured browser action
```

The remaining major architectural gap is the browser-side action executor and the resulting closed-loop agent behavior.

---

## 15. Development Notes

The root `package.json` currently contains dependencies for:

- `onnxruntime-web`
- `tesseract.js`
- `@napi-rs/canvas`

The backend has its own dependency environment under:

```text
server2/
```

with:

- `express`
- `dotenv`
- `groq-sdk`

The root `package.json` currently does **not** define a `start` script. The backend `server2/package.json` does define:

```json
"scripts": {
  "start": "node index.js"
}
```

Therefore the backend should be started from `server2/`.

---

## 16. Security Note

Do not commit `.env` files or API keys to Git.

Recommended `.gitignore` entries:

```gitignore
.env
node_modules/
```

API credentials should remain local to the development/deployment environment.

---

## 17. Project Goal

The long-term goal of Privacy Agent is to evolve from a privacy-aware visual analyzer into a lightweight browser agent:

```text
User Goal
   ↓
Observe Page
   ↓
Detect + Redact Sensitive Data Locally
   ↓
Understand Sanitized Page
   ↓
Choose Action
   ↓
Execute Action Locally
   ↓
Observe Result
   ↓
Verify
   ↓
Continue / Recover / Finish
```

The privacy boundary remains local to the browser, while heavier visual reasoning can be delegated to a server using only sanitized context.
