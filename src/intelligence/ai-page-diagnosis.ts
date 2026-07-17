/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * AI Screenshot Self-Diagnosis — Improvement #1
 *
 * When a login attempt fails with a non-decisive outcome, this module
 * screenshots the page and sends it to Gemini Vision to diagnose
 * what the user is actually seeing: CAPTCHA, overlay, error message,
 * cookie wall, bot challenge, etc.
 *
 * This enables intelligent retry strategies instead of blind retries.
 */
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { createLogger } from "../core/logger.js";

const log = createLogger("ai-diagnosis");

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_AGENT_PLATFORM_API_KEY || "").trim();
const MODEL_NAME = "gemini-2.5-flash";
const DIAGNOSIS_TIMEOUT_MS = 15_000;

export interface AiDiagnosis {
  /** Recommended action for the engine */
  action: "retry" | "dismiss_overlay" | "solve_captcha" | "switch_backend" | "abort" | "continue";
  /** What was detected on the page */
  pageState: "captcha" | "cookie_wall" | "error_message" | "bot_challenge" | "overlay" | "login_form" | "logged_in" | "unknown";
  /** Type of CAPTCHA if detected */
  captchaType?: "recaptcha" | "turnstile" | "hcaptcha" | "funcaptcha" | "custom" | null;
  /** Human-readable description of what was seen */
  details: string;
  /** Confidence level */
  confidence: "high" | "medium" | "low";
  /** Whether AI analysis was actually performed */
  signalAvailable: boolean;
  /** Processing time */
  durationMs: number;
}

const DIAGNOSIS_PROMPT = `You are an expert automation engineer analyzing a screenshot of a web page during an automated login attempt.

Analyze the screenshot and determine:
1. What is currently visible on the page?
2. Is there anything blocking the login flow?
3. What should the automation do next?

CLASSIFICATION RULES for pageState:
- "captcha" → A CAPTCHA challenge is visible (reCAPTCHA, Turnstile, hCaptcha, FunCaptcha, or custom image challenge)
- "cookie_wall" → A cookie consent banner or GDPR overlay is blocking interaction
- "bot_challenge" → A bot detection challenge page (Cloudflare "checking your browser", DataDome, Akamai challenge)
- "overlay" → Any non-login overlay/modal blocking the form (popup, ad, notification prompt)
- "error_message" → An error message is visible (wrong password, account disabled, rate limited, etc.)
- "login_form" → The login form is visible and ready for interaction
- "logged_in" → The user appears to be successfully logged in
- "unknown" → Cannot determine the page state

ACTION RULES:
- "retry" → The login form is visible, just retry the input (e.g., field wasn't filled correctly)
- "dismiss_overlay" → There's a dismissable overlay/cookie wall — click dismiss/accept/close first
- "solve_captcha" → A CAPTCHA needs solving before proceeding
- "switch_backend" → Bot challenge detected, this backend is likely fingerprinted — try another
- "abort" → Unrecoverable state (account disabled, permanent block)
- "continue" → Page looks normal, continue with login flow

If a CAPTCHA is detected, also identify the captchaType:
- "recaptcha" → Google reCAPTCHA (v2 checkbox or v3 invisible)
- "turnstile" → Cloudflare Turnstile
- "hcaptcha" → hCaptcha
- "funcaptcha" → FunCaptcha/Arkose Labs
- "custom" → Any other type of challenge

Return ONLY valid JSON matching this schema.`;

/**
 * Diagnose the current page state using AI vision.
 * Takes a screenshot buffer (PNG/JPEG) and returns actionable diagnosis.
 */
export async function aiDiagnosePage(
  screenshotBuffer: Buffer,
  context?: string,
): Promise<AiDiagnosis> {
  if (!GEMINI_API_KEY) {
    return {
      action: "continue",
      pageState: "unknown",
      details: "AI diagnosis unavailable — no Gemini API key",
      confidence: "low",
      signalAvailable: false,
      durationMs: 0,
    };
  }

  const start = Date.now();

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const parts: Part[] = [
      {
        inlineData: {
          mimeType: "image/png",
          data: screenshotBuffer.toString("base64"),
        },
      },
      {
        text: `${context ? `Context: ${context}\n\n` : ""}${DIAGNOSIS_PROMPT}`,
      },
    ];

    const responseSchema = {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "One of: retry, dismiss_overlay, solve_captcha, switch_backend, abort, continue",
        },
        pageState: {
          type: "string",
          description: "One of: captcha, cookie_wall, error_message, bot_challenge, overlay, login_form, logged_in, unknown",
        },
        captchaType: {
          type: "string",
          description: "If CAPTCHA detected: recaptcha, turnstile, hcaptcha, funcaptcha, custom, or null",
        },
        details: {
          type: "string",
          description: "Brief description of what is visible on the page",
        },
        confidence: {
          type: "string",
          description: "One of: high, medium, low",
        },
      },
      required: ["action", "pageState", "details", "confidence"],
    };

    let timer: NodeJS.Timeout;
    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema as Parameters<typeof model.generateContent>[0] extends { generationConfig?: { responseSchema?: infer S } } ? S : never,
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI diagnosis timeout")), DIAGNOSIS_TIMEOUT_MS);
      })
    ]).finally(() => clearTimeout(timer));

    const responseText = result.response.text().trim();
    const durationMs = Date.now() - start;

    let parsed: { action?: string; pageState?: string; captchaType?: string | null; details?: string; confidence?: string };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      log.warn(`AI diagnosis response not valid JSON: ${responseText.slice(0, 200)}`);
      return {
        action: "continue",
        pageState: "unknown",
        details: `Failed to parse AI response: ${responseText.slice(0, 100)}`,
        confidence: "low",
        signalAvailable: false,
        durationMs,
      };
    }

    const validActions = new Set(["retry", "dismiss_overlay", "solve_captcha", "switch_backend", "abort", "continue"]);
    const validStates = new Set(["captcha", "cookie_wall", "error_message", "bot_challenge", "overlay", "login_form", "logged_in", "unknown"]);

    const diagnosis: AiDiagnosis = {
      action: validActions.has(parsed.action ?? "") ? parsed.action as AiDiagnosis["action"] : "continue",
      pageState: validStates.has(parsed.pageState ?? "") ? parsed.pageState as AiDiagnosis["pageState"] : "unknown",
      captchaType: (parsed.captchaType as AiDiagnosis["captchaType"]) || null,
      details: parsed.details || "No details provided",
      confidence: (["high", "medium", "low"] as const).includes(parsed.confidence as "high" | "medium" | "low") ? parsed.confidence as AiDiagnosis["confidence"] : "low",
      signalAvailable: true,
      durationMs,
    };

    log.info(
      `🤖 AI Diagnosis: [${diagnosis.pageState}] → ${diagnosis.action} ` +
      `(${diagnosis.confidence}) — ${diagnosis.details} [${durationMs}ms]`
    );

    return diagnosis;
  } catch (err) {
    const durationMs = Date.now() - start;
    log.warn(`AI diagnosis failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      action: "continue",
      pageState: "unknown",
      details: `AI API error: ${err instanceof Error ? err.message : String(err)}`,
      confidence: "low",
      signalAvailable: false,
      durationMs,
    };
  }
}

/**
 * Quick pre-login CAPTCHA check — Improvement #4
 * Lightweight check specifically for CAPTCHA/bot challenge presence.
 */
export async function aiDetectCaptcha(
  screenshotBuffer: Buffer,
): Promise<{ hasCaptcha: boolean; type: string | null; hasBotChallenge: boolean }> {
  const diagnosis = await aiDiagnosePage(screenshotBuffer, "Pre-login page check — looking for CAPTCHAs or bot challenges");

  return {
    hasCaptcha: diagnosis.pageState === "captcha",
    type: diagnosis.captchaType || null,
    hasBotChallenge: diagnosis.pageState === "bot_challenge",
  };
}
