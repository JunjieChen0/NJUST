# AGENTS.md

This file provides guidance to agents when working with code in this repository.

- Settings View Pattern: When working on `SettingsView`, inputs must bind to the local `cachedState`, NOT the live `useExtensionState()`. The `cachedState` acts as a buffer for user edits, isolating them from the `ContextProxy` source-of-truth until the user explicitly clicks "Save". Wiring inputs directly to the live state causes race conditions.

- Cloud Agent local mock: Run `node src/test-cloud-agent-mock.mjs` from the repo root, set `njust-ai-cj.cloudAgent.serverUrl` to `http://127.0.0.1:4000`, and use Cloud Agent mode in the extension. The mock exposes REST `GET /health` and `POST /v1/run` (what `CloudAgentClient` calls) and optional MCP at `POST /mcp`. Optional mock API key env: `CLOUD_AGENT_MOCK_API_KEY`.
