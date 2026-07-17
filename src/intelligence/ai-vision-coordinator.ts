/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Page } from "playwright-core";

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_AGENT_PLATFORM_API_KEY || "").trim();

export interface VisionCoordinates {
  email: { x: number, y: number, w: number, h: number };
  password: { x: number, y: number, w: number, h: number };
  submit: { x: number, y: number, w: number, h: number };
}

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/**
 * Feeds a screenshot to Gemini Vision and returns a normalized percentage matrix
 * (0.0 to 1.0) for the X, Y, Width, and Height of the core login elements.
 */
export async function getViewportCoordinateMarkdown(page: Page): Promise<VisionCoordinates | null> {
  if (!GEMINI_API_KEY) {
    console.warn("[AIVision] GEMINI_API_KEY not set. Cannot map viewport coordinates.");
    return null;
  }

  if (Date.now() < circuitOpenUntil) {
    console.warn("[AIVision] Circuit breaker OPEN. Bypassing viewport coordinates mapping.");
    return null;
  }

  try {
    const imageBuffer = await page.screenshot({ fullPage: false });
    const imageBase64 = imageBuffer.toString('base64');

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // Use the fastest multimodal model available
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `Analyze this login page screenshot. Return the bounding box coordinates for the "Email/Username Input", "Password Input", and "Login/Submit Button".
    
    IMPORTANT: Provide the X and Y coordinates of the center of the element, and its Width (w) and Height (h), as decimal percentages of the total image dimensions (from 0.00 to 1.00).

    Reply ONLY with valid, parseable JSON in exactly this structure:
    {
      "email": { "x": 0.50, "y": 0.30, "w": 0.20, "h": 0.05 },
      "password": { "x": 0.50, "y": 0.40, "w": 0.20, "h": 0.05 },
      "submit": { "x": 0.50, "y": 0.50, "w": 0.20, "h": 0.05 }
    }
    If you cannot clearly see these elements, return {"error": "not found"}. Do not include markdown formatting like \`\`\`json.`;
    
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
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.email && parsed.password && parsed.submit) {
        consecutiveFailures = 0;
        return parsed as VisionCoordinates;
      }
    }
    return null;
  } catch (e) {
    console.error("[AIVision] Coordinate mapping failed:", e);
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      circuitOpenUntil = Date.now() + 60000;
      console.warn("[AIVision] Circuit breaker TRIPPED! API disabled for 60s.");
    }
    return null;
  }
}
