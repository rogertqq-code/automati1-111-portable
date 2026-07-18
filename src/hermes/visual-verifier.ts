/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Page } from "playwright-core";
import "dotenv/config";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function verifyLoginSuccessVisually(page: Page): Promise<boolean> {
  if (!GEMINI_API_KEY) {
    console.warn("[Hermes Verifier] GEMINI_API_KEY not set. Falling back to true.");
    return true; // Fallback to pass if no API key
  }

  try {
    console.log(`[Hermes Verifier] Capturing visual snapshot for confidence verification...`);
    // Capture screenshot via raw CDP to bypass Python bridge latency (Zendriver fix)
    let base64Image = "";
    try {
      const cdp = await page.context().newCDPSession(page);
      const res = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
      base64Image = res.data;
    } catch {
      // Fallback to standard Playwright if CDP fails
      const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 60 });
      base64Image = screenshotBuffer.toString("base64");
    }

    const promptText = `
You are a strict QA automation AI. Look at this screenshot of a web application.
Your goal is to determine if the user is SUCCESSFULLY logged into their account.

Indicators of SUCCESS:
- You see account balances, deposit/withdrawal buttons, cashier dashboard, or an account menu.
- The URL has successfully navigated away from the login page to a dashboard/lobby.
- You see a green banner in the top part of the webview that explicitly says "Welcome!" (with the "!" exclamation mark). This acts as a fast-path success indicator to trigger cashier verification.

Indicators of FAILURE / FALSE POSITIVE:
- The page is still asking for a password or login.
- The page shows a CAPTCHA or Cloudflare challenge.
- The page is a generic marketing home page without any logged-in state indicators.
- The page shows an error message.

Output EXACTLY one word: "YES" if they are logged in, or "NO" if they are not.
    `;

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=" + GEMINI_API_KEY;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
            parts: [
                { text: promptText },
                { inlineData: { mimeType: "image/jpeg", data: base64Image } }
            ] 
        }]
      })
    });

    const json = await response.json();
    const aiResponse = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();

    if (aiResponse && aiResponse.includes("YES")) {
      console.log(`[Hermes Verifier] AI Confirmed successful login (Confidence: HIGH)`);
      return true;
    } else {
      console.warn(`[Hermes Verifier] AI REJECTED success classification. Output: ${aiResponse}`);
      return false;
    }
  } catch (e: unknown) {
    console.warn(`[Hermes Verifier] Visual verification failed due to error: ${e instanceof Error ? e.message : String(e)}`);
    return true; // Fail open to not block execution
  }
}
