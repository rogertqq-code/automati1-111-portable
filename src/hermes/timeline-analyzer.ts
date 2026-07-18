import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import type { TimelineManifest } from "../services/timeline-recorder.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export class TimelineAnalyzer {
  static async analyzeTimeline(sessionId: string): Promise<string | null> {
    const sessionDir = path.join(process.cwd(), "screenshots", "timelines", sessionId);
    const manifestPath = path.join(sessionDir, "timeline-manifest.json");

    if (!fs.existsSync(manifestPath)) {
      console.warn(`[TimelineAnalyzer] Manifest not found for session ${sessionId}`);
      return null;
    }

    if (!GEMINI_API_KEY) {
      console.warn("[TimelineAnalyzer] GEMINI_API_KEY not set.");
      return null;
    }

    const manifest: TimelineManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (manifest.frames.length === 0) {
      console.warn(`[TimelineAnalyzer] No frames found in timeline for ${sessionId}`);
      return null;
    }

    // Limit to max 15 frames for AI token limits (take evenly spaced samples if > 15)
    let selectedFrames = manifest.frames;
    if (selectedFrames.length > 15) {
      const step = Math.ceil(selectedFrames.length / 15);
      selectedFrames = selectedFrames.filter((_, i) => i % step === 0).slice(0, 15);
    }

    const contents = [];
    const promptText = `
You are Hermes AI, the ultimate QA automation engineer.
I am providing you a sequence of screenshots captured every 500ms during an automated browser execution on a specific target site.
These screenshots represent the visual timeline of the execution.

Your task:
1. Identify if the login was successful or if it failed.
2. If it failed, point out exactly which step (timestamp/offset) the failure or anomaly occurred (e.g., CAPTCHA appeared, page crashed, incorrect password error, Cloudflare block).
3. Evaluate the automation's interaction based on the visual evidence. Did it type credentials? Did it click submit? Was it blocked before it could?

Provide a structured, chronological breakdown of the execution timeline and your final diagnostic conclusion.
    `;
    
    contents.push({ text: promptText });

    for (const frame of selectedFrames) {
      const imgPath = path.join(sessionDir, frame.imagePath);
      if (fs.existsSync(imgPath)) {
        const base64Image = fs.readFileSync(imgPath).toString("base64");
        contents.push({ text: `Timeline Offset: +${frame.offsetMs}ms` });
        contents.push({
          inlineData: { mimeType: "image/jpeg", data: base64Image }
        });
      }
    }

    try {
      console.log(`[TimelineAnalyzer] Dispatching ${selectedFrames.length} frames to Gemini for session ${sessionId}...`);
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=" + GEMINI_API_KEY;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: contents }]
        })
      });

      const json = await response.json();
      const aiResponse = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (aiResponse) {
        console.log(`[TimelineAnalyzer] Analysis complete for ${sessionId}`);
        
        // Write analysis to the timeline folder for review
        const analysisPath = path.join(sessionDir, "hermes-analysis.md");
        fs.writeFileSync(analysisPath, aiResponse);
        
        return aiResponse;
      } else {
        console.warn(`[TimelineAnalyzer] AI returned empty or invalid response.`, json);
        return null;
      }
    } catch (e: unknown) {
      console.warn(`[TimelineAnalyzer] Analysis failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
