/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment*/
/**
 * AI-powered video verification for login-outcome recordings.
 *
 * Extracts key frames from .webm recordings via ffmpeg, sends them to
 * Gemini 2.5 Flash vision, and returns a structured verification result.
 *
 * Purpose: prevents false denylist burns on "all-terminal-bad" outcomes
 * (double noaccount, double permdisabled, or mixed) by cross-checking
 * the engine's DOM-based verdict against what a vision model actually
 * sees in the recording.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from "../core/logger.js";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";

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

// eslint-disable-next-line no-constant-binary-expression
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview" || "gemini-2.5-flash";
const OPENROUTER_MODEL_NAME = process.env.OPENROUTER_MODEL || "google/gemini-1.5-pro";

const MAX_FRAMES = 4;
const FRAME_POSITIONS = [0.25, 0.50, 0.75, 0.90]; // fallback % of video duration
const FFMPEG_FRAME_TIMEOUT_MS = 25_000;
const GEMINI_TIMEOUT_MS = 30_000;

let IS_GEMINI_VALID = !!GEMINI_API_KEY;
let IS_OPENROUTER_VALID = !!OPENROUTER_API_KEY;

export function isVerificationAvailable(): boolean {
  return IS_GEMINI_VALID || IS_OPENROUTER_VALID;
}

// ─── Frame Extraction ──────────────────────────────────────────────────────────

/**
 * Extract key frames from a .webm recording using ffmpeg.
 * Returns JPEG buffers for each extracted frame.
 */
export async function extractKeyFrames(
  videoPath: string,
  positions: number[] = FRAME_POSITIONS,
): Promise<Buffer[]> {
  const isRemote = videoPath.startsWith("http://") || videoPath.startsWith("https://");
  if (!isRemote && !fs.existsSync(videoPath)) {
    log.warn(`Video not found: ${videoPath}`);
    return [];
  }

  const ffmpegPath = await getFfmpegPath();
  if (!ffmpegPath) {
    log.warn("ffmpeg not available for frame extraction");
    return [];
  }

  const vvFramesBase = path.join(process.cwd(), ".vv-frames");
  await fs.promises.mkdir(vvFramesBase, { recursive: true });
  const tmpDir = await fs.promises.mkdtemp(path.join(vvFramesBase, "job-"));
  const frames: Buffer[] = [];

  try {
    const { spawn } = await import("child_process");

    // Attempt adaptive scene detection extraction first
    await new Promise<void>((resolve, reject) => {
      const outPattern = path.join(tmpDir, "adaptive-%03d.jpg");
      // eslint-disable-next-line prefer-const
      let proc: import("child_process").ChildProcess;
      
      const timeout = setTimeout(() => {
        if (proc) proc.kill("SIGKILL");
        reject(new Error("ffmpeg adaptive frame extraction timed out"));
      }, FFMPEG_FRAME_TIMEOUT_MS);

      proc = spawn(ffmpegPath, [
        "-i", videoPath,
        "-vf", "select='gt(scene,0.3)'",
        "-vsync", "vfr",
        "-frames:v", String(MAX_FRAMES),
        "-q:v", "2",
        "-y",
        outPattern,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      proc.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const dirFiles = await fs.promises.readdir(tmpDir);
    const extractedFiles = dirFiles.filter(f => f.startsWith("adaptive-")).sort();

    if (extractedFiles.length > 0) {
      // Scene detection worked
      for (const file of extractedFiles) {
        frames.push(await fs.promises.readFile(path.join(tmpDir, file)));
      }
    } else {
      // Fallback to old time-based extraction if scene detection found 0 frames
      log.warn(`Scene detection yielded 0 frames, falling back to time-based extraction`);
      let duration = 0;
      for (let attempt = 1; attempt <= 3; attempt++) {
        duration = await getVideoDuration(ffmpegPath, videoPath);
        if (duration > 0) break;
        if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
      }

      if (duration > 0) {
        const extractionPromises = positions.slice(0, MAX_FRAMES).map(async (pos, i) => {
          const timestamp = duration * pos;
          const outPath = path.join(tmpDir, `frame-${i}.jpg`);

          await new Promise<void>((resolve, reject) => {
            // eslint-disable-next-line prefer-const
            let proc: import("child_process").ChildProcess;
            const timeout = setTimeout(() => {
              if (proc) proc.kill("SIGKILL");
              reject(new Error("ffmpeg frame extraction timed out"));
            }, FFMPEG_FRAME_TIMEOUT_MS);

            proc = spawn(ffmpegPath, [
              "-ss", String(timestamp),
              "-i", videoPath,
              "-frames:v", "1",
              "-q:v", "2",         // high quality JPEG
              "-y",                // overwrite
              outPath,
            ], { stdio: ["ignore", "pipe", "pipe"] });

            proc.on("close", (code) => {
              clearTimeout(timeout);
              if (code === 0 && fs.existsSync(outPath)) resolve();
              else reject(new Error(`ffmpeg frame extraction failed (exit ${code})`));
            });
            proc.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          });

          if (fs.existsSync(outPath)) {
            return fs.promises.readFile(outPath);
          }
          return null;
        });

        const results = await Promise.all(extractionPromises);
        for (const res of results) {
          if (res) frames.push(res);
        }
      }
    }
  } catch (err) {
    log.warn(`Frame extraction error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Cleanup temp directory
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }

  return frames;
}

async function getVideoDuration(ffmpegPath: string, videoPath: string): Promise<number> {
  const ffprobePath = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  const { spawn } = await import("child_process");

  return new Promise<number>((resolve) => {
    // Try ffprobe first, fall back to ffmpeg -i
    const bin = fs.existsSync(ffprobePath) ? ffprobePath : ffmpegPath;
    const args = bin.endsWith("ffprobe")
      ? ["-v", "quiet", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath]
      : ["-i", videoPath];

    let output = "";
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve(0);
    }, 12000);

    proc.on("close", () => {
      clearTimeout(timeout);
      // Try parsing ffprobe output (plain number)
      const plain = parseFloat(output.trim());
      if (Number.isFinite(plain) && plain > 0) { resolve(plain); return; }
      // Try parsing ffmpeg -i output (Duration: HH:MM:SS.ss)
      const m = output.match(/Duration:\s+(\d+):(\d+):(\d+)\.(\d+)/);
      if (m) {
        // @ts-expect-error noUncheckedIndexedAccess
        const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100;
        resolve(secs);
        return;
      }
      resolve(0);
    });
    proc.on("error", () => { clearTimeout(timeout); resolve(0); });
  });
}

async function getFfmpegPath(): Promise<string | null> {
  try {
    const ffmpegStatic = await import("ffmpeg-static");
    const p = (ffmpegStatic.default || ffmpegStatic) as unknown as string;
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through */ }

  // Check system PATH
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    const { stdout } = await execAsync("which ffmpeg", { encoding: "utf-8" });
    const result = stdout.trim();
    if (result && fs.existsSync(result)) return result;
  } catch { /* not on PATH */ }

  return null;
}

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
  if (!GEMINI_API_KEY && !OPENROUTER_API_KEY) {
    return {
      aiVerdict: "unclear",
      confidence: "low",
      matches: true,  // default to trusting engine when AI unavailable
      reasoning: "AI verification unavailable — no API key configured",
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
      modelUsed: GEMINI_API_KEY ? MODEL_NAME : OPENROUTER_MODEL_NAME,
      durationMs: 0,
      signalAvailable: false,
    };
  }

  const start = Date.now();
  const usedModel = GEMINI_API_KEY ? MODEL_NAME : OPENROUTER_MODEL_NAME;

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
      // OpenRouter Fallback
      const messages = [
        {
          role: "user",
          content: [
            ...frames.map(frame => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${frame.toString("base64")}` }
            })),
            { type: "text", text: `Site: ${siteName}\n\n${VERIFICATION_PROMPT}` }
          ]
        }
      ];

      while (attempts < 3) {
        try {
          let timer: NodeJS.Timeout;
          const result = await Promise.race([
            fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Automati1-111 Vision"
              },
              body: JSON.stringify({
                model: OPENROUTER_MODEL_NAME,
                messages,
                response_format: { type: "json_object" }
              })
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("OpenRouter API timeout")), GEMINI_TIMEOUT_MS);
            })
          ]).finally(() => clearTimeout(timer!));
          
          if (!(result as Response).ok) {
            throw new Error(`OpenRouter HTTP error: ${(result as Response).status} ${(result as Response).statusText}`);
          }
          const json = await (result as Response).json();
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
 * Validates that the configured Gemini API key is valid and has quota by performing a minimal generation.
 * Fails fast so the app can warn the user on startup instead of discovering during a recording verification.
 */
export async function validateGeminiApiKey(): Promise<boolean> {
  if (!GEMINI_API_KEY) {
    log.warn("GEMINI_API_KEY is not configured. AI verification features will be disabled.");
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
    ]).finally(() => clearTimeout(timer));
    
    log.info("✅ Gemini API Key validated successfully. Vision verification is fully armed.");
    IS_GEMINI_VALID = true;
    return true;
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)) || String(err);
    if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("too many requests")) {
      log.error(`🚨 Gemini API Key is valid but has exhausted its quota or is rate limited: ${msg}`);
    } else if (msg.includes("40") && !msg.includes("429")) {
      log.error(`🚨 Gemini API Key is INVALID or permissions are denied: ${msg}`);
    } else {
      log.error(`🚨 Gemini API Key validation failed due to network/server error: ${msg}`);
    }
    IS_GEMINI_VALID = false;
    return false;
  }
}
