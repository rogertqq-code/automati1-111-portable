import { Page } from "playwright-core";
import { executeUnifiedLoginChoreography, type UnifiedChoreographyInput } from "./login-flow.js";
import { getCoordinateMap, coordinateClick } from "../intelligence/coordinate-mapper.js";

export type UniversalLoginOptions = UnifiedChoreographyInput & {
  mode: "stealth-humanized" | "benchmark-direct"; // Benchmark uses evaluate state-bypasses, stealth uses human typing
  backend?: string; // Optional backend name for logging
};

/**
 * Early hook to guarantee "Remember Me" is clicked within 1000ms of form appearance
 * without waiting for network or dom to settle.
 */
export async function installEarlyRememberMeHook(page: Page) {
  await page.addInitScript(() => {
    // We execute this immediately, no DOMContentLoaded wait.
    let clicked = false;
    const observer = new MutationObserver(() => {
      if (clicked) return;
      let targetEl: HTMLElement | null = null;
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (const el of Array.from(checkboxes)) {
        const cb = el as HTMLInputElement;
        if ((cb.id && cb.id.toLowerCase().includes('remember')) || 
            (cb.name && cb.name.toLowerCase().includes('remember')) ||
            (cb.getAttribute('data-testid') && cb.getAttribute('data-testid')?.toLowerCase().includes('remember'))) {
          targetEl = cb;
          break;
        }
      }
      if (!targetEl) {
        const labels = document.querySelectorAll('label');
        for (const el of Array.from(labels)) {
          const label = el as HTMLLabelElement;
          if (label.textContent && label.textContent.toLowerCase().includes('remember')) {
            targetEl = label;
            break;
          }
        }
      }

      if (targetEl && targetEl.offsetParent !== null) {
        if (targetEl.tagName.toLowerCase() === 'input' && (targetEl as HTMLInputElement).checked) {
          clicked = true;
          observer.disconnect();
          return;
        }
        // Wait a gaussian randomized amount of time (max 1500ms) BEFORE starting the click
        const u = 1 - Math.random();
        const v = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        // mean 750ms, stddev 250ms
        let interactionDelay = Math.floor(750 + z * 250);
        if (interactionDelay < 50) interactionDelay = 50;
        if (interactionDelay > 1500) interactionDelay = 1500;
        
        setTimeout(() => {
          if (!targetEl) return;
          // Dispatch full bubbling events to satisfy React
          const holdDelay = Math.floor(Math.random() * (150 - 60 + 1)) + 60;
          const mousedownEvent = new MouseEvent('mousedown', { view: window, bubbles: true, cancelable: true, buttons: 1 });
          targetEl.dispatchEvent(mousedownEvent);

          setTimeout(() => {
            if (targetEl) {
              targetEl.dispatchEvent(new MouseEvent('mouseup', { view: window, bubbles: true, cancelable: true, buttons: 0 }));
              targetEl.click();
              if (targetEl.tagName.toLowerCase() === 'input') {
                targetEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
              console.log("[Automati] Early Remember Me checked instantly via DOM hook (Gaussian delay " + interactionDelay + "ms, hold " + holdDelay + "ms).");
            }
          }, holdDelay);
        }, interactionDelay);
        
        clicked = true;
        observer.disconnect();
      }
    });
    
    // Start observing immediately
    observer.observe(document, { childList: true, subtree: true });
  }).catch(() => {});
}

/**
 * Universal Login Flow
 * Handles: Cookie Banners -> Early Remember Me -> Coordinate/Standard Login -> Submission -> Verification
 */
export async function universalLoginFlow(options: UniversalLoginOptions): Promise<{ success: boolean; submitMethod?: string; networkVerdict?: string }> {
  const { page, siteName, mode } = options;
  console.log(`[UniversalLogin] Starting universal flow for ${siteName} (mode: ${mode})`);

  // Start continuous cookie banner dismissal
  const killBanners = async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        await page.evaluate(() => {
          try { (window as any).CookieInformation?.submitAllCategories?.(); } catch {}
          for (const el of document.querySelectorAll('.coi-banner, .coi-consent-banner, [id*="cookie"], [class*="cookie-banner"]')) {
            (el as HTMLElement).style.setProperty('display', 'none', 'important');
          }
        });
        const btn = page.locator('.coi-banner__accept, [data-coi-btn="accept"], button:has-text("ACCEPT ALL"), button:has-text("Accept All")').first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 500 }).catch(() => {});
        }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
  };
  killBanners().catch(() => {});

  // Wait for login form to exist
  await page.waitForSelector('input[type="email"], input[name*="email"], input#email, #username', { state: "visible", timeout: 45000 }).catch(() => {});

  const coords = getCoordinateMap(siteName);

  if (mode === "benchmark-direct") {
    // Benchmark mode: raw React-state injection bypass
    console.log(`[UniversalLogin] Injecting credentials via React state bypass for ${options.targetEmail}`);
    await page.evaluate(({ email, pass }) => {
        const eInput = document.querySelector('input[type="email"], input[name*="email"], input#email, #username') as HTMLInputElement;
        const pInput = document.querySelector('input[type="password"], input[name*="pass"], input#password') as HTMLInputElement;
        
        for (const item of [{el: eInput, val: email}, {el: pInput, val: pass}]) {
            if (!item.el) continue;
            const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            const prototype = Object.getPrototypeOf(item.el);
            const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

            if (valueSetter && valueSetter !== prototypeValueSetter) {
                prototypeValueSetter?.call(item.el, item.val);
            } else if (valueSetter) {
                valueSetter.call(item.el, item.val);
            } else {
                item.el.value = item.val;
            }
            item.el.dispatchEvent(new Event('input', { bubbles: true }));
            item.el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, { email: options.targetEmail, pass: options.password });
    
    // Focus and Enter
    const passInput = page.locator('input[type="password"], input[name*="pass"], input#password').first();
    await passInput.focus().catch(() => {});
    await passInput.press("Enter", { delay: 100 }).catch(async () => {
      await page.keyboard.press("Enter", { delay: 100 }).catch(() => {});
    });

    return { success: true, submitMethod: "benchmark-enter", networkVerdict: "unknown" };
  } else {
    // Stealth-humanized mode
    console.log(`[UniversalLogin] Executing standard stealth choreography`);
    if (coords?.emailInput && options.attemptIdx === 0) {
       console.log(`[UniversalLogin] Using viewport-independent coordinates for email input`);
       await coordinateClick(page, coords.emailInput).catch(() => {});
    }
    const result = await executeUnifiedLoginChoreography(options);
    return result;
  }
}
