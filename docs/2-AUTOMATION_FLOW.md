# Automation Flow

This document details the step-by-step choreography executed against target websites, primarily orchestrated in `src/targets/login-flow.ts`.

## 1. Pre-Flight Evasion
Before navigating to the target URL, the engine configures the execution environment to bypass WAFs (Web Application Firewalls):
- **navigator.webdriver**: The #1 bot detection signal is overridden. On JS-injected backends, `Object.defineProperty` is used to force it to `undefined`. On Zendriver, this is handled via CDP.
- **Headers & CDP Metadata**: Client hints, platforms, and brand arrays are spoofed to match the generated `UserAgent` profile exactly.

## 2. Navigation & CMP Dismissal
Upon `page.goto()`, the engine waits a maximum of 800ms for the DOM to initialize, then attacks Cookie Management Platforms (CMPs) — primarily CookieInformation.

It executes a strict **Cascade Dismissal**:
1. **Native API**: Tries calling `window.CookieInformation.submitAllCategories()` directly.
2. **UI Click**: If the API fails, attempts a physical click on `.coi-banner__accept`.
3. **CSS Hide**: If all else fails, forcefully hides the banner via `display: none !important` to ensure it doesn't block underlying DOM interaction.

## 3. Humanized Noise & Biometrics
To build trust with behavioral analysis engines before injecting credentials:
- **Remember Me**: 40% of the time, the engine locates and checks the "Remember Me" box *before* focusing the password field.

## 4. Input Emulation Protocol
Directly assigning `element.value = "..."` is strictly banned.

- **Credentials**: Autofill logic (`simulateAutofill()`) bypasses typing speeds by injecting the value via React's internal state tracker properties, mimicking native browser password managers.
- **Other Inputs**: Uses synthetic `TrustedEvent` constructs (`input`, `change`, `keydown`) to sync state back to the virtual DOM.

## 5. The Submit Protocol
To evade static "bot clicked the submit button" heuristics, the engine alternates strategies:
- **First Attempt**: Submits the form by dispatching a native physical `Enter` keypress while focused inside the password field.
- **Subsequent Attempts**: Physically clicks the primary Submit button.

## 6. Shadow DOM Modal Scanning
Once the submit occurs, the engine waits for React to settle via `MutationObserver`. It then uses a deep `TreeWalker` to scan the DOM — piercing Shadow DOM boundaries — for specific modal classes like `[role="dialog"]`, `.modal`, or `.overlay`. 
If these modals contain specific text ("Identity Verification"), it triggers a `honeypot` override.
