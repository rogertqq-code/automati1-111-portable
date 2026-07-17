/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { type Page } from "playwright-core";
import { createLogger } from "../core/logger.js";

const log = createLogger("dom-classifier");

/**
 * Injects a dual-system classification observer into the page.
 * This runs alongside the existing network + simple polling loop.
 * It uses a MutationObserver to evaluate DOM structure changes immediately,
 * without waiting for the 20ms poll cycle or network response.
 * It writes directly to the existing cloak_status symbol so the engine's
 * `waitForFunction` picks it up instantly.
 */
export async function injectDualClassifier(page: Page, siteName: string) {
  try {
    await page.addInitScript(({ siteName }) => {
      const STATUS_SYM = Symbol.for("cloak_status");
      
      // We only want to classify after the form is submitted, but the script
      // runs early. We'll start observing once DOMContentLoaded fires.
      let observer: MutationObserver | null = null;
      
      const classifyDOM = () => {
        // Only classify if the status isn't already set
        if (window[STATUS_SYM as any]) return;

        const bodyText = document.body?.innerText?.toLowerCase() || "";
        
        if (siteName === "joe" || siteName === "ignition") {
          // Check for success elements
          if (document.querySelector('.my-account, .account-balance, [class*="balance"], [data-testid="balance"]')) {
            (window as any)[STATUS_SYM] = "success";
            return;
          }
          
          // Check for hard terminal states
          if (bodyText.includes("permanently") || bodyText.includes("been disabled")) {
            (window as any)[STATUS_SYM] = "disabled";
            return;
          }
          if (bodyText.includes("temporarily") || bodyText.includes("locked") || bodyText.includes("too many")) {
            (window as any)[STATUS_SYM] = "tempdisabled";
            return;
          }
          
          // Authenticators
          if (bodyText.includes("authenticator") || document.querySelector('[placeholder*="code" i], [name*="code" i]')) {
            // Context specific: if the page changed to prompt for a code
            const h1 = document.querySelector('h1')?.innerText?.toLowerCase() || "";
            if (h1.includes("2fa") || h1.includes("authenticator")) {
              (window as any)[STATUS_SYM] = "authenticator";
              return;
            }
          }
        }
      };

      const startObserving = () => {
        if (observer) return;
        observer = new MutationObserver((mutations) => {
          let hasSignificantChange = false;
          for (const m of mutations) {
            if (m.type === "childList" && m.addedNodes.length > 0) {
              hasSignificantChange = true;
              break;
            }
            if (m.type === "characterData") {
              hasSignificantChange = true;
              break;
            }
          }
          
          if (hasSignificantChange) {
            classifyDOM();
          }
        });
        
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserving);
      } else {
        startObserving();
      }
    }, { siteName });
    log.debug(`Injected dual-system DOM classifier for ${siteName}`);
  } catch (e) {
    log.warn(`Failed to inject DOM classifier: ${String(e)}`);
  }
}
