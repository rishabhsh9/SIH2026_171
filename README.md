# Privacy-Preserving Vision Agent — Node.js Server

Node.js + Express server implementing the **server-side half** of the privacy-preserving browser vision agent using Google's official `@google/genai` Node SDK.

It receives an already-sanitized screen context from the browser client, reasons over it with Gemini (`gemini-2.5-flash`), and returns exactly one validated UI action.

## Features

- **Official Google Gen AI SDK (`@google/genai`)**: Built using Google's unified Node.js SDK.
- **Express.js API**: Lightweight async backend with endpoints `/session/start`, `/context/analyze`, `/session/end`, `/health`.
- **Defense in Depth (`privacyGuard.js`)**: Server-side PII regex guard that catches and rejects (`422`) any raw email/card/phone numbers that slip past client redaction.
- **Action Validation (`actionValidator.js`)**: Zod schema validation ensuring actions match white-listed schemas and valid target IDs.
- **Automated Test Suite (`testClient.js`)**: 5-scenario system test runner.

## Setup

```bash
cd vision-agent-server-node

# Install npm dependencies
npm install

# Configure environment variables
cp .env.example .env
# Set GEMINI_API_KEY=AIzaSy... in .env
```

## Run Server

```bash
# Start server (runs on http://localhost:8000)
npm start

# Or development mode with auto-reload (Node 18.11+)
npm run dev
```

## Run Test Suite

In a separate terminal window while server is running:

```bash
npm test
# OR
node testClient.js
```

## API Summary

- `POST /session/start` — Start a task session (`{ "task_goal": "..." }`)
- `POST /context/analyze` — Send sanitized screen context, get back next validated action
- `POST /session/end` — End task session
- `GET /health` — Health check endpoint
