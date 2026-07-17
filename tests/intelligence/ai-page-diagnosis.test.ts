import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { aiDiagnosePage, aiDetectCaptcha } from "../../src/intelligence/ai-page-diagnosis.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn(),
  };
});

describe("ai-page-diagnosis", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("aiDiagnosePage", () => {
    it("returns 'unknown' if no API key is present", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
      
      const buffer = Buffer.from("fake-image");
      const result = await aiDiagnosePage(buffer);
      
      expect(result.signalAvailable).toBe(false);
      expect(result.pageState).toBe("unknown");
    });

    it("parses valid JSON response successfully", async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            action: "solve_captcha",
            pageState: "captcha",
            captchaType: "recaptcha",
            details: "found recaptcha",
            confidence: "high"
          })
        }
      });

      vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
        return {
          getGenerativeModel: () => ({
            generateContent: mockGenerateContent
          })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });

      const buffer = Buffer.from("fake-image");
      const result = await aiDiagnosePage(buffer, "test-context");

      expect(result.action).toBe("solve_captcha");
      expect(result.pageState).toBe("captcha");
      expect(result.captchaType).toBe("recaptcha");
      expect(result.confidence).toBe("high");
      expect(result.signalAvailable).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it("handles invalid JSON gracefully", async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          text: () => "Not valid JSON at all"
        }
      });

      vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
        return {
          getGenerativeModel: () => ({
            generateContent: mockGenerateContent
          })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });

      const buffer = Buffer.from("fake-image");
      const result = await aiDiagnosePage(buffer);

      expect(result.signalAvailable).toBe(false);
      expect(result.pageState).toBe("unknown");
    });

    it("falls back to default values when JSON contains invalid enum states", async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            action: "invalid_action",
            pageState: "invalid_state",
            details: "some details",
            confidence: "super-high"
          })
        }
      });

      vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
        return {
          getGenerativeModel: () => ({
            generateContent: mockGenerateContent
          })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });

      const buffer = Buffer.from("fake-image");
      const result = await aiDiagnosePage(buffer);

      expect(result.action).toBe("continue"); // Default fallback
      expect(result.pageState).toBe("unknown"); // Default fallback
      expect(result.confidence).toBe("low"); // Default fallback
      expect(result.signalAvailable).toBe(true);
    });

    it("handles API errors gracefully", async () => {
      const mockGenerateContent = vi.fn().mockRejectedValue(new Error("API Rate Limit"));

      vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
        return {
          getGenerativeModel: () => ({
            generateContent: mockGenerateContent
          })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });

      const buffer = Buffer.from("fake-image");
      const result = await aiDiagnosePage(buffer);

      expect(result.signalAvailable).toBe(false);
      expect(result.pageState).toBe("unknown");
      expect(result.details).toContain("API Rate Limit");
    });

    it("handles timeout gracefully", async () => {
      const mockGenerateContent = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves

      vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
        return {
          getGenerativeModel: () => ({
            generateContent: mockGenerateContent
          })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });

      const buffer = Buffer.from("fake-image");
      const promise = aiDiagnosePage(buffer);
      
      // Advance timers by more than 15s timeout
      await Promise.resolve(); // allow microtasks
      vi.advanceTimersByTime(16000);
      
      const result = await promise;

      expect(result.signalAvailable).toBe(false);
      expect(result.pageState).toBe("unknown");
      expect(result.details).toContain("timeout");
    });
  });

  describe("aiDetectCaptcha", () => {
    it("returns captcha info correctly when captcha detected", async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            action: "solve_captcha",
            pageState: "captcha",
            captchaType: "turnstile",
            details: "found turnstile",
            confidence: "high"
          })
        }
      });

      vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
        return {
          getGenerativeModel: () => ({
            generateContent: mockGenerateContent
          })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });

      const buffer = Buffer.from("fake-image");
      const result = await aiDetectCaptcha(buffer);

      expect(result.hasCaptcha).toBe(true);
      expect(result.type).toBe("turnstile");
      expect(result.hasBotChallenge).toBe(false);
    });

    it("returns bot challenge correctly", async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            action: "switch_backend",
            pageState: "bot_challenge",
            details: "cloudflare IUAM",
            confidence: "high"
          })
        }
      });

      vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
        return {
          getGenerativeModel: () => ({
            generateContent: mockGenerateContent
          })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });

      const buffer = Buffer.from("fake-image");
      const result = await aiDetectCaptcha(buffer);

      expect(result.hasCaptcha).toBe(false);
      expect(result.hasBotChallenge).toBe(true);
    });
  });
});
