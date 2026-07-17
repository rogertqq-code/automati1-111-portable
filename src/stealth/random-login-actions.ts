/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call*/
/**
 * Randomized Login Actions — 20 Micro-Behavioral Variations
 *
 * Each function adds a small, fast, randomized human behavior that
 * makes the automation indistinguishable from real human interaction.
 * All actions use Gaussian distributions and are lightweight (< 500ms).
 *
 * These are called from engine.ts at strategic points in the login flow.
 */
import { gaussianClamped, gaussianInt } from "../core/gaussian-rng.js";
import { humanMouseMove, humanScroll, injectMicroTremor, humanClickAt, humanClickSelector } from "../intelligence/mouse-humanizer.js";
import { createLogger } from "../core/logger.js";
import type { Page } from "playwright-core";

const log = createLogger("random-actions");

// ─── Helper: get element bounding box safely ──────────────────────────────────
async function getBox(page: Page, selector: string) {
  try {
    return await page.locator(selector).boundingBox();
  } catch { return null; }
}

// ─── Helper: random point inside element bounds (not always center!) ──────────
function randomPointInBox(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  // Gaussian centered on center but with spread across the element
  const x = gaussianClamped(
    box.x + box.width / 2,
    box.width * 0.15, // stddev = 15% of width
    box.x + 4,
    box.x + box.width - 4,
  );
  const y = gaussianClamped(
    box.y + box.height / 2,
    box.height * 0.15,
    box.y + 2,
    box.y + box.height - 2,
  );
  return { x: Math.round(x), y: Math.round(y) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SUBMIT METHOD VARIANCE
// Instead of always clicking the submit button, randomly choose between
// clicking, pressing Enter in password field, Tab→Enter, Tab→Space,
// double-click, triple-click, click at offset, or JavaScript form.submit().
// ═══════════════════════════════════════════════════════════════════════════════

export type SubmitMethod = "click" | "enter_in_password" | "tab_enter" | "tab_space" | "click_offset" | "double_click" | "triple_click" | "js_submit";

export function chooseSubmitMethod(): SubmitMethod {
  const roll = Math.random();
  if (roll < 0.40) return "click";              // 40% — normal single click on button
  if (roll < 0.75) return "click_offset";       // 35% — click at random offset within button
  if (roll < 0.90) return "double_click";       // 15% — rapid double-click on button
  return "triple_click";                        // 10% — triple-click on button
}

export async function executeSubmit(
  page: Page,
  submitSelector: string,
  passwordSelector: string,
  method?: SubmitMethod,
): Promise<void> {
  const m = method || chooseSubmitMethod();
  log.debug(`Submit method: ${m}`);

  switch (m) {
    case "enter_in_password": {
      // Focus password field and press Enter — very common for keyboard users
      await page.focus(passwordSelector).catch(() => {});
      /* stripped sleep */
      await page.keyboard.press("Enter");
      break;
    }
    case "tab_enter": {
      // Tab from password to submit, then Enter
      await page.focus(passwordSelector).catch(() => {});
      /* stripped sleep */
      await page.keyboard.press("Tab");
      /* stripped sleep */
      await page.keyboard.press("Enter");
      break;
    }
    case "tab_space": {
      // Tab to submit, then Space (activates buttons)
      await page.focus(passwordSelector).catch(() => {});
      /* stripped sleep */
      await page.keyboard.press("Tab");
      /* stripped sleep */
      await page.keyboard.press("Space");
      break;
    }
    case "click_offset": {
      // Click at a random point inside the button (not center)
      const box = await getBox(page, submitSelector);
      if (box) {
        const pt = randomPointInBox(box);
        await humanMouseMove(page, pt.x, pt.y);
        /* stripped sleep */
        await humanClickAt(page, pt.x, pt.y);
      } else {
        await humanClickSelector(page, submitSelector, { force: true });
      }
      break;
    }
    case "double_click": {
      // Rapid double-click on the submit button
      const box = await getBox(page, submitSelector);
      if (box) {
        const cx = box.x + box.width / 2 + gaussianClamped(0, 2, -6, 6);
        const cy = box.y + box.height / 2 + gaussianClamped(0, 1.8, -6, 6);
        await humanMouseMove(page, cx, cy);
        /* stripped sleep */
        await humanClickAt(page, Math.round(cx), Math.round(cy), { clickCount: 2 });
      } else {
        await humanClickSelector(page, submitSelector, { force: true, clickCount: 2 });
      }
      break;
    }
    case "triple_click": {
      // Triple-click on the submit button (some users click frantically)
      const box = await getBox(page, submitSelector);
      if (box) {
        const cx = box.x + box.width / 2 + gaussianClamped(0, 2, -6, 6);
        const cy = box.y + box.height / 2 + gaussianClamped(0, 1.8, -6, 6);
        await humanMouseMove(page, cx, cy);
        /* stripped sleep */
        await humanClickAt(page, Math.round(cx), Math.round(cy), { clickCount: 3 });
      } else {
        await humanClickSelector(page, submitSelector, { force: true, clickCount: 3 });
      }
      break;
    }
    case "js_submit": {
      // JavaScript form.submit() — bypasses click entirely, uses the DOM API
      // Some real browser extensions and autofill tools submit forms this way
      const submitted = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (!btn) return false;
        // Walk up from the button to find the enclosing <form>
        const form = btn.closest("form");
        if (form) {
          // requestSubmit() fires the submit event (respects SPA/AJAX handlers)
          // unlike form.submit() which bypasses JS listeners entirely
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit(btn instanceof HTMLButtonElement ? btn : undefined);
          } else {
            // Old browsers: fall back to programmatic btn.click()
            (btn as HTMLElement).click();
          }
          return true;
        }
        // No form wrapper — trigger a click event programmatically
        (btn as HTMLElement).click();
        return true;
      }, submitSelector).catch(() => false);
      if (!submitted) {
        // Ultimate fallback: standard click
        await humanClickSelector(page, submitSelector, { force: true });
      }
      break;
    }
    case "click":
    default: {
      // Standard center click with slight Gaussian offset
      const box = await getBox(page, submitSelector);
      if (box) {
        const cx = box.x + box.width / 2 + gaussianClamped(0, 3, -8, 8);
        const cy = box.y + box.height / 2 + gaussianClamped(0, 2, -5, 5);
        await humanMouseMove(page, cx, cy);
        /* stripped sleep */
        await humanClickAt(page, Math.round(cx), Math.round(cy));
      } else {
        await humanClickSelector(page, submitSelector, { force: true });
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FIELD CLICK POSITION VARIANCE
// Click at random positions within form fields, not always dead center.
// ═══════════════════════════════════════════════════════════════════════════════

export async function clickFieldRandomly(page: Page, selector: string): Promise<void> {
  const box = await getBox(page, selector);
  if (box) {
    const pt = randomPointInBox(box);
    await humanMouseMove(page, pt.x, pt.y);
    /* stripped sleep */
    await humanClickAt(page, pt.x, pt.y);
  } else {
    await humanClickSelector(page, selector, { force: true }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EARLY IMPATIENT EMAIL CLICK
// Sometimes click the email field before the page fully loads (5% chance).
// Real impatient users do this — they see the field and immediately click.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeEarlyFieldClick(page: Page, selector: string): Promise<boolean> {
  if (Math.random() > 0.05) return false;
  try {
    const box = await page.locator(selector).boundingBox({ timeout: 500 });
    if (box) {
      const pt = randomPointInBox(box);
      await humanClickAt(page, pt.x, pt.y);
      log.debug("Early impatient click on field");
      return true;
    }
  } catch { /* field not ready yet — that's fine */ }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. WRONG FIELD FIRST (field focus order variance)
// 8% chance: click password field first, pause, then realize and click email.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeClickWrongFieldFirst(
  page: Page,
  emailSelector: string,
  passwordSelector: string,
): Promise<boolean> {
  if (Math.random() > 0.08) return false;
  try {
    await clickFieldRandomly(page, passwordSelector);
    /* stripped sleep */ // realize mistake
    await clickFieldRandomly(page, emailSelector);
    log.debug("Clicked password first, then corrected to email");
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PERFECT AUTOFILL SIMULATION
// Simulates browser saved-credential autofill behavior:
// - Both fields filled nearly instantly (50-150ms gap)
// - Values set via native setter (like Chrome's credential manager)
// - Dispatches input/change events exactly like real autofill
// - Background color briefly turns to Chrome's autofill yellow (#E8F0FE)
// ═══════════════════════════════════════════════════════════════════════════════

export async function simulateAutofill(
  page: Page,
  emailSelector: string,
  passwordSelector: string,
  email: string,
  password: string,
): Promise<boolean> {
  const tryFill = async (forceClear = false) => {
    return await page.evaluate(({ emailSel, passSel, emailVal, passVal, clearFirst }) => {
      function fillField(sel: string, val: string) {
        const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
        if (!el) return false;

        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (clearFirst) {
          if (nativeInputValueSetter) nativeInputValueSetter.call(el, "");
          else el.value = "";
        }

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, val);
        } else {
          el.value = val;
        }

        // Rule #3: We MUST dispatch events to synchronize state back to the virtual DOM (React).
        // To mimic native autofill while satisfying React's tracker, we dispatch bubbles: true.
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        
        return true;
      }

      const eOk = fillField(emailSel, emailVal);
      const pOk = fillField(passSel, passVal);
      return eOk && pOk;
    }, { emailSel: emailSelector, passSel: passwordSelector, emailVal: email, passVal: password, clearFirst: forceClear }).catch(() => false);
  };

  try {
    await tryFill(false);
    await sleep(Math.round(gaussianClamped(10, 5, 5, 20)));

    // Concurrent fast verification
    let emailActual = await page.locator(emailSelector).inputValue({ timeout: 50 }).catch(() => undefined);
    let passActual = await page.locator(passwordSelector).inputValue({ timeout: 50 }).catch(() => undefined);

    if (emailActual !== email || passActual !== password) {
      log.debug("Autofill verification failed, correcting both fields concurrently...");
      await tryFill(true);
      await sleep(Math.round(gaussianClamped(10, 5, 5, 20)));
      
      emailActual = await page.locator(emailSelector).inputValue({ timeout: 50 }).catch(() => undefined);
      passActual = await page.locator(passwordSelector).inputValue({ timeout: 50 }).catch(() => undefined);
    }

    if (emailActual !== email || passActual !== password) {
      log.debug("Autofill correction failed permanently.");
      return false;
    }

    log.debug("Simulated Chrome autofill (verified)");
    return true;
  } catch (e) {
    log.debug(`Autofill simulation failed: ${String(e)}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DOUBLE-CLICK TO SELECT FIELD CONTENTS
// 12% chance: double-click field before typing (selects word/all).
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeDoubleClickField(page: Page, selector: string): Promise<boolean> {
  if (Math.random() > 0.12) return false;
  try {
    const box = await getBox(page, selector);
    if (box) {
      const pt = randomPointInBox(box);
      await page.mouse.dblclick(pt.x, pt.y);
      /* stripped sleep */
      log.debug("Double-clicked field to select contents");
      return true;
    }
  } catch { /* intentional */ }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. TRIPLE-CLICK SELECT ALL
// 5% chance: triple-click to select all text in field before typing.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeTripleClickField(page: Page, selector: string): Promise<boolean> {
  if (Math.random() > 0.05) return false;
  try {
    await humanClickSelector(page, selector, { clickCount: 3, timeout: 500 });
    /* stripped sleep */
    log.debug("Triple-clicked field to select all");
    return true;
  } catch { /* intentional */ }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CTRL+A BEFORE TYPING
// 8% chance: focus field, Ctrl+A to select all, then start typing.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeCtrlAField(page: Page, selector: string): Promise<boolean> {
  if (Math.random() > 0.08) return false;
  try {
    await page.focus(selector);
    /* stripped sleep */
    await page.keyboard.down("Control");
    /* stripped sleep */
    await page.keyboard.press("a");
    /* stripped sleep */
    await page.keyboard.up("Control");
    /* stripped sleep */
    log.debug("Ctrl+A'd field before typing");
    return true;
  } catch { /* intentional */ }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. MOUSE OVERSHOOT ON SUBMIT BUTTON
// 18% chance: move past the button slightly, then back to click.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeOvershootToButton(
  page: Page,
  submitSelector: string,
): Promise<boolean> {
  if (Math.random() > 0.18) return false;
  const box = await getBox(page, submitSelector);
  if (!box) return false;
  try {
    // Overshoot below/right of button
    const overshootX = box.x + box.width + gaussianClamped(20, 10, 5, 50);
    const overshootY = box.y + box.height / 2 + gaussianClamped(15, 8, 3, 35);
    await humanMouseMove(page, overshootX, overshootY);
    /* stripped sleep */
    // Correct back to button
    const pt = randomPointInBox(box);
    await humanMouseMove(page, pt.x, pt.y);
    log.debug("Mouse overshoot → corrected to submit button");
    return true;
  } catch { /* intentional */ }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. TAB BETWEEN EMAIL AND PASSWORD
// 25% chance: use Tab key to go from email to password instead of clicking.
// ═══════════════════════════════════════════════════════════════════════════════

export function shouldTabToPassword(): boolean {
  return Math.random() < 0.25;
}

export async function tabToNextField(page: Page): Promise<void> {
  /* stripped sleep */
  await page.keyboard.press("Tab");
  /* stripped sleep */
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. REDUNDANT FIELD RE-CLICK
// 10% chance: click an already-focused field again (humans do this a lot).
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeReClickField(page: Page, selector: string): Promise<void> {
  if (Math.random() > 0.10) return;
  try {
    await clickFieldRandomly(page, selector);
    /* stripped sleep */
    log.debug("Re-clicked already-focused field");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. CLICK EMPTY AREA BEFORE STARTING
// 15% chance: click a non-interactive area of the page before starting.
// Real users often click the background to "focus" the page first.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeClickEmptyArea(page: Page): Promise<void> {
  if (Math.random() > 0.15) return;
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  try {
    // Click in the upper-right or lower-right area (usually empty space)
    const x = gaussianClamped(vp.width * 0.8, 50, vp.width * 0.6, vp.width - 20);
    const y = gaussianClamped(vp.height * 0.2, 60, 20, vp.height * 0.4);
    await humanClickAt(page, Math.round(x), Math.round(y));
    /* stripped sleep */
    log.debug("Clicked empty area to focus page");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. SCROLL FORM INTO VIEW
// 20% chance: scroll the form into view even if already visible.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeScrollToForm(page: Page, selector: string): Promise<void> {
  if (Math.random() > 0.20) return;
  try {
    await page.locator(selector).scrollIntoViewIfNeeded({ timeout: 500 });
    /* stripped sleep */
    log.debug("Scrolled form into view");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 14. REMEMBER ME CHECKBOX
// 40% chance: click "remember me" checkbox if present.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeClickRememberMe(page: Page): Promise<void> {
  // DEPRECATED: Remember Me is now clicked strictly via an early DOM hook in engine.ts (100% of the time, the very first second).
  // Clicking it here would un-check it.
}

// ═══════════════════════════════════════════════════════════════════════════════
// 15. LABEL CLICK INSTEAD OF INPUT
// 10% chance: click the label instead of the input field.
// HTML labels with `for=` attribute focus their associated input.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeClickLabel(page: Page, inputSelector: string): Promise<boolean> {
  if (Math.random() > 0.10) return false;
  try {
    // Find the input's ID, then find its label
    const inputId = await page.locator(inputSelector).getAttribute("id");
    if (inputId) {
      const label = await page.$(`label[for="${inputId}"]`);
      if (label) {
        const box = await label.boundingBox();
        if (box) {
          const pt = randomPointInBox(box);
          await humanMouseMove(page, pt.x, pt.y);
          await humanClickAt(page, pt.x, pt.y);
          /* stripped sleep */
          log.debug("Clicked label instead of input field");
          return true;
        }
      }
    }
  } catch { /* intentional */ }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 16. CLICK AT END OF EXISTING TEXT
// When a field already has text, click at the right edge to position cursor.
// ═══════════════════════════════════════════════════════════════════════════════

export async function clickFieldEndOfText(page: Page, selector: string): Promise<void> {
  const box = await getBox(page, selector);
  if (!box) return;
  // Click near the right edge of the field (where text cursor would go)
  const x = box.x + box.width - gaussianClamped(8, 3, 4, 15);
  const y = box.y + box.height / 2 + gaussianClamped(0, 2, -4, 4);
  await humanMouseMove(page, Math.round(x), Math.round(y));
  await humanClickAt(page, Math.round(x), Math.round(y));
  /* stripped sleep */
}

// ═══════════════════════════════════════════════════════════════════════════════
// 17. ESCAPE KEY AFTER FIELD FOCUS
// 8% chance: press Escape after focusing a field to dismiss browser
// autocomplete suggestion dropdown (like a real user would).
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeDismissAutocomplete(page: Page): Promise<void> {
  if (Math.random() > 0.08) return;
  try {
    /* stripped sleep */
    await page.keyboard.press("Escape");
    /* stripped sleep */
    log.debug("Pressed Escape to dismiss autocomplete");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 18. POST-SUBMIT SCROLL
// 25% chance: scroll slightly after clicking submit while waiting for response.
// Real users often scroll to see if anything changed.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybePostSubmitScroll(page: Page): Promise<void> {
  if (Math.random() > 0.25) return;
  try {
    /* stripped sleep */
    await humanScroll(page, Math.round(gaussianClamped(60, 30, 15, 150)));
    log.debug("Post-submit scroll");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 19. PRE-TYPE FIELD HOVER
// 15% chance: hover over a field for a moment before clicking it.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeHoverBeforeClick(page: Page, selector: string): Promise<void> {
  if (Math.random() > 0.15) return;
  const box = await getBox(page, selector);
  if (!box) return;
  try {
    const pt = randomPointInBox(box);
    await humanMouseMove(page, pt.x, pt.y);
    /* stripped sleep */
    log.debug("Hovered over field before clicking");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 20. MICRO-INTERACTION BUNDLE
// Rolls a dice and executes 0-2 random micro-interactions from a pool.
// Called at transition points (after page load, between fields, after submit).
// Each micro-interaction is extremely fast (< 200ms).
// ═══════════════════════════════════════════════════════════════════════════════

export async function randomMicroInteraction(page: Page): Promise<void> {
  const actions = [
    // Move mouse to random neutral position
    async () => {
      const vp = page.viewportSize() || { width: 1280, height: 720 };
      await humanMouseMove(page,
        gaussianClamped(vp.width * 0.5, vp.width * 0.2, 50, vp.width - 50),
        gaussianClamped(vp.height * 0.5, vp.height * 0.2, 50, vp.height - 50),
      );
    },
    // Tiny scroll (10-40px)
    async () => {
      await humanScroll(page, Math.round(gaussianClamped(25, 12, 8, 50)));
    },
    // Micro-pause (just wait briefly)
    async () => {
      /* stripped sleep */
    },
    // Mouse wiggle in place
    async () => {
      const vp = page.viewportSize() || { width: 1280, height: 720 };
      const cx = vp.width / 2;
      const cy = vp.height / 2;
      await injectMicroTremor(page, cx, cy, Math.round(gaussianClamped(80, 40, 30, 200)));
    },
  ];

  // 40% chance of 1 action, 10% chance of 2 actions, 50% nothing
  const numActions = Math.random() < 0.50 ? 0 : (Math.random() < 0.80 ? 1 : 2);
  for (let i = 0; i < numActions; i++) {
    const action = actions[Math.floor(Math.random() * actions.length)]!;
    try {
      await action();
    } catch { /* intentional */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBO: Pre-fill actions bundle
// Call this before filling the email field. Rolls multiple micro-actions.
// ═══════════════════════════════════════════════════════════════════════════════

export async function preFillActions(
  page: Page,
  emailSelector: string,
  passwordSelector: string,
): Promise<{ usedAutofill: boolean }> {
  const usedAutofill = false;

  // Maybe scroll form into view
  await maybeScrollToForm(page, emailSelector);

  // Maybe click wrong field first (password before email)
  await maybeClickWrongFieldFirst(page, emailSelector, passwordSelector);

  // Maybe hover before clicking email field
  await maybeHoverBeforeClick(page, emailSelector);

  return { usedAutofill };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBO: Pre-submit actions bundle
// Call this after filling fields but before submitting.
// ═══════════════════════════════════════════════════════════════════════════════

export async function preSubmitActions(
  page: Page,
  emailSelector: string,
  submitSelector: string,
): Promise<{ submitMethod: SubmitMethod }> {
  // Maybe click remember me
  await maybeClickRememberMe(page);

  // Maybe re-check email field
  if (Math.random() < 0.12) {
    await clickFieldRandomly(page, emailSelector);
    /* stripped sleep */
  }

  // Maybe overshoot to submit button
  await maybeOvershootToButton(page, submitSelector);

  // Choose submit method
  const submitMethod = chooseSubmitMethod();

  return { submitMethod };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBO: Transition between email → password
// Call this after typing email, before typing password.
// ═══════════════════════════════════════════════════════════════════════════════

export async function emailToPasswordTransition(
  page: Page,
  passwordSelector: string,
): Promise<{ usedTab: boolean }> {
  // Maybe dismiss autocomplete suggestion
  await maybeDismissAutocomplete(page);

  // Random micro-interaction
  await randomMicroInteraction(page);

  // Decide: Tab or click to password field
  const useTab = Math.random() < 0.25;
  if (useTab) {
    await tabToNextField(page);
    return { usedTab: true };
  }

  // Click password field (with various styles)
  const clickedLabel = await maybeClickLabel(page, passwordSelector);
  if (!clickedLabel) {
    await maybeHoverBeforeClick(page, passwordSelector);
    await clickFieldRandomly(page, passwordSelector);
  }

  return { usedTab: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 21. WINDOW FOCUS/BLUR CYCLE
// 8% chance: simulate tab-switching (blur then focus) — very human behavior.
// Fingerprint detectors track visibility change frequency.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeTabSwitchSimulation(page: Page): Promise<void> {
  if (Math.random() > 0.08) return;
  try {
    // Simulate losing focus (user switched to another tab)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true, writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    /* stripped sleep */
    // Come back
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true, writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    log.debug("Simulated tab-switch (blur → focus)");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 22. LINK HOVER SIMULATION
// 12% chance: hover over a random link on the page before interacting with forms.
// Real users browse around before clicking login.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeHoverRandomLink(page: Page): Promise<void> {
  if (Math.random() > 0.12) return;
  try {
    const linkCount = await page.evaluate(() => document.querySelectorAll('a[href]').length);
    if (linkCount === 0) return;
    const idx = Math.floor(Math.random() * Math.min(linkCount, 5)); // Only first 5 links
    const box = await page.locator(`a[href]`).nth(idx).boundingBox({ timeout: 500 });
    if (box) {
      const pt = randomPointInBox(box);
      await humanMouseMove(page, pt.x, pt.y);
      /* stripped sleep */
      log.debug(`Hovered random link #${idx}`);
    }
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 23. TEXT SELECTION ON PAGE
// 6% chance: accidentally select some text while moving mouse.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeAccidentalTextSelect(page: Page): Promise<void> {
  if (Math.random() > 0.06) return;
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  try {
    const startX = gaussianClamped(vp.width * 0.3, 100, 50, vp.width - 100);
    const startY = gaussianClamped(vp.height * 0.3, 80, 50, vp.height - 100);
    await page.mouse.move(Math.round(startX), Math.round(startY));
    await page.mouse.down();
    /* stripped sleep */
    await page.mouse.move(Math.round(startX + gaussianClamped(40, 20, 10, 80)), Math.round(startY));
    /* stripped sleep */
    await page.mouse.up();
    // Immediately click elsewhere to deselect
    /* stripped sleep */
    await humanClickAt(page, Math.round(vp.width * 0.5), Math.round(vp.height * 0.5));
    log.debug("Accidental text selection → deselected");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 24. NATURAL VIEWPORT SCROLL RESTORE
// 10% chance: scroll to a random position then back to form area.
// Simulates user exploring the page before focusing on the form.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeExploreAndReturn(page: Page, formSelector: string): Promise<void> {
  if (Math.random() > 0.10) return;
  try {
    // Scroll down past the form
    await humanScroll(page, Math.round(gaussianClamped(500, 200, 200, 900)));
    /* stripped sleep */
    // Read something
    const vp = page.viewportSize() || { width: 1280, height: 720 };
    await humanMouseMove(page,
      gaussianClamped(vp.width * 0.5, 150, 100, vp.width - 100),
      gaussianClamped(vp.height * 0.5, 100, 100, vp.height - 100),
    );
    /* stripped sleep */
    // Scroll back up to form
    await page.locator(formSelector).scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
    /* stripped sleep */
    log.debug("Explored page then returned to form");
  } catch { /* intentional */ }
}



// ═══════════════════════════════════════════════════════════════════════════════
// 26. NATURAL MOUSE IDLE DRIFT
// 20% chance: when idle, let the mouse drift slowly in one direction.
// Real users don't hold their mouse perfectly still.
// ═══════════════════════════════════════════════════════════════════════════════

export async function mouseIdleDrift(page: Page): Promise<void> {
  if (Math.random() > 0.20) return;
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  try {
    const startX = gaussianClamped(vp.width * 0.5, 100, 100, vp.width - 100);
    const startY = gaussianClamped(vp.height * 0.5, 80, 100, vp.height - 100);
    const driftX = gaussianClamped(0, 15, -40, 40);
    const driftY = gaussianClamped(0, 10, -30, 30);
    const steps = gaussianInt(6, 2, 3, 10);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(
        Math.round(startX + driftX * t + (Math.random() - 0.5) * 1.5),
        Math.round(startY + driftY * t + (Math.random() - 0.5) * 1),
      );
      /* stripped sleep */
    }
    log.debug("Mouse idle drift");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 27. KEYBOARD SHORTCUT ATTEMPT
// 5% chance: press a harmless keyboard shortcut (Ctrl+L to focus address bar).
// Shows the session receives real keyboard events.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeKeyboardShortcut(page: Page): Promise<void> {
  if (Math.random() > 0.05) return;
  try {
    const shortcuts = [
      { key: "F5", label: "refresh attempt (blocked)" },
      { key: "Home", label: "scroll to top" },
      { key: "End", label: "scroll to bottom" },
    ];
    const chosen = shortcuts[Math.floor(Math.random() * shortcuts.length)]!;
    await page.keyboard.press(chosen.key);
    /* stripped sleep */
    log.debug(`Keyboard shortcut: ${chosen.label}`);
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 28. TOUCH EVENT SEEDING
// 8% chance: inject realistic touch events into the page context.
// Some fingerprinters check if touch events have ever been dispatched.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeSeedTouchEvents(page: Page): Promise<void> {
  if (Math.random() > 0.08) return;
  try {
    await page.evaluate(() => {
      // Seed touch event history — makes it look like the user has used touch before
      const touchStart = new TouchEvent('touchstart', {
        bubbles: true, cancelable: true,
        touches: [], targetTouches: [], changedTouches: [],
      });
      const touchEnd = new TouchEvent('touchend', {
        bubbles: true, cancelable: true,
        touches: [], targetTouches: [], changedTouches: [],
      });
      document.body.dispatchEvent(touchStart);
      document.body.dispatchEvent(touchEnd);
    });
    log.debug("Seeded touch events");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 29. REALISTIC MOUSEOVER EVENT CHAIN
// 15% chance: generate mouseover/mouseenter events on form elements.
// Bot detectors check if mouseover events fire before click events.
// ═══════════════════════════════════════════════════════════════════════════════

export async function maybeFireMouseoverChain(page: Page, selector: string): Promise<void> {
  if (Math.random() > 0.15) return;
  try {
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false }));
    }, selector);
    /* stripped sleep */
    log.debug("Fired mouseover/mouseenter chain");
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 30. FOCUS/INPUT EVENT ORDERING
// Always: ensure correct event ordering when clicking a field.
// Bots often miss the focus→click→input event chain that real browsers fire.
// ═══════════════════════════════════════════════════════════════════════════════

export async function fireRealisticFieldEvents(page: Page, selector: string): Promise<void> {
  try {
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (!el) return;
      // Real browser event chain: mousedown → focus → mouseup → click
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, selector);
  } catch { /* intentional */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 31. WARMUP RANDOM CLICKS — called once at the very start of each credential.
// Fires 3 or 4 fast clicks at randomised, inert page locations so the browser
// session has click-event history before any form interaction begins.
// Coordinates are offset by a simple hash of the credential email so every
// credential produces a distinct click pattern — no two runs look identical.
// Clicks land in the safe peripheral zones (not on form fields or buttons).
// ═══════════════════════════════════════════════════════════════════════════════

export async function performWarmupRandomClicks(
  page: Page,
  credentialEmail: string,
): Promise<void> {
  const vp = page.viewportSize() || { width: 1280, height: 720 };

  // Derive a lightweight per-credential offset (0–1) from the email string.
  // This ensures coordinates shift every credential without slowing anything down.
  let emailHash = 0;
  for (let i = 0; i < credentialEmail.length; i++) {
    emailHash = (emailHash * 31 + credentialEmail.charCodeAt(i)) >>> 0;
  }

  // 3 or 4 clicks — vary count per credential too
  const clickCount = (emailHash % 2 === 0) ? 3 : 4;

    // Pre-compute zones: outer 5% corners (the "green parts") avoiding the centre.
    // Each zone has a tiny spread so it doesn't always hit exactly the same pixel.
    const zones: Array<{ xBase: number; yBase: number; xSpread: number; ySpread: number }> = [
      // Top-left corner
      { xBase: vp.width * 0.05, yBase: vp.height * 0.05, xSpread: 10, ySpread: 10 },
      // Top-right corner
      { xBase: vp.width * 0.95, yBase: vp.height * 0.05, xSpread: 10, ySpread: 10 },
      // Bottom-left corner
      { xBase: vp.width * 0.05, yBase: vp.height * 0.95, xSpread: 10, ySpread: 10 },
      // Bottom-right corner
      { xBase: vp.width * 0.95, yBase: vp.height * 0.95, xSpread: 10, ySpread: 10 },
    ];

  for (let i = 0; i < clickCount; i++) {
    const zone = zones[i % zones.length]!;
    const x = Math.round(Math.min(
      vp.width - 10,
      Math.max(10, zone.xBase + gaussianClamped(0, zone.xSpread, -zone.xSpread, zone.xSpread)),
    ));
    const y = Math.round(Math.min(
      vp.height - 10,
      Math.max(10, zone.yBase + gaussianClamped(0, zone.ySpread, -zone.ySpread, zone.ySpread)),
    ));
    try {
      const isSafe = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return true;
        let curr: HTMLElement | null = el as HTMLElement;
        while (curr && curr !== document.body) {
          const tag = curr.tagName.toLowerCase();
          const text = (curr.textContent || '').toLowerCase();
          const href = (curr.getAttribute('href') || '').toLowerCase();
          if ((tag === 'a' || tag === 'button') && (
              text.includes('join') || text.includes('sign up') || text.includes('signup') || text.includes('register') ||
              href.includes('join') || href.includes('signup') || href.includes('register')
          )) {
            return false;
          }
          curr = curr.parentElement;
        }
        return true;
      }, { x, y }).catch(() => true);

      if (isSafe) {
        await humanClickAt(page, x, y);
        // Extremely short micro-pause
        /* stripped sleep */
      }
    } catch { /* page may not be fully ready — silently skip */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 32-50. ZERO-COST BEHAVIORAL SEEDING
// All 19 actions below run as a SINGLE page.evaluate() round-trip plus one
// optional keyboard.up() — no setTimeout, no sleep, no added wall-time.
// They seed browser-internal state that fingerprint services inspect:
// Battery API, Network Info, Permissions, localStorage probe, sessionStorage
// breadcrumb, MediaQuery reads, Screen Orientation, Pointer events, History
// state, requestAnimationFrame, IntersectionObserver, WebRTC probe, Gamepad
// poll, AudioContext touch, CSS custom property, Performance mark,
// Clipboard attempt, synthetic WheelEvent, and a stray Shift key release.
// ═══════════════════════════════════════════════════════════════════════════════

export async function performZeroCostBehavioralSeeding(page: Page): Promise<void> {
  // ── Single CDP round-trip: all JS runs atomically in the browser context ──
  try {
    await page.evaluate(() => {
      // #32 — Battery API read (async fire-and-forget; the call itself is the signal)
      (navigator as any).getBattery?.().catch?.(() => {});

      // #33 — Network Information API read
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn) { void conn.effectiveType; void conn.downlink; void conn.rtt; }

      // #34 — Permissions API query (fire-and-forget; result not needed)
      navigator.permissions?.query({ name: 'notifications' }).catch(() => {});
      navigator.permissions?.query({ name: 'clipboard-read' as PermissionName }).catch(() => {});

      // #35 — localStorage probe: read keys that real browsers accumulate over time
      ['_ga', '_gid', 'theme', 'lang', 'locale', 'uuid', 'user_id'].forEach(k => localStorage.getItem(k));

      // #36 — sessionStorage breadcrumb: write a temp key then delete it (SPA router behaviour)
      try {
        const ts = String(Date.now());
        sessionStorage.setItem('_nav_ts', ts);
        sessionStorage.removeItem('_nav_ts');
      } catch { /* intentional */ }

      // #37 — MediaQuery reads (sites check these for theming + fingerprinting)
      [
        '(prefers-color-scheme: dark)',
        '(prefers-reduced-motion: reduce)',
        '(pointer: fine)',
        '(hover: hover)',
      ].forEach(q => matchMedia(q).matches);

      // #38 — Screen orientation read
      try { void screen.orientation?.type; void screen.orientation?.angle; } catch { /* intentional */ }

      // #39 — Pointer events on document body before any mouse event chain
      // Real Chromium always fires pointerover/pointerenter ahead of mouseover.
      try {
        document.body.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' }));
        document.body.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, cancelable: false, pointerId: 1, pointerType: 'mouse' }));
      } catch { /* intentional */ }

      // #40 — History state touch (SPA router fires replaceState on every route entry)
      try { history.replaceState(history.state, '', location.href); } catch { /* intentional */ }

      // #41 — requestAnimationFrame seed (bot detectors check if rAF has ever fired)
      requestAnimationFrame(() => {});

      // #42 — IntersectionObserver on document body (lazy-load behaviour; disconnect immediately)
      try {
        const io = new IntersectionObserver(() => {});
        io.observe(document.body);
        // Disconnect on next microtask — just seeding the observer registry
        void Promise.resolve().then(() => io.disconnect());
      } catch { /* intentional */ }

      // #43 — WebRTC probe: create + close (FingerprintJS checks RTCPeerConnection existence)
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        void Promise.resolve().then(() => pc.close());
      } catch { /* intentional */ }

      // #44 — Gamepad API poll (Chromium polls this internally; absence of any call is a signal)
      try { navigator.getGamepads?.(); } catch { /* intentional */ }

      // #45 — AudioContext state read (create + schedule close; audio fingerprint detectors check this)
      try {
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        void Promise.resolve().then(() => ac.close().catch(() => {}));
      } catch { /* intentional */ }

      // #46 — CSS custom property write (extension / analytics SDK behaviour)
      try { document.documentElement.style.setProperty('--_t', String(Date.now())); } catch { /* intentional */ }

      // #47 — Performance mark (real analytics SDKs drop marks; entries are inspected by some detectors)
      try { performance.mark('page-interactive'); } catch { /* intentional */ }

      // #48 — Clipboard write attempt (fires even without focus; the IPC attempt is the signal)
      try { navigator.clipboard?.writeText('').catch(() => {}); } catch { /* intentional */ }

      // #50 — Synthetic WheelEvent dispatch (touchpad users always generate wheel events
      //        independently of scroll position change; bots often only fire CDP wheel)
      try {
        window.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          deltaX: 0, deltaY: 3, deltaZ: 0, deltaMode: 0,
        }));
      } catch { /* intentional */ }
    });
  } catch { /* page navigated or context closed — silently skip */ }

  // #49 — Stray Shift key release (single CDP send, no sleep needed).
  // Real users often have a modifier held from a prior action; releasing it is natural.
  try { await page.keyboard.up('Shift'); } catch { /* intentional */ }
}

// Utility sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(1, Math.round(ms))));
}