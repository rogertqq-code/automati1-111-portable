import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPersona } from "../../src/intelligence/ai-persona-generator.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn(),
  };
});

describe("ai-persona-generator", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    vi.spyOn(fs, "readFileSync").mockReturnValue("{}");
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv;
    vi.restoreAllMocks();
    vi.useRealTimers();
    // Reset cache module state if possible, or just use unique seeds
  });

  it("returns fallback persona if no API key is present", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;

    const persona = await getPersona(12345);
    expect(persona.source).toBe("fallback");
    expect(persona.typingWpm).toBeGreaterThanOrEqual(30);
    expect(persona.typingWpm).toBeLessThanOrEqual(80);
  });

  it("returns AI generated persona successfully", async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          typingWpm: 55,
          baseKeyDelayMs: 120,
          mouseSpeedMultiplier: 1.1,
          scrollSpeedMultiplier: 1.0,
          readingMsPerWord: 200,
          typoRate: 0.02,
          pauseTendency: 0.2,
          mouseJitter: 0.5,
          personaDescription: "AI Test Persona"
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

    const persona = await getPersona(99999);
    expect(persona.source).toBe("ai");
    expect(persona.typingWpm).toBe(55);
    expect(persona.personaDescription).toBe("AI Test Persona");
  });

  it("clamps AI generated values within safe ranges", async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          typingWpm: 999, // Way too high
          baseKeyDelayMs: 10, // Too low
          mouseSpeedMultiplier: 5.0, // Too high
          scrollSpeedMultiplier: 0.1, // Too low
          readingMsPerWord: 50, // Too low
          typoRate: 0.5, // Too high
          pauseTendency: 0.01, // Too low
          mouseJitter: 3.0, // Too high
          personaDescription: "Extreme Persona"
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

    const persona = await getPersona(88888);
    expect(persona.source).toBe("ai");
    expect(persona.typingWpm).toBe(100); // clamped max
    expect(persona.baseKeyDelayMs).toBe(40); // clamped min
    expect(persona.mouseSpeedMultiplier).toBe(1.8); // clamped max
  });

  it("falls back if AI returns invalid JSON", async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => "Not valid JSON"
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

    const persona = await getPersona(77777);
    expect(persona.source).toBe("fallback");
  });

  it("falls back if AI times out", async () => {
    const mockGenerateContent = vi.fn().mockImplementation(() => new Promise(() => {}));

    vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
      return {
        getGenerativeModel: () => ({
          generateContent: mockGenerateContent
        })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });

    const promise = getPersona(66666);
    await Promise.resolve();
    vi.advanceTimersByTime(16000);
    const persona = await promise;
    expect(persona.source).toBe("fallback");
  });
  
  it("caches the generated persona to avoid redundant calls", async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          typingWpm: 42,
          baseKeyDelayMs: 120,
          mouseSpeedMultiplier: 1.1,
          scrollSpeedMultiplier: 1.0,
          readingMsPerWord: 200,
          typoRate: 0.02,
          pauseTendency: 0.2,
          mouseJitter: 0.5,
          personaDescription: "AI Cached"
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

    const seed = 55555;
    const p1 = await getPersona(seed);
    const p2 = await getPersona(seed);
    
    expect(p1).toBe(p2);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
