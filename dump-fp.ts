import { createSession } from "./backends/index.js";
import fs from "fs";

async function dumpFp() {
  const backend = "stealth-headed";
  console.log(`Starting ${backend} for FP dump...`);
  const opts = {
    backend: backend as any,
    headless: false,
    liveTest: true,
    email: "joedoe@example.com",
    cleanSession: true,
    recordVideo: false,
    useHttpCloak: true,
    injectStealthJS: true
  };
  
  const handle = await createSession(opts);
  const page = handle.page;
  
  const reports: any[] = [];
  
  page.on("response", async (res) => {
    if (res.url().includes("api.fpjs.io") || res.url().includes("fingerprint.com") || res.url().includes("fpjs")) {
      try {
        const json = await res.json();
        if (json && json.products) {
          reports.push(json);
        }
      } catch (e) {}
    }
  });

  console.log("Navigating to playground...");
  await page.goto("https://demo.fingerprint.com/playground", { waitUntil: "domcontentloaded", timeout: 45000 });
  
  // Wait for score to populate
  await page.waitForFunction(
    () => (document.body.innerText || '').match(/suspect\s*score/i),
    { timeout: 20000 }
  ).catch(() => {});
  
  await new Promise(r => setTimeout(r, 5000));
  
  // Also dump innerText of the warning sections
  const warnings = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.SuspectScoreCard_reason__*, [class*="reason"], [class*="warning"]')).map(el => (el as HTMLElement).innerText);
  }).catch(() => []);
  
  const allText = await page.evaluate(() => document.body.innerText).catch(() => "");
  
  const dump = {
    backend,
    apiReports: reports,
    warningsFromDOM: warnings,
    fullText: allText
  };
  
  fs.writeFileSync("fp-dump.json", JSON.stringify(dump, null, 2));
  console.log("Dumped to fp-dump.json");
  
  await handle.close();
  process.exit(0);
}

dumpFp().catch(console.error);
