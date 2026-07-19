/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment*/
import path from 'node:path';
import { createLogger } from "../core/logger.js";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { extractKeyFrames } from "./video-extraction.js";

const log = createLogger("video-verifier");

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AiVerdict =
  | "disabled"         // "Your account has been disabled" / permdisabled
  | "temp-disabled"    // "temporarily disabled" / tempdisabled
  | "wrong-password"   // "incorrect password" / noaccount-via-exhaustion
  | "no-account"       // "no account found" / explicit noaccount
  | "success"          // logged in successfully
  | "2fa"              // two-factor auth prompt
  | "unclear";         // model couldn't determine

export interface VerificationResult {
  aiVerdict: AiVerdict;
  confidence: "high" | "medium" | "low";
  matches: boolean;           // AI agrees with engine outcome
  reasoning: string;          // one-line AI explanation
  framesAnalyzed: number;
  modelUsed: string;
  durationMs: number;
  /** False when the verifier could not actually inspect the recording (no API
   *  key, no extractable frames, model timed out, unparseable response). The
   *  engine uses this to gate signal-missing fallbacks instead of treating an
   *  empty verdict as a real "no-match" result. */
  signalAvailable?: boolean;
}

export interface VerificationJob {
  email: string;
  rowIndex: number;
  autoBurnCandidate?: boolean; // True if the credential was all-terminal-bad and should be burned if AI matches
  sites: Array<{
    name: string;
    engineOutcome: string;
    videoPath: string;
  }>;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_AGENT_PLATFORM_API_KEY || "").trim();
const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const LOCAL_MINICPM_URL = (process.env.LOCAL_MINICPM_URL || "").trim();

// eslint-disable-next-line no-constant-binary-expression
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview" || "gemini-2.5-flash";
const OPENROUTER_MODEL_NAME = process.env.OPENROUTER_MODEL || "google/gemini-1.5-pro";
const MINICPM_MODEL_NAME = process.env.LOCAL_MINICPM_MODEL || "minicpm-v:latest";
const GEMINI_TIMEOUT_MS = 30_000;

let IS_GEMINI_VALID = !!GEMINI_API_KEY;
const IS_OPENROUTER_VALID = !!OPENROUTER_API_KEY;
const IS_MINICPM_VALID = !!LOCAL_MINICPM_URL;

export function isVerificationAvailable(): boolean {
  return IS_GEMINI_VALID || IS_OPENROUTER_VALID || IS_MINICPM_VALID;
}

// ─── Frame Extraction ──────────────────────────────────────────────────────────
// ─── AI Verification ───────────────────────────────────────────────────────────

const VERIFICATION_PROMPT = `You are analyzing screenshots from a casino website login automation recording.

Your task: Determine what happened on this login page based on the visual evidence.

CRITICAL PRIORITY RULES - YOU MUST EVALUATE THESE STRINGS FIRST BEFORE LOOKING FOR ANYTHING ELSE:
1. "temp-disabled" → You see "temporarily disabled", "too many failed attempts", "locked out", "try again in", "try again later", or "too many attempts".
2. "disabled" → You see "permanently disabled", "account closed", "been disabled", "account suspended", or "no longer active".
3. "wrong-password" → You see "incorrect" (and none of the above are present).

ONLY IF NONE OF THE ABOVE CORE KEYWORDS ARE VISIBLE, EVALUATE THE FOLLOWING:
- "success" → The user appears logged in (dashboard, account page, cashier visible)
- "2fa" → You see a two-factor authentication prompt (authenticator, SMS code)
- "no-account" → You see only screenshots of that email on that site with incorrect on most or all and none with any other key word or phrase or success indicator
- "unclear" → Cannot determine from the frames

IMPORTANT: Focus on the last 3 frames — they show the end state after login attempts.
You MUST prioritize checking for the exact strings listed in the top 3 priority rules before evaluating structural/layout changes.`;

/**
 * Send extracted frames to Gemini or OpenRouter vision and get a verdict.
 */
export async function classifyWithAI(
  frames: Buffer[],
  engineOutcome: string,
  siteName: string,
): Promise<VerificationResult> {
  if (!GEMINI_API_KEY && !OPENROUTER_API_KEY && !LOCAL_MINICPM_URL) {
    return {
      aiVerdict: "unclear",
      confidence: "low",
      matches: true,  // default to trusting engine when AI unavailable
      reasoning: "AI verification unavailable — no API key or local endpoint configured",
      framesAnalyzed: 0,
      modelUsed: "none",
      durationMs: 0,
      signalAvailable: false,
    };
  }

  if (frames.length === 0) {
    return {
      aiVerdict: "unclear",
      confidence: "low",
      matches: true,
      reasoning: "No frames available for analysis",
      framesAnalyzed: 0,
      modelUsed: GEMINI_API_KEY ? MODEL_NAME : (LOCAL_MINICPM_URL ? MINICPM_MODEL_NAME : OPENROUTER_MODEL_NAME),
      durationMs: 0,
      signalAvailable: false,
    };
  }

  const start = Date.now();
  const usedModel = GEMINI_API_KEY ? MODEL_NAME : (LOCAL_MINICPM_URL ? MINICPM_MODEL_NAME : OPENROUTER_MODEL_NAME);

  try {
    // Structured output schema
    const responseSchema = {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          description: "One of: disabled, temp-disabled, wrong-password, no-account, success, 2fa, unclear",
        },
        confidence: {
          type: "string",
          description: "One of: high, medium, low",
        },
        reasoning: {
          type: "string",
          description: "One sentence explaining what you see",
        },
      },
      required: ["verdict", "confidence", "reasoning"],
    };

    let attempts = 0;
    let responseText = "";

    if (GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: MODEL_NAME });

      const parts: Part[] = [];
      for (const frame of frames) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: frame.toString("base64") } });
      }
      parts.push({ text: `Site: ${siteName}\n\n${VERIFICATION_PROMPT}` });

      while (attempts < 3) {
        try {
          let timer: NodeJS.Timeout;
          const result = await Promise.race([
            model.generateContent({
              contents: [{ role: "user", parts }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema as any,
              }
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
            })
          ]).finally(() => clearTimeout(timer!));
          responseText = result.response.text().trim();
          break;
        } catch (err: unknown) {
          attempts++;
          const msg = (err instanceof Error ? err.message : String(err)) || String(err);
          const durationMs = Date.now() - start;

          if (msg.includes("429") || msg.toLowerCase().includes("too many requests")) {
            if (attempts >= 3) throw err instanceof Error ? err : new Error(String(err));
            const backoff = Math.pow(2, attempts) * 1000 + Math.random() * 1000;
            log.warn(`AI API rate limited (429). Retrying in ${Math.round(backoff)}ms...`);
            await new Promise(r => setTimeout(r, backoff));
          } else if (msg.includes("50") || msg.toLowerCase().includes("timeout")) { 
            if (attempts >= 3) throw err;
            const backoff = 2000;
            log.warn(`AI API server error (${msg}). Retrying in ${backoff}ms...`);
            await new Promise(r => setTimeout(r, backoff));
          } else if (msg.includes("40") && !msg.includes("429")) { 
            log.error(`AI API client error: ${msg}. Disabling verification for this session.`);
            return { aiVerdict: "unclear", confidence: "low", matches: true, reasoning: `AI API client error: ${msg}`, framesAnalyzed: frames.length, modelUsed: usedModel, durationMs, signalAvailable: false };
          } else {
            if (attempts >= 3) throw err;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
    } else {
      // Local MiniCPM or OpenRouter Fallback via OpenAI Compatible Endpoint
      const isLocal = !GEMINI_API_KEY && LOCAL_MINICPM_URL;
      const endpoint = isLocal ? LOCAL_MINICPM_URL : "https://openrouter.ai/api/v1/chat/completions";
      const modelName = isLocal ? MINICPM_MODEL_NAME : OPENROUTER_MODEL_NAME;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!isLocal) {
        headers["Authorization"] = `Bearer ${OPENROUTER_API_KEY}`;
        headers["HTTP-Referer"] = "http://localhost:3000";
        headers["X-Title"] = "Automati1-111 Vision";
      }

      const messages = [
        {
          role: "user",
          content: [
            ...frames.map(frame => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${frame.toString("base64")}` }
            })),
            { type: "text", text: `Site: ${siteName}\n\n${VERIFICATION_PROMPT}\n\nReturn EXACTLY a JSON object with: {"verdict": "...", "confidence": "...", "reasoning": "..."}` }
          ]
        }
      ];

      while (attempts < 3) {
        try {
          let timer: NodeJS.Timeout;
          const result = await Promise.race([
            fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: modelName,
                messages,
                response_format: { type: "json_object" }
              })
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("API timeout")), GEMINI_TIMEOUT_MS);
            })
          ]).finally(() => clearTimeout(timer!));
          
          if (!(result).ok) {
            throw new Error(`OpenRouter HTTP error: ${(result).status} ${(result).statusText}`);
          }
          const json = await (result).json();
          responseText = json.choices[0].message.content.trim();
          break;
        } catch (err: unknown) {
          attempts++;
          const msg = (err instanceof Error ? err.message : String(err)) || String(err);
          const durationMs = Date.now() - start;

          if (msg.includes("429") || msg.toLowerCase().includes("too many requests")) {
            if (attempts >= 3) throw err instanceof Error ? err : new Error(String(err));
            const backoff = Math.pow(2, attempts) * 1000 + Math.random() * 1000;
            log.warn(`AI API rate limited (429). Retrying in ${Math.round(backoff)}ms...`);
            await new Promise(r => setTimeout(r, backoff));
          } else if (msg.includes("50") || msg.toLowerCase().includes("timeout")) { 
            if (attempts >= 3) throw err;
            const backoff = 2000;
            log.warn(`AI API server error (${msg}). Retrying in ${backoff}ms...`);
            await new Promise(r => setTimeout(r, backoff));
          } else if (msg.includes("40") && !msg.includes("429")) { 
            log.error(`AI API client error: ${msg}. Disabling verification for this session.`);
            return { aiVerdict: "unclear", confidence: "low", matches: true, reasoning: `AI API client error: ${msg}`, framesAnalyzed: frames.length, modelUsed: usedModel, durationMs, signalAvailable: false };
          } else {
            if (attempts >= 3) throw err;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
    }

    const durationMs = Date.now() - start;

    let parsed: { verdict?: string; confidence?: string; reasoning?: string };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      log.warn(`AI response not valid JSON: ${responseText.slice(0, 200)}`);
      return { aiVerdict: "unclear", confidence: "low", matches: true, reasoning: `Failed to parse AI response: ${responseText.slice(0, 100)}`, framesAnalyzed: frames.length, modelUsed: usedModel, durationMs, signalAvailable: false };
    }

    const aiVerdict = normalizeVerdict(parsed.verdict || "unclear");
    const confidence = (parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low") ? parsed.confidence : "low";
    const matches = checkMatch(engineOutcome, aiVerdict);

    return { aiVerdict, confidence, matches, reasoning: parsed.reasoning || "No reasoning provided", framesAnalyzed: frames.length, modelUsed: usedModel, durationMs, signalAvailable: true };
  } catch (err) {
    const durationMs = Date.now() - start;
    log.warn(`AI verification failed: ${err instanceof Error ? err.message : String(err)}`);
    return { aiVerdict: "unclear", confidence: "low", matches: true, reasoning: `AI API error: ${err instanceof Error ? err.message : String(err)}`, framesAnalyzed: frames.length, modelUsed: GEMINI_API_KEY ? MODEL_NAME : OPENROUTER_MODEL_NAME, durationMs, signalAvailable: false };
  }
}

function normalizeVerdict(raw: string): AiVerdict {
  const lower = raw.toLowerCase().trim();
  const map: Record<string, AiVerdict> = {
    "disabled": "disabled",
    "temp-disabled": "temp-disabled",
    "temporarily-disabled": "temp-disabled",
    "tempdisabled": "temp-disabled",
    "wrong-password": "wrong-password",
    "incorrect": "wrong-password",
    "no-account": "no-account",
    "noaccount": "no-account",
    "success": "success",
    "2fa": "2fa",
    "unclear": "unclear",
  };
  return map[lower] || "unclear";
}

/**
 * Check if AI verdict matches the engine's outcome.
 *
 * Mapping: engine outcome → expected AI verdicts that would agree
 *   permdisabled → disabled
 *   tempdisabled → temp-disabled
 *   noaccount    → wrong-password OR no-account (both mean "didn't get in")
 *   success      → success
 *   2FA          → 2fa
 */
function checkMatch(engineOutcome: string, aiVerdict: AiVerdict): boolean {
  switch (engineOutcome) {
    case "permdisabled":
      return aiVerdict === "disabled";
    case "tempdisabled":
      return aiVerdict === "temp-disabled";
    case "noaccount":
      // "noaccount" in engine = exhausted all passwords with "incorrect" responses.
      // AI seeing "wrong-password" or "no-account" both agree with this.
      return aiVerdict === "wrong-password" || aiVerdict === "no-account";
    case "success":
      return aiVerdict === "success";
    case "2FA":
      return aiVerdict === "2fa";
    case "honeypot":
      // Honeypot pages often look like real login pages but aren't.
      // If AI sees wrong-password, disabled, or no-account, that's consistent.
      // If AI sees success, that contradicts the honeypot classification.
      return aiVerdict !== "success";
    case "skipped":
    case "N/A":
    case "queued":
    case "testing":
      // Non-terminal outcomes — don't dispute
      return true;
    default:
      return true; // don't dispute unknown outcomes
  }
}

// ─── High-Level Verification API ───────────────────────────────────────────────

/**
 * Verify a single site's recording for a credential row.
 * Extracts frames → sends to AI → returns result.
 */
export async function verifySiteRecording(
  videoPath: string,
  engineOutcome: string,
  siteName: string,
): Promise<VerificationResult> {
  log.info(`🤖 Verifying ${siteName} recording: ${path.basename(videoPath)} (engine=${engineOutcome})`);

  const frames = await extractKeyFrames(videoPath);
  if (frames.length === 0) {
    log.warn(`  No frames extracted from ${path.basename(videoPath)} — skipping AI verification`);
    return {
      aiVerdict: "unclear",
      confidence: "low",
      matches: true,
      reasoning: "No frames could be extracted from recording",
      framesAnalyzed: 0,
      modelUsed: MODEL_NAME,
      durationMs: 0,
      signalAvailable: false,
    };
  }

  const result = await classifyWithAI(frames, engineOutcome, siteName);

  const icon = result.matches ? "✓" : "⚠";
  const level = result.matches ? "info" : "warn";
  log[level](
    `  🤖 ${icon} AI verdict: ${result.aiVerdict} (${result.confidence}) ` +
    `${result.matches ? "agrees" : "DISAGREES"} with engine=${engineOutcome} — ` +
    `${result.reasoning} [${result.durationMs}ms, ${result.framesAnalyzed} frames]`
  );

  return result;
}

/**
 * Process a full verification job (all sites for one credential row).
 * Returns per-site results.
 */
export async function processVerificationJob(
  job: VerificationJob,
): Promise<Map<string, VerificationResult>> {
  const results = new Map<string, VerificationResult>();

  for (const site of job.sites) {
    try {
      const result = await verifySiteRecording(site.videoPath, site.engineOutcome, site.name);
      results.set(site.name, result);
    } catch (err) {
      log.warn(`Verification failed for ${site.name}/${job.email}: ${err instanceof Error ? err.message : String(err)}`);
      results.set(site.name, {
        aiVerdict: "unclear",
        confidence: "low",
        matches: true,
        reasoning: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
        framesAnalyzed: 0,
        modelUsed: MODEL_NAME,
        durationMs: 0,
        signalAvailable: false,
      });
    }
  }

  return results;
}

/**
 * Validates that the configured AI verification endpoint is valid.
 * Fails fast so the app can warn the user on startup.
 */
export async function validateAiConfig(): Promise<boolean> {
  if (LOCAL_MINICPM_URL) {
    log.info(`🤖 Local MiniCPM endpoint configured at ${LOCAL_MINICPM_URL}`);
    return true; // Assume local endpoint is valid if configured
  }

  if (OPENROUTER_API_KEY && !GEMINI_API_KEY) {
    log.info("🤖 OpenRouter API key configured. Vision verification armed.");
    return true;
  }

  if (!GEMINI_API_KEY) {
    log.warn("No AI API key or local endpoint configured. AI verification features will be disabled.");
    IS_GEMINI_VALID = false;
    return false;
  }

  try {
    log.info("🤖 Validating Gemini API Key access...");
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    // Quick test generation to verify quota and auth
    let timer: NodeJS.Timeout;
    await Promise.race([
      model.generateContent("hello"),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Timeout")), 10000); })
    ]).finally(() => clearTimeout(timer!));
    
    log.info("✅ Gemini API Key validated successfully. Vision verification is fully armed.");
    IS_GEMINI_VALID = true;
    return true;
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)) || String(err);
    if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("too many requests")) {
      log.error(`🚨 Gemini API Key is valid but has exhausted its quota or is rate limited: ${msg}`);
    } else if (msg.includes("40") && !msg.includes("429")) {
      log.error(`🚨 Gemini API Key is INVALID or permissions are denied: ${msg}`);
      IS_GEMINI_VALID = false;
      return false;
    } else {
      log.warn(`⚠️ Could not reach Gemini API (${msg}). Will still attempt verification during run.`);
    }
    IS_GEMINI_VALID = true;
    return true;
  }
}
