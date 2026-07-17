# Architecture Overview

This document outlines the core structural design of the Automation Engine.

## 1. The Automation Engine Boot Sequence

The engine operates as a 24/7 background daemon managed by PM2 (`ecosystem.config.cjs`). The entry point is `src/server/server.ts` which boots an Express web server, exposes health APIs, and initializes the WebSocket connection for the UI. However, the core execution loop and autonomous batch requeuing logic lives in `src/hermes/`, while the execution logic lives in `src/core/engine.ts`.

When a run is initiated via the dashboard (or locally via script):
1. **Database Check**: `getUntestedCredentials()` pulls the next credential batch.
2. **Profile Generation**: The 9-vector profile is synthesized (Geo, Hardware, Fonts, UA, etc.).
3. **Backend Resolution**: `resolveBackendSettings()` determines if this run should route to Cloak, Zendriver, Stealth, Spider-Cloud, or Spider-Local.
4. **Session Dispatch**: Execution drops into `backends/index.ts -> createSession()`.

## 2. The 5-Backend Routing Matrix

The engine is completely decoupled from the underlying browser automation library. It communicates entirely through an abstract `SessionHandle`.

1. **`cloak`**: Built on Playwright + `cloakbrowser`. Injects JS stealth scripts, routes traffic through `proxy-forwarder` (SOCKS5/HTTP), and masks TLS via `httpcloak`.
2. **`stealth`**: Built on `camoufox-js` (Native C++ stealth). **Strict Rule**: Never injects JS runtime stealth or uses `httpcloak`. Pure native fingerprinting.
3. **`zendriver`**: Built on a Python CDP wrapper. Uses Playwright's CDP connection to drive the browser. Overrides navigator properties natively via CDP. Uses `FingerprintInjector`.
4. **`spider-cloud`**: Routes the session to the remote Spider API over WebSocket.
5. **`spider-local`**: Uses the local Spider SDK to spin up a managed Chromium instance.

## 3. Database Architecture (Strict WAL Mode)

The database (`src/core/database.ts`) is a strict `better-sqlite3` implementation.

### Key Rules:
- **Write-Ahead Logging (WAL)**: `db.pragma('journal_mode = WAL')` ensures that all writes are instantly durable against application crashes without blocking reads.
- **Zero Encryption**: All passwords are stored as plain JSON strings. `encrypt()` and `decrypt()` functions are identity pass-throughs.
- **Single Source of Truth**: The `credential_status` table maintains the most recent outcome for every credential/target combination.
- **Atomic Configs**: The UI saves configuration to `app-config.json` using a strictly atomic `tmp` + `rename` pattern to prevent corruption on crash.

## 4. Zombie Process Management

Browser automation inevitably leaks processes. The system runs a rigorous cross-platform zombie sweeper (`src/services/process-cleaner.ts`).

- **Targeting**: It never blindly kills `chrome.exe`. It looks specifically for the `--user-data-dir` argument matching our temporary profile roots (`.cloak-profiles`, etc.).
- **Windows**: Uses PowerShell WMI querying to extract command lines and creation dates. Kills via `taskkill`.
- **Unix**: Uses `ps -axo` to extract PIDs and command lines. Graceful `SIGTERM` followed by a hard `SIGKILL` 5 seconds later.
- **Lifecycle**: Runs a pre-flight sweep on startup (`npm run clean:zombies`) and polls in the background every 30 seconds during test runs.
