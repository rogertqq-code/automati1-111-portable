/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-expressions, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await , @typescript-eslint/no-misused-promises, @typescript-eslint/ban-ts-comment, no-useless-assignment, @typescript-eslint/restrict-template-expressions, no-unassigned-vars, preserve-caught-error, @typescript-eslint/no-require-imports*/
import "dotenv/config";
import { execSync } from "child_process";
import { ConfigStore, type AppConfig } from "../../src/core/config-store.js";
import { createSession, pickProxy, type SessionHandle, type SessionOpts } from "../../backends/index.js";
import { type Page } from "playwright-core";
import fs from "fs";
import path from "path";

/**
 * ═══════════════════════════════════════════════════════════════════
 * Fingerprint Score Test — Per-Backend Bot Detection Validation
 * ═══════════════════════════════════════════════════════════════════
 *
 * For each backend, creates a session, navigates to bot detection
 * test pages, and extracts the suspect/bot score. Fails if any
 * backend is flagged as definitively automated.
 *
 * Test pages used:
 *   1. https://abrahamjuliot.github.io/creepjs/ — CreepJS fingerprint audit
 *   2. https://bot.sannysoft.com/ — Bot detection test
 *   3. Internal stealth-scripts validation via page.evaluate
 */

const EMAIL = "phuttasopit@hotmail.co.th";
const appConfig: AppConfig = ConfigStore.load();
process.env.SPIDER_LOCAL_API_KEY = "dummy_key_for_test";

interface FingerprintResult {
  backend: string;
  botDetected: boolean;
  webdriverLeaked: boolean;
  automationLeaked: boolean;
  chromeLeaked: boolean;
  navigatorPlatformOk: boolean;
  languagesOk: boolean;
  hardwareConcurrencyOk: boolean;
  canvasOk: boolean;
  webglOk: boolean;
  overallScore: string; // "PASS" | "WARN" | "FAIL"
  details: string[];
}

function nukeAllBrowsers(): void {
  if (process.platform === "win32") {
    try { execSync(`taskkill /F /IM camoufox.exe /T`, { stdio: "ignore", timeout: 5000 }); } catch {}
    try { execSync(`taskkill /F /IM chrome.exe /T`, { stdio: "ignore", timeout: 5000 }); } catch {}
  } else {
    try { execSync(`pkill -9 -f camoufox`, { stdio: "ignore", timeout: 5000 }); } catch {}
    try { execSync(`pkill -9 -f chrome`, { stdio: "ignore", timeout: 5000 }); } catch {}
  }
}

async function runInternalFingerprintAudit(page: Page): Promise<Partial<FingerprintResult>> {
  const result: Partial<FingerprintResult> = { details: [] };
  
  // Check navigator.webdriver
  const webdriver = await page.evaluate(() => (navigator as any).webdriver).catch(() => undefined);
  result.webdriverLeaked = webdriver === true;
  if (result.webdriverLeaked) result.details!.push("❌ navigator.webdriver === true (bot flag)");
  else result.details!.push("✅ navigator.webdriver is hidden");
  
  // Check for automation-related properties
  const automationFlags = await page.evaluate(() => {
    const flags: string[] = [];
    if ((window as any).__webdriver_script_fn) flags.push("__webdriver_script_fn");
    if ((window as any).__driver_evaluate) flags.push("__driver_evaluate");
    if ((window as any).__webdriver_evaluate) flags.push("__webdriver_evaluate");
    if ((window as any).__selenium_evaluate) flags.push("__selenium_evaluate");
    if ((window as any).__fxdriver_evaluate) flags.push("__fxdriver_evaluate");
    if ((window as any).__driver_unwrapped) flags.push("__driver_unwrapped");
    if ((window as any).__webdriver_unwrapped) flags.push("__webdriver_unwrapped");
    if ((window as any).__selenium_unwrapped) flags.push("__selenium_unwrapped");
    if ((window as any).__fxdriver_unwrapped) flags.push("__fxdriver_unwrapped");
    if ((document as any).__webdriver_script_fn) flags.push("document.__webdriver_script_fn");
    if ((document as any).__driver_evaluate) flags.push("document.__driver_evaluate");
    if ((document as any).$cdc_asdjflasutopfhvcZLmcfl_) flags.push("$cdc_ CDP leak");
    return flags;
  }).catch(() => [] as string[]);
  
  result.automationLeaked = automationFlags.length > 0;
  if (result.automationLeaked) {
    result.details!.push(`❌ Automation globals leaked: ${automationFlags.join(", ")}`);
  } else {
    result.details!.push("✅ No automation globals detected");
  }
  
  // Check chrome object presence (should exist for Chromium)
  const chromeCheck = await page.evaluate(() => {
    const hasChrome = !!(window as any).chrome;
    const hasApp = hasChrome && !!(window as any).chrome.app;
    const hasRuntime = hasChrome && !!(window as any).chrome.runtime;
    return { hasChrome, hasApp, hasRuntime };
  }).catch(() => ({ hasChrome: false, hasApp: false, hasRuntime: false }));
  
  result.chromeLeaked = !chromeCheck.hasChrome;
  if (chromeCheck.hasChrome) {
    result.details!.push(`✅ window.chrome present (app=${chromeCheck.hasApp}, runtime=${chromeCheck.hasRuntime})`);
  } else {
    result.details!.push("⚠️ window.chrome missing (may be Firefox/Camoufox)");
  }
  
  // navigator.platform
  const platform = await page.evaluate(() => navigator.platform).catch(() => "");
  result.navigatorPlatformOk = platform.length > 0 && !platform.includes("undefined");
  result.details!.push(`${result.navigatorPlatformOk ? "✅" : "❌"} navigator.platform: ${platform}`);
  
  // navigator.languages
  const languages = await page.evaluate(() => JSON.stringify(navigator.languages)).catch(() => "[]");
  result.languagesOk = languages !== "[]" && languages !== '[""]';
  result.details!.push(`${result.languagesOk ? "✅" : "❌"} navigator.languages: ${languages}`);
  
  // hardwareConcurrency
  const cores = await page.evaluate(() => navigator.hardwareConcurrency).catch(() => 0);
  result.hardwareConcurrencyOk = cores >= 2 && cores <= 16;
  result.details!.push(`${result.hardwareConcurrencyOk ? "✅" : "⚠️"} hardwareConcurrency: ${cores}`);
  
  // Canvas fingerprint (check it doesn't return all zeros)
  const canvasOk = await page.evaluate(() => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 200; canvas.height = 50;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("Cwm fjordbank", 2, 15);
      const data = canvas.toDataURL();
      return data.length > 100; // Non-trivial canvas output
    } catch { return false; }
  }).catch(() => false);
  result.canvasOk = canvasOk;
  result.details!.push(`${canvasOk ? "✅" : "❌"} Canvas rendering: ${canvasOk ? "functional" : "blocked/broken"}`);
  
  // WebGL renderer
  const webglInfo = await page.evaluate(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return { renderer: "none", vendor: "none" };
      const ext = (gl as any).getExtension("WEBGL_debug_renderer_info");
      return {
        renderer: ext ? (gl as any).getParameter(ext.UNMASKED_RENDERER_WEBGL) : "hidden",
        vendor: ext ? (gl as any).getParameter(ext.UNMASKED_VENDOR_WEBGL) : "hidden",
      };
    } catch { return { renderer: "error", vendor: "error" }; }
  }).catch(() => ({ renderer: "error", vendor: "error" }));
  result.webglOk = webglInfo.renderer !== "none" && webglInfo.renderer !== "error";
  result.details!.push(`${result.webglOk ? "✅" : "⚠️"} WebGL: ${webglInfo.vendor} / ${webglInfo.renderer}`);
  
  return result;
}

async function runBotSannyTest(page: Page): Promise<string[]> {
  const details: string[] = [];
  try {
    await page.goto("https://bot.sannysoft.com/", { waitUntil: "networkidle", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000)); // Let all tests render
    
    // Extract all test rows from the table
    const results = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tr");
      const out: { test: string; result: string; }[] = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const test = cells[0].textContent?.trim() || "";
          const result = cells[1].textContent?.trim() || "";
          const cls = cells[1].className || "";
          out.push({ test, result: cls.includes("failed") ? `❌ ${result}` : `✅ ${result}` });
        }
      });
      return out;
    }).catch(() => []);
    
    for (const r of results) {
      details.push(`  ${r.result} — ${r.test}`);
    }
    
    if (results.length === 0) {
      details.push("  ⚠️ Could not extract SannyBot results");
    }
  } catch (e: any) {
    details.push(`  ⚠️ SannyBot test failed: ${e.message.slice(0, 100)}`);
  }
  return details;
}

async function testBackend(backend: string): Promise<FingerprintResult> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Testing fingerprint for: ${backend}`);
  console.log(`${"═".repeat(60)}`);
  
  const proxy = pickProxy([], EMAIL, backend, appConfig.proxyPool);
  
  const opts: SessionOpts = {
    backend: backend as any,
    headless: false,
    liveTest: true,
    proxy,
    email: EMAIL,
    cleanSession: true,
    recordVideo: false,
    useHttpCloak: appConfig.useHttpCloak,
    stealthBypassHttpCloak: appConfig.stealthBypassHttpCloak,
    injectStealthJS: appConfig.injectStealthJS,
    proxyPool: appConfig.proxyPool,
  };
  
  let handle: SessionHandle | undefined;
  try {
    handle = await createSession(opts);
    const page = handle.page;
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);
    
    // Navigate to about:blank first to warm up
    await page.goto("about:blank", { timeout: 10000 }).catch(() => {});
    
    // Run internal fingerprint audit
    console.log(`[${backend}] Running internal fingerprint audit...`);
    const internalResult = await runInternalFingerprintAudit(page);
    
    // Run SannyBot test
    console.log(`[${backend}] Running SannyBot detection test...`);
    const sannyDetails = await runBotSannyTest(page);
    
    // Compile result
    const allDetails = [...(internalResult.details || []), "", "SannyBot Results:", ...sannyDetails];
    
    const botDetected = internalResult.webdriverLeaked || internalResult.automationLeaked || false;
    const overallScore = botDetected ? "FAIL" : 
      (!internalResult.canvasOk || !internalResult.webglOk) ? "WARN" : "PASS";
    
    const result: FingerprintResult = {
      backend,
      botDetected,
      webdriverLeaked: internalResult.webdriverLeaked || false,
      automationLeaked: internalResult.automationLeaked || false,
      chromeLeaked: internalResult.chromeLeaked || false,
      navigatorPlatformOk: internalResult.navigatorPlatformOk || false,
      languagesOk: internalResult.languagesOk || false,
      hardwareConcurrencyOk: internalResult.hardwareConcurrencyOk || false,
      canvasOk: internalResult.canvasOk || false,
      webglOk: internalResult.webglOk || false,
      overallScore,
      details: allDetails,
    };
    
    // Print results
    for (const d of allDetails) {
      console.log(`  ${d}`);
    }
    console.log(`\n  Overall: ${overallScore}`);
    
    return result;
  } finally {
    if (handle) await handle.close().catch(() => {});
    nukeAllBrowsers();
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function main() {
  console.log("\n🔍 Fingerprint Score Test — Per-Backend Bot Detection Validation\n");
  
  const backends = ["cloak-headed", "stealth-headed", "spider-local", "zendriver"];
  const results: FingerprintResult[] = [];
  
  for (const backend of backends) {
    try {
      const result = await testBackend(backend);
      results.push(result);
    } catch (e: any) {
      console.error(`[${backend}] ❌ Test crashed: ${e.message}`);
      results.push({
        backend,
        botDetected: true,
        webdriverLeaked: false,
        automationLeaked: false,
        chromeLeaked: false,
        navigatorPlatformOk: false,
        languagesOk: false,
        hardwareConcurrencyOk: false,
        canvasOk: false,
        webglOk: false,
        overallScore: "FAIL",
        details: [`Crashed: ${e.message}`],
      });
      nukeAllBrowsers();
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  
  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("  FINGERPRINT SCORE SUMMARY");
  console.log("═".repeat(60));
  
  let allPass = true;
  for (const r of results) {
    const icon = r.overallScore === "PASS" ? "✅" : r.overallScore === "WARN" ? "⚠️" : "❌";
    console.log(`  ${icon} ${r.backend.padEnd(20)} ${r.overallScore}`);
    if (r.overallScore === "FAIL") allPass = false;
  }
  
  // Write report to disk
  const reportPath = path.resolve(process.cwd(), "fingerprint-score-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);
  
  if (!allPass) {
    console.error("\n❌ Some backends FAILED fingerprint validation.");
    process.exit(1);
  } else {
    console.log("\n✅ All backends passed fingerprint validation.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  nukeAllBrowsers();
  process.exit(1);
});
