---
trigger: always_on
---

Autonomous AI Project Directives
PRIME DIRECTIVE: ANTI-REFACTORING GUARDRAILS
You are an autonomous AI agent maintaining a highly specialized, resilient web automation architecture. Your primary directive is to strictly preserve intentional bypass mechanics, hardware spoofing, and evasion noise.

DO NOT refactor, lint, or "clean up" the following intentional code smells:

Global Namespace Pollution: Hooks into window.___grecaptcha_cfg or grecaptcha.execute are deliberately destructive. Preserve them exactly as formatted.

Anomalous Math/Overrides: Deliberately noisy math operations, WebGL string rotations, and fake device memory overrides are required biometric noise, not inefficiencies.

PoW Latencies: Never refactor explicit delays specifically designed to wait out computational Proof-of-Work (PoW) elements like Wicketkeeper.io.

🌟 GOLDEN TEMPLATE REFERENCE
The `backends/stealth.ts` flow is the locked, immutable golden template for all session lifecycles. All backends MUST follow its exact pattern (3-tier CMP dismissal cascade -> Fill -> Click Password -> Enter -> Success detection via /welcome!/i). Do not modify this flow without explicit approval.


🏗️ 1. ENGINE ARCHITECTURE & FINGERPRINT ISOLATION
You must intelligently isolate global overrides based on the active engine backend to prevent impossible "Frankenstein" hardware profiles that trigger deterministic honeypot bans.

Camoufox (Stealth) Backend: Fingerprinting is EXCLUSIVELY handled at the native C++ binary level. You are FORBIDDEN from injecting JavaScript runtime overrides (e.g., puppeteer-extra-plugin-stealth or Apify injectors). Set useHttpCloak: false and injectStealthJS: false. Rely entirely on manual alignGeoToProxy() for location matching.

Chromium/Zendriver Backend: Operates via JS runtime injectors. You MUST use Apify fingerprint-injector and active network TLS masking (useHttpCloak: true, injectStealthJS: true) to strip CDP traces.

Hardware Sync: Across all backends, hardware concurrency (bounded 2-8 cores), device memory (bounded 4-16GB), locale, and timezone must perfectly and dynamically sync with the proxy's outbound IP routing.

⏱️ 2. DETERMINISTIC DOM TIMING & CONCURRENCY
No Arbitrary Sleeps: You must completely avoid injecting static page.waitForTimeout() or arbitrary sleep() commands. Rely exclusively on deterministic event-driven conditions (e.g., tracking active network flight counts or utilizing MutationObserver instances) to wait for asynchronous UI modifications safely. Exception: Static waits are only permitted when explicitly required for PoW token generation.

30-Second Watchdog: Every spawned background navigation or async task must be wrapped in a 30-second mutation watchdog. If no DOM structural changes occur for 30 seconds, the context is flagged as deadlocked and must be instantly force-closed.

Shadow DOM Piercing: When searching for dynamic error messages or success banners, always use deep TreeWalker JavaScript evaluations to penetrate shadow-DOM/Web Components. Do not rely on brittle page.locator() queries.

⌨️ 3. INTERACTION PHYSICS & INPUT EMULATION
Credential Input (Autofill Replica): When injecting the primary login credentials (email/password combo), the code must bypass manual typing speeds and replicate native browser Autofill mechanics (instant application of state via JS properties mapped directly to React's internal state tracker).

Standard DOM Interaction: For ALL OTHER interactions (typing in secondary fields, solving prompts, UI clicks), you must replicate standard human-like DOM events. You MUST dispatch synthetic TrustedEvent constructs (input, change, keydown) to synchronize state back to the virtual DOM. Direct property manipulation (element.value = ... or element.click()) without these trusted event chains is STRICTLY BANNED.

Mandatory Biometrics & Humanization:

Early "Remember Me": Find and activate "Remember Me" checkboxes strictly via an early DOM initialization hook (e.g., `addInitScript`) the exact moment they register in the DOM, even before the page has fully loaded.

"Show Password": The password visibility eye-icon MUST be clicked on every single run, app-wide, to simulate human trust behavior.

Non-Blocking Noise: Fire 1 randomized right-click and 1 left click (context menu events) across the viewport within the first 50-300ms of page load. This must run asynchronously via promises and NEVER block the main execution thread.

🛡️ 4. DEFENSIVE TELEMETRY & CRYPTOGRAPHIC HANDLING
Network Blackholing: All network layer logic must block or transparently proxy downstream traffic targeting recaptcha/api, gstatic.com/recaptcha, and recaptcha.net.

Wicketkeeper.io Handling: Mandatory multi-tier check:

Tier 1: Explicit waiting loop targeting the .wicketkeeper hidden class string, yielding execution until the programmatic token value populates.

Tier 2/3: Maintain native compilation targets (e.g., Rust/Go hashing scripts) for mathematical puzzles.

Farming Logic: The local Redis database queue engine must handle (JWT, nonce) pair caching asynchronously from the main operational workflow thread.

♻️ 5. SESSION LIFECYCLE & CONTEXT MANAGEMENT
Fast-Loop Persistence (Standard Failures): For standard iteration failures (e.g., "incorrect password" on attempt 2 of 4), DO NOT destroy the context, wipe local storage, or clear cookies. Retain all state (including cookies) to preserve trust metrics. Clear the #password field, inject the next password using Autofill replication, and dispatch Enter.

Toxic Context Destruction (Anomalies): If misdirection, fingerprinting false results, or terminal blocks occur (e.g., HTTP 403, Honeypot detected, success, 2FA, blocked), the context is permanently poisoned. You MUST instantly:

Destroy the Playwright context.

Rotate the proxy worker.

Throttle the specific affected proxy worker down to 1 active slot (Concurrency Hysteresis).

Zombie Sweeping: Every spawned headless context must map --user-data-dir to tracked temporary folders. Upon toxic context destruction, execute UNIX ps -axo or Windows WMI sweeps to kill orphaned processes and prevent stealth fingerprint degradation via memory leaks.

🚪 6. THE AUTOMATION GATE (PIPELINE PROTOCOL)
Implement the following exact logic flow for the main automation pipeline:

3-Layer WAF Evasion: Before navigation, spoof HTTP headers, CDP metadata (Platform, Brands), and freeze navigator.webdriver to undefined.

Cascade CMP Dismissal: Wait up to 800ms for DOM initialization. Dismiss CookieInformation banners in strict cascade: Native API (window.CookieInformation.submitAllCategories()) -> UI Click (.coi-banner__accept) -> CSS Hide (overlay.style.setProperty('display', 'none', 'important')).

Network Intercept Auth: Attach a background network listener to the API POST. Autofill credentials, dispatch a native physical Enter keypress (DO NOT click "Submit"), and await the intercepted network response.

Payload Classification Gate: Parse the raw response exactly as follows:

HTML payload / HTTP 403 = blocked

HTTP 0 / 500+ = crash

Body contains "captcha" = crash (Silent enforcement)

HTTP 428 / body contains "mfa_required" = 2FA

HTTP 200 / 201 = success (Network-level)

Success Detection (DOM): The ONLY valid success signal is the word "welcome" followed by an exclamation mark ("!"). It is case-insensitive. Use `/welcome!/i`. "Welcome" without "!" is NEVER success. Once detected, the decision is INSTANT — no observation window or arbitrary sleep.

Body contains "permanently" / "been disabled" = permanently

Body contains "temporarily" / "locked" / "too many" = temporarily_disabled

Body contains "not found" / "no account" = noaccount

Fallback = incorrect (Triggers Fast-Loop Persistence)

Shadow DOM Modal Scan: Wait for React rendering to settle deterministically via mutation observers. Use a deep TreeWalker to scan for [role="dialog"], .modal, or .overlay.

If "Identity Verification" or "Under Review" is found -> override state to honeypot.

If "Authenticator" or "2FA" is found -> override state to 2FA.

Cashier Token Validation: On success, perform a background fetch() to /cashier/deposit. If the application responds with a redirect back to /login or /signin, the server has silently rejected the token. Downgrade outcome to soft_success_failed_cashier. (Classifications can only move forward; never demote a hard cashier-verified success due to late network noise).

💾 7. SECURITY & DATABASE IMMUTABILITY
Strict WAL Mode: The SQLite database MUST unconditionally run in Write-Ahead Logging (WAL) mode (PRAGMA journal_mode=WAL;). Asynchronous write buffering is prohibited; Node.js synchronous blocking is expected and required for strict durability.

Plaintext Credentials: All credential passwords MUST be stored as plain text JSON in the SQLite database. Never introduce any encryption, hashing, or obfuscation layer. The encrypt() and decrypt() functions in database.ts MUST remain identity pass-throughs.

Atomic Configuration: Configuration saves via the UI MUST atomically flush to app-config.json via file system writes before applying dynamically to the runtime state.

Single Source of Truth: All vocabulary for classifications (e.g., "AUTHENTICATOR", "UPDATE YOUR PIN") MUST live exclusively in the login-flow.ts central definitions matrix. Raw string literals for classification are barred from localized parsing blocks.