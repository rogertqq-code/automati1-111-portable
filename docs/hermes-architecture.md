# Hermes Architectural Blueprint: The Autonomous Overseer

The Hermes Engine (`hermes-review.ts`) serves as the central intelligence and autonomous orchestrator for the automation infrastructure. It has evolved from a simple anomaly detection service into a full-stack, God-mode administrator. 

This document outlines Hermes's expanded capabilities, the iOS Command API, the OpsOrchestrator Sandbox, and how the core "Intelligence Ceiling" scales infinitely.

---

## 1. The Core Goal Injection Loop

Hermes's decision-making is driven by a `coreGoal` parameter. This parameter is the highest-priority directive fed into the Gemini 2.5 Flash self-improvement prompt every 10 minutes.

- **Current Default Goal**: 
  > "Ensure that all queued credentials are tested until and results marked accurately, and all the while the apps efficiency and backends are rotated when fingerprinted, and code is fixed when broken, and zombie windows are killed, and hermes intelligence and skills are increasing and adding always, and his understanding and reasoning of the app until the point there is no credentials left to test. Hermes is to follow instructions from the app websocket and also report issues when needing clarification. Hermes is to be seeking to always add and refine skills, and rollback changes if regression is detected, and refine and tinker until it has 100% coverage of the orchestration."

- **Infinite Scalability**: Because the goal is injected directly into the LLM context (`YOUR CORE GOAL (Highest Priority): {coreGoal}`), Hermes's logic is never hardcoded. If you change the goal via the iOS app, Hermes instantly pivots its entire architectural strategy.

---

## 2. iOS WebSocket Command Bridge

Hermes natively listens for commands dispatched through the `server.ts` WebSocket layer (authenticated via `MOBILE_API_KEY`). This allows iOS apps or remote dashboards to puppet Hermes in real time.

### Available Commands:
Commands are sent as JSON payloads to `ws://server:3011`.

#### `set_goal`
Dynamically overrides Hermes's Core Goal on the fly.
```json
{
  "type": "hermes-command",
  "action": "set_goal",
  "goal": "Focus entirely on purging stuck proxy pools and reducing latency."
}
```

#### `force_cycle`
Bypasses the standard 10-minute AI loop timer. Forces Hermes to immediately read server telemetry, gather DOM failure patterns, and execute a Gemini reasoning cycle.
```json
{
  "type": "hermes-command",
  "action": "force_cycle"
}
```

#### `inject_ops_skill`
God-mode override. The iOS app can push a raw Node.js script string directly into the `OpsOrchestrator` sandbox for immediate execution on the server.
```json
{
  "type": "hermes-command",
  "action": "inject_ops_skill",
  "script": "console.log('Manually clearing redis cache...'); process.exit(0);"
}
```

---

## 3. The OpsOrchestrator Sandbox

Hermes is no longer restricted to generating client-side JavaScript patches for Playwright `page.evaluate()`. It can now write and execute server-side Node.js maintenance scripts ("OpsSkills").

### How it Works:
1. **Telemetry Ingestion**: Every 10 minutes, Hermes reads `process.memoryUsage()` and process uptimes.
2. **Generation**: If Hermes detects server degradation (e.g., RSS memory exceeding 2000MB, indicating a leak), the AI will output a JSON payload containing an `ops-skill` script.
3. **Execution**: The `OpsOrchestrator` (`ops-orchestrator.ts`) takes the script, wraps it in a safety try/catch block, and executes it via a spawned child `node` process (to ensure the main server thread never crashes).
4. **The Infinite Learning Loop**: The `OpsOrchestrator` captures the `stdout`, `stderr`, and crash status of the executed script. These outcomes are pushed to `opsSkillOutcomes` in Hermes's memory. On the *next* 10-minute cycle, Hermes reads its own crash logs and writes patched versions of its failing scripts, continuously improving until the script succeeds.

---

## 4. Multi-Mode Integrity & Security

While Hermes has infinite generation potential, the core automation pipeline is heavily guarded to prevent AI hallucinations from destroying the fingerprinting architecture.

- **`resolveBackendSettings()`**: All backend execution profiles (Stealth, Zendriver, Camoufox) strictly route through `resolveBackendSettings()` in `backends/profiles/index.ts`. 
- **Enforcement**: If Hermes generates a flawed configuration (e.g., attempting to inject JavaScript fingerprinting into the Camoufox backend, which relies purely on C++ binary fingerprinting), `resolveBackendSettings()` will silently intercept and correct the configuration to match the mode's architectural constraints before the browser ever launches.
- **Fail-Safe**: This guarantees that no matter how aggressive Hermes's strategy becomes, it can never accidentally uncloak the browser and burn the proxy pool.
