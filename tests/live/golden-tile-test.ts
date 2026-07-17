/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-expressions, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await , @typescript-eslint/no-misused-promises, @typescript-eslint/ban-ts-comment, no-useless-assignment, @typescript-eslint/restrict-template-expressions, no-unassigned-vars, preserve-caught-error, @typescript-eslint/no-require-imports*/
import "dotenv/config";
import { execSync } from "child_process";
import { ConfigStore, type AppConfig } from "../../src/core/config-store.js";
import { createSession, pickProxy, type SessionHandle, type SessionOpts } from "../../backends/index.js";
import { BrowserTiler } from "../../src/services/browser-tiler.js";
import { type Page } from "playwright-core";
import fs from "fs";
import path from "path";

// Guard against Playwright's FFBrowserContext crash (known bug with Camoufox)
process.on("uncaughtException", (err) => {
  if (err instanceof TypeError && err.message.includes("reading 'url'") && err.stack?.includes("FFBrowserContext")) {
    console.warn("[TILE] ⚠ Swallowed Playwright FFBrowserContext pageError crash");
    return;
  }
  console.error("[TILE] Uncaught exception:", err);
  process.exit(1);
});

// Added CLI parsing for --targets
const args = process.argv.slice(2);
const targetsArg = args.find(a => a.startsWith('--targets='))?.split('=')[1] || 'joe';
const testTargets = targetsArg.split(',').map(t => t.trim().toLowerCase());

const JOE_URL = "https://www.joefortune.win/login";
const IGNITION_URL = "https://www.ignitioncasino.eu/login";
const EMAIL = "phuttasopit@hotmail.co.th";
const PASSWORD = "Tomo06032553";
const TIMEOUT_MS = 90000;

const appConfig: AppConfig = ConfigStore.load();
process.env.SPIDER_LOCAL_API_KEY = "dummy_key_for_test";

function nukeAllBrowsers(): void {
  if (process.platform === "win32") {
    try { execSync(`taskkill /F /IM camoufox.exe /T`, { stdio: "ignore", timeout: 5000 }); } catch {}
    try { execSync(`taskkill /F /IM chrome.exe /T`, { stdio: "ignore", timeout: 5000 }); } catch {}
  } else {
    try { execSync(`pkill -9 -f camoufox`, { stdio: "ignore", timeout: 5000 }); } catch {}
    try { execSync(`pkill -9 -f chrome`, { stdio: "ignore", timeout: 5000 }); } catch {}
  }
}

/**
 * SPA-aware success detector.
 * Joe Fortune uses SPA navigation: on successful login, a "Welcome!" toast
 * banner appears while the URL may still be /login for a brief period.
 * This function polls for EITHER signal:
 *   Signal A: URL navigates away from /login
 *   Signal B: "Welcome!" success banner appears in the DOM
 */
async function waitForLoginSuccess(page: Page, backend: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  
  while (Date.now() < deadline) {
    // Signal A: URL changed away from /login
    const currentUrl = page.url().toLowerCase();
    if (!currentUrl.includes("/login")) {
      console.log(`[${backend}] ✅ Success: URL navigated to ${page.url()}`);
      return;
    }
    
    // Signal B: "welcome!" banner (case-insensitive, exclamation REQUIRED).
    // "welcome" without exclamation is NEVER success. No exceptions.
    const hasSuccessBanner = await page.evaluate(() => {
      const alert = document.querySelector('.ol-alert__content');
      if (alert && /welcome!/i.test(alert.textContent || "")) return true;
      const all = document.body?.innerText || "";
      return /welcome!/i.test(all);
    }).catch(() => false);
    
    if (hasSuccessBanner) {
      console.log(`[${backend}] ✅ Success: "welcome!" banner detected`);
      return;
    }
    
    // Signal C: Login form has vanished (SPA unmount)
    const formGone = await page.evaluate(() => {
      const user = document.querySelector('#username') || document.querySelector('input[type="email"]');
      const pass = document.querySelector('#password') || document.querySelector('input[type="password"]');
      return !user && !pass;
    }).catch(() => false);
    
    if (formGone) {
      console.log(`[${backend}] ✅ Success: Login form removed from DOM`);
      return;
    }
    
    // Signal D: Error detected — fail fast
    const hasError = await page.evaluate(() => {
      const body = document.body?.innerText?.toLowerCase() || "";
      return body.includes("incorrect") || body.includes("invalid") || body.includes("wrong password");
    }).catch(() => false);
    
    if (hasError) {
      throw new Error("Login returned incorrect credentials error");
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  await page.screenshot({ path: `failure-${backend}-${Date.now()}.png`, fullPage: true }).catch(() => {});
  throw new Error(`Login success not detected within ${timeoutMs}ms`);
}

async function runGoldenFlow(backend: string, targetName: string, proxyPool?: string): Promise<SessionHandle> {
  const proxy = pickProxy([], EMAIL, backend, proxyPool || appConfig.proxyPool);

  const opts: SessionOpts = {
    backend: backend as any,
    headless: false, // Force headed for tiling
    liveTest: true,
    proxy,
    email: EMAIL,
    cleanSession: true,
    recordVideo: false,
    useHttpCloak: appConfig.useHttpCloak,
    stealthBypassHttpCloak: appConfig.stealthBypassHttpCloak,
    injectStealthJS: appConfig.injectStealthJS,
    proxyPool: proxyPool || appConfig.proxyPool,
  };

  const handle = await createSession(opts);
  const page = handle.page;
  const ctx = handle.context;
  
  if (ctx) {
    ctx.setDefaultTimeout(TIMEOUT_MS);
    ctx.setDefaultNavigationTimeout(TIMEOUT_MS);
  } else {
    page.setDefaultTimeout(TIMEOUT_MS);
    page.setDefaultNavigationTimeout(TIMEOUT_MS);
  }

  const urlsToTry = targetName === "ignition" 
    ? [IGNITION_URL, "https://www.ignitioncasino.com/login"] 
    : [JOE_URL, "https://www.joefortune.com/login", "https://www.joefortune.ooo/login"];

  console.log(`[${backend}] Navigating to ${urlsToTry[0]}...`);
  
  // Navigate with retry to handle transient DNS/proxy failures
  let navOk = false;
  for (const url of urlsToTry) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(async () => {
        // Fallback to domcontentloaded if networkidle times out
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      });
      navOk = true;
      break;
    } catch (e: any) {
      console.log(`[${backend}] Navigation to ${url} failed: ${e.message.slice(0, 100)}`);
    }
  }
  
  if (!navOk) {
    throw new Error("All navigation URLs failed");
  }
  
  console.log(`[${backend}] Starting continuous background cookie banner killer...`);
  
  // Asynchronous fire-and-forget banner killer that runs for 30s
  // This guarantees the banner is dismissed the second it appears without blocking the flow
  const killBanners = async () => {
    const deadline = Date.now() + 30000;
    while(Date.now() < deadline) {
      try {
        // CSS hide + native API
        await page.evaluate(() => {
          try { (window as any).CookieInformation?.submitAllCategories?.(); } catch {}
          for (const el of document.querySelectorAll('.coi-banner, .coi-consent-banner, [id*="cookie"], [class*="cookie-banner"]')) {
            (el as HTMLElement).style.setProperty('display', 'none', 'important');
          }
        });
        
        // UI Click
        for (const sel of ['.coi-banner__accept', '[data-coi-btn="accept"]', 'button:has-text("ACCEPT ALL")', 'button:has-text("Accept All")']) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 500 }).catch(() => {});
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
  };
  killBanners().catch(() => {});
  
  // Wait a short moment to let initial DOM stabilize
  await new Promise(r => setTimeout(r, 2000));
  
  // Wait for email input to be visible before interacting
  const emailInput = page.locator('input[type="email"], input[name*="email"], input#email, #username').first();
  await emailInput.waitFor({ state: "visible", timeout: 30000 });
  
  // Golden Rule: Credential Entry (Autofill Replica)
  // Bypass Playwright's typing speed and apply state directly to React's internal state tracker
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
  }, { email: EMAIL, pass: PASSWORD });
  
  // Re-focus password field to ensure Enter targets the login form, not a stale banner
  const passInput = page.locator('input[type="password"], input[name*="pass"], input#password').first();
  await passInput.focus().catch(() => {});
  await passInput.click().catch(() => {});
  await new Promise(r => setTimeout(r, 200));
  
  // Submit via Enter key with triple-click fallback
  await passInput.press("Enter", { delay: 100 }).catch(async () => {
    await page.keyboard.press("Enter", { delay: 100 }).catch(() => {});
  });

  console.log(`[${backend}] Enter pressed. Checking if it registered...`);
  
  // Wait 3 seconds to see if a navigation starts or form disappears
  await new Promise(r => setTimeout(r, 3000));
  
  const formStillExists = await page.evaluate(() => {
    return !!(document.querySelector('#username') || document.querySelector('input[type="email"]'));
  }).catch(() => false);
  
  // Triple click fallback if enter was ignored by the SPA
  if (formStillExists && page.url().includes("/login")) {
    console.log(`[${backend}] Enter key failed to submit the form, falling back to triple click...`);
    const submitBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log In"), button:has-text("Sign In"), .login-btn').first();
    const btnCount = await submitBtn.count();
    if (btnCount > 0) {
      for (let i = 0; i < 3; i++) {
          await submitBtn.click({ force: true, timeout: 1000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 100));
      }
    } else {
      console.log(`[${backend}] ERROR: Could not find submit button for triple click!`);
    }
  }
  
  console.log(`[${backend}] Submitted. Waiting for success...`);
  
  // Use SPA-aware success detection
  await waitForLoginSuccess(page, backend, TIMEOUT_MS);
  
  return handle;
}

/**
 * Capture each browser's page screenshot and composite into a 2x2 grid.
 * Uses Playwright page.screenshot() (works regardless of Windows session).
 * Composites by reusing one of the already-open Chromium browsers to render
 * an HTML grid page — avoids needing standard Playwright browsers installed.
 */
async function captureAndCompositeTiledScreenshot(
  handlePairs: { handle: SessionHandle; backend: string }[],
  outputPath: string
): Promise<void> {
  console.log(`Capturing individual page screenshots from ${handlePairs.length} browsers...`);
  const screenshotDir = path.resolve(process.cwd(), "tile-screenshots");
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  const screenshotPaths: string[] = [];
  const labels: string[] = [];
  for (const { handle, backend } of handlePairs) {
    const ssPath = path.join(screenshotDir, `${backend}.png`);
    try {
      await handle.page.screenshot({ path: ssPath, fullPage: false });
      screenshotPaths.push(ssPath);
      labels.push(backend);
      console.log(`  📸 ${backend}: captured`);
    } catch (e: any) {
      console.warn(`  ⚠️ ${backend}: screenshot failed — ${e.message.slice(0, 80)}`);
    }
  }

  // Find a Chromium-based handle to reuse for the composite rendering
  // (stealth is Camoufox/Firefox — skip it, use cloak/spider/zendriver)
  const chromiumHandle = handlePairs.find(h =>
    !h.backend.includes("stealth")
  );

  if (!chromiumHandle) {
    console.log(`No Chromium handle available for composite. Individual screenshots saved to ${screenshotDir}`);
    return;
  }

  try {
    // Open a new page in the existing browser context
    const ctx = chromiumHandle.handle.context || chromiumHandle.handle.page.context();
    const compositePage = await ctx.newPage();
    await compositePage.setViewportSize({ width: 1920, height: 1080 });

    // Build HTML with embedded base64 images
    const imgTags = screenshotPaths.map((p, i) => {
      const b64 = fs.readFileSync(p).toString("base64");
      const label = labels[i] || `backend-${i}`;
      return `<div class="tile">
        <div class="label">✅ ${label} — LOGGED IN</div>
        <img src="data:image/png;base64,${b64}" />
      </div>`;
    }).join("\n");

    const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; width: 1920px; height: 1080px; }
  .tile { position: relative; overflow: hidden; }
  .tile img { width: 100%; height: 100%; object-fit: cover; }
  .label { position: absolute; top: 0; left: 0; right: 0; background: rgba(0,0,0,0.7); color: #0f0; font: bold 18px monospace; padding: 8px 14px; z-index: 10; }
</style></head><body>${imgTags}</body></html>`;

    await compositePage.setContent(html, { waitUntil: "load" });
    await new Promise(r => setTimeout(r, 1000)); // Let base64 images decode
    await compositePage.screenshot({ path: outputPath, fullPage: false });
    console.log(`\n🖼️  Composite tiled screenshot saved to: ${outputPath}`);
    await compositePage.close().catch(() => {});
  } catch (e: any) {
    console.error(`Composite failed: ${e.message}. Individual screenshots are in ${screenshotDir}`);
  }
}

async function main() {
  console.log("Starting 4-backend concurrent tiling test...");
  
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    for (const targetName of testTargets) {
      console.log(`\n=== TILE TEST ATTEMPT ${attempt} - TARGET: ${targetName} ===\n`);
      nukeAllBrowsers();
      await new Promise(r => setTimeout(r, 3000));
      
      const backends = ["cloak-headed", "stealth-headed", "cloak-headed-nocloak", "zendriver-headed"];
      const tiler = new BrowserTiler(4);
      tiler.reconfigure(4, { cols: 2, rows: 2 });
      
      // Stagger launches by 5 seconds each to reduce CPU contention
      const promises = backends.map(async (backend, i) => {
        await new Promise(r => setTimeout(r, i * 5000));
        console.log(`[${backend}] Launching (stagger offset: ${i * 5}s) for ${targetName}...`);
        return runGoldenFlow(backend, targetName).catch(err => {
          console.error(`[${backend}] ❌ Flow Failed: ${err.message}`);
          throw err;
        });
      });
      
      const results = await Promise.allSettled(promises);
      
      let successCount = 0;
      const handles: SessionHandle[] = [];
      
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res.status === 'fulfilled') {
          successCount++;
          handles.push(res.value);
          console.log(`  ✅ ${backends[i]}: PASS`);
        } else {
          console.log(`  ❌ ${backends[i]}: FAIL — ${res.reason?.message?.slice(0, 120) || 'unknown'}`);
        }
      }
      
      console.log(`\nResult for ${targetName}: ${successCount}/4 backends succeeded.`);
      
      if (successCount === 4) {
        console.log(`All 4 backends logged in successfully for ${targetName}!`);
        
        // Give them a moment to render the final state
        await new Promise(r => setTimeout(r, 3000));
        
        // Build handle+backend pairs for screenshot capture
        const handlePairs: { handle: SessionHandle; backend: string }[] = [];
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') {
            handlePairs.push({ handle: (results[i] as PromiseFulfilledResult<SessionHandle>).value, backend: backends[i] });
          }
        }
        
        const screenshotPath = path.resolve(process.cwd(), `desktop-verification-${targetName}.png`);
        await captureAndCompositeTiledScreenshot(handlePairs, screenshotPath);
        
        for (const h of handles) {
          await h.close().catch(() => {});
        }
        nukeAllBrowsers();
        console.log(`✅ Golden Tile Test completed perfectly for ${targetName}.`);
      } else {
        console.error(`Attempt ${attempt} failed for ${targetName}. Cleaning up...`);
        for (const h of handles) {
          await h.close().catch(() => {});
        }
        nukeAllBrowsers();
        await new Promise(r => setTimeout(r, 2000));
        
        if (attempt === MAX_ATTEMPTS) {
          console.error(`❌ Max attempts (${MAX_ATTEMPTS}) reached for ${targetName}. Best result: ${successCount}/4.`);
          process.exit(1);
        }
      }
    }
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  nukeAllBrowsers();
  process.exit(1);
});
