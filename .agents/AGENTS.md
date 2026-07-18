# Project Rules

## No Post-Success Observation Window (ABSOLUTE — NO EXCEPTIONS)

After a successful login is detected and the cashier page is navigated to, the automation must NEVER introduce any arbitrary delay (no 30s observation, no "keeping browser open" sleep, no static wait).

**The decision is instant and deterministic:** Navigate to the cashier URL. If the DOM settles on the cashier/deposit/account page → confirmed success. If the URL bounces back to /login or /signin → session invalid. Once the DOM settles on either outcome, the process exits immediately. No further delay.

This rule applies to ALL backends, ALL test harnesses, and ALL scripts in the project.

## Golden Template Lock (ABSOLUTE — NO EXCEPTIONS)

The file `.agents/references/golden-stealth-template.md` is the **frozen, immutable reference implementation** for all backend automation flows. It was locked after achieving 4/4 backend success on attempt 1 in the golden tile test.

**NEVER modify `backends/stealth.ts` session lifecycle logic without explicit user approval.** The stealth/Camoufox backend is the canonical reference that all other backends must follow. Any proposed change to the stealth session lifecycle, login flow sequence, or CMP dismissal cascade MUST be presented to the user for review before implementation.

All backends (cloak, spider-local, zendriver, stealth) MUST implement the same phases in the same order:
1. CMP Dismissal (3-tier cascade: API → Click → CSS Hide)
2. Credential Entry (Autofill replica via `.fill()`)
3. Password Field Re-focus (`.click()` before Enter)
4. Submit via `keyboard.press("Enter")` from the password field. If the enter key fails to register, fallback to a triple-click on the submit button.

## Mandatory CMP Dismissal (ABSOLUTE — NO EXCEPTIONS)

Every backend MUST execute the 3-tier Cascade CMP Dismissal **before** filling credentials:

1. **Tier 1 — Native API**: `window.CookieInformation?.submitAllCategories?.()`
2. **Tier 2 — UI Click**: Try known selectors (`.coi-banner__accept`, `button:has-text("ACCEPT ALL")`, etc.)
3. **Tier 3 — CSS Hide**: Force `display: none !important` on cookie overlay elements

This cascade was proven critical — stealth/Camoufox failed 100% without it because cookie banners steal focus and intercept Enter keypresses. Removing or skipping this cascade is STRICTLY BANNED.

## Golden Template Flow Directives (ABSOLUTE)

The following behavioral directives from the `stealth` reference implementation MUST be enforced globally across all engine backends:

1. **Cold Start Strict Isolation**: A new browser instance MUST be spawned for every session. Warm pools are strictly prohibited to ensure total identity isolation.
2. **Geo Alignment & Locale Matching**: The browser's locale and timezone MUST mathematically match the proxy's physical geographic location. Discrepancies here trigger instant CAPTCHA flags.
3. **Session Teardown Guarantees**: Session teardown must execute in three unyielding phases:
   - Phase 1: Graceful `browser.close()` bounded by a strict 3000ms timeout.
   - Phase 2: OS-level `SIGKILL` or `taskkill /F` targeting the specific browser PID as a final guarantee.
   - Phase 3: Proxy forwarder teardown.
   Zombie processes leading to fingerprint degradation are unacceptable.
4. **Enter Key Registration**: Form submission MUST primarily be executed via `keyboard.press("Enter")` entered from the password field. If the enter key fails to register or the submission times out, the system should automatically fallback to a triple-click of the visual "Submit" or "Log In" button.

## Cashier Verification & DOM Quiescence (ABSOLUTE)

The final verification step (verifying the cashier page load to confirm a successful login) MUST follow the exact sequence implemented in `run-flow-debug.ts` (Step 6) and `engine.ts`:
1. **Network Idle Navigation**: `page.goto` MUST wait for `networkidle` (with a fallback to `domcontentloaded`), not just HTML parse.
2. **Instant Bounce Listener**: A `framenavigated` listener MUST be attached to instantly detect redirects to `/login` or `/signin`.
3. **Mutation Quiescence (DOM Settle)**: Before declaring success, the script MUST wait for the DOM to settle by observing `document.body` with a `MutationObserver` until mutations stop for at least 800ms (capped at 8000ms). Arbitrary `page.waitForTimeout()` sleeps are strictly forbidden here.

## Terminal Session End Conditions (ABSOLUTE)

The app should ONLY ever end a session when one of the following four conditions is met:

1. **Success**: You have successfully navigated to the cashier page after detecting a success and the cashier page navigation is confirmed.
2. **No Account**: The full 4 submit attempts were completed and all were incorrect responses, which confirms that credential does not have an existing account with that target site.
3. **Permanently Disabled**: A "has been disabled" message is detected, meaning the credential is permanently disabled from that target site. The automation requires no more login attempts. After the other target site with that credential is tested, and unless that other site has a success result, the session cookies/session/cache/ip/fingerprint must be burned and the credential banned from future testing (the only exception for banning is a perm_disabled/temp_disabled split).
4. **Temporarily Disabled**: A "temporarily disabled" response is detected. The automation requires no more login attempts. The other target site with that credential is still tested, a countdown of exactly 1 hour is started, and the tested passwords of that email are marked as tested or colored red.

*(Note: There are other less common honeypot and misdirection pages that occur from fingerprinting, but they aren't causing the automations to end early right now. Review their details in other documentation if needed.)*

## Headed Mode & Visual Verification (ABSOLUTE)

1. **Headed vs Headless Contract**: Backends suffixed with `-headed` MUST explicitly set `headless: false` and `liveTest: true`. Bare backend names (e.g., `stealth`, `zendriver`) MUST explicitly default to `headless: true`. There must be no ambiguous `undefined` state for the headless flag.
2. **Grid Tiling for Headed Modes**: Headed modes MUST acquire a slot via `acquireHeadedSlot()` and use the native C# resizer (`BrowserTiler`) to visually tile windows on the desktop.
3. **No Pseudo-Headless for Headed**: Headed modes must never use the `-2000,-2000` off-screen positioning hack. They are meant for visual verification.
4. **Golden Benchmark**: The golden benchmark suite MUST ONLY use `-headed` backends.

## Input Emulation Additions

1. **Async Early "Remember Me" (ABSOLUTE)**: The very first event that happens in each site's script MUST be clicking the "Remember Me" checkbox. This must occur the exact first second the checkbox appears in the DOM, even if the page hasn't fully loaded, and within the first second of it becoming clickable. This is an app-wide and universally adopted rule applying to all backends, modes, and tests. It MUST be implemented via early DOM hooks (e.g. `addInitScript`) to ensure instant execution.
2. **Unconditional "Show Password"**: The password visibility eye-icon MUST be clicked on every single run to simulate human trust behavior.

## Directory Isolation (ABSOLUTE — NO EXCEPTIONS)

You must **NEVER** access, read, or modify the `combined bank statement and metadata cloner` folder on the Desktop (or any of its contents) from this workspace. This rule enforces strict isolation between this web automation project and the bank statement modifier codebase. Any accidental crossover or cross-talk between the two codebases is strictly prohibited.

## Strict Workspace Context Isolation (ABSOLUTE)

You must **NEVER** mix conversation context, plans, or actions from other workspaces into this one. Specifically, you are strictly forbidden from accessing, reading, or modifying any directories or files related to the `rover` project (e.g., `rover-preview-helper`) or any `bank statement` related projects while operating within this `automati1-111` workspace. Always verify that your current working directory and targets are strictly confined to `automati1-111` and ignore context from previous conversations if they apply to a different codebase.

## Autonomous Hermes Directives (ABSOLUTE)

When Hermes is operating in fully autonomous mode (e.g., via `/goal`), it possesses the following elevated privileges and constraints to ensure it can reach the core goal of 100% credential testing coverage:
1. **Unrestricted Internet & Dependency Access**: Hermes has full authorization to browse the internet for solutions and add any necessary 3rd-party dependencies (e.g., `npm install`) required to bypass modern WAFs or resolve issues.
2. **Worker Spawning**: Hermes is explicitly authorized to clone itself or spawn sub-agents/workers to parallelize tasks and increase efficiency.
3. **Full Directory & Config Access**: Hermes has full read/write access to the `.env` file and the entirety of the workspace directory for the purpose of writing hot-fixes, adjusting configs, and executing tests.
4. **Final Repo Changes Require PR (CONSTRAINT)**: While Hermes can manipulate the local directory to achieve the goal, **final structural changes to the core repository must be submitted for user approval**. Hermes is strictly forbidden from directly committing and pushing permanent architectural changes to `main` without generating a Pull Request (PR) or receiving explicit, manual user approval.
5. **Continuous 24/7 Operations (CONSTRAINT)**: Hermes must ensure credential testing continues 24/7. It may pause testing for edits or evaluation for a MAXIMUM of 15-20 minutes. If untested credentials remain in the queue, Hermes must never be idle for more than 20 minutes unless actively editing code. Once edits are complete, testing MUST resume immediately.
