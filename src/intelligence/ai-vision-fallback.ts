/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Page } from "playwright-core";

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export async function getElementCoordinatesFromVision(page: Page, elementDescription: string): Promise<{x: number, y: number} | null> {
  const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_AGENT_PLATFORM_API_KEY || "").trim();
  if (!GEMINI_API_KEY) {
    console.warn("[AIVision] GEMINI_API_KEY not set, cannot use visual fallback.");
    return null;
  }

  if (Date.now() < circuitOpenUntil) {
    console.warn("[AIVision] Circuit breaker OPEN. Bypassing visual fallback.");
    return null;
  }

  try {
    const imageBuffer = await page.screenshot({ fullPage: false });
    const imageBase64 = imageBuffer.toString('base64');

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
    
    const prompt = `Return the center coordinates (X and Y) of the "${elementDescription}" on this webpage screenshot. Reply in exactly this JSON format: {"x": 123, "y": 456}. If not found, reply with {"error": "not found"}.`;
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "image/png",
          data: imageBase64
        }
      }
    ]);
    
    const text = result.response.text();
    const match = text.match(/\{.*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.x !== undefined && parsed.y !== undefined) {
        consecutiveFailures = 0;
        return { x: parsed.x, y: parsed.y };
      }
    }
    return null;
  } catch (e) {
    console.error("[AIVision] Fallback failed:", e);
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      circuitOpenUntil = Date.now() + 60000;
      console.warn("[AIVision] Circuit breaker TRIPPED! API disabled for 60s.");
    }
    return null;
  }
}
