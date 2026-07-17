import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getElementCoordinatesFromVision } from "../../src/intelligence/ai-vision-fallback.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn(),
  };
});

describe("ai-vision-fallback", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns null if GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
    
    const mockPage = { screenshot: vi.fn() };
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await getElementCoordinatesFromVision(mockPage as any, "login button");
    
    expect(result).toBeNull();
    expect(mockPage.screenshot).not.toHaveBeenCalled();
  });

  it("returns coordinates successfully when AI finds them", async () => {
    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot"))
    };

    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => 'Found it here: {"x": 123, "y": 456} at the top right.'
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

     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await getElementCoordinatesFromVision(mockPage as any, "login button");
    
    expect(result).toEqual({ x: 123, y: 456 });
    expect(mockPage.screenshot).toHaveBeenCalledWith({ fullPage: false });
  });

  it("returns null when AI returns error JSON", async () => {
    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot"))
    };

    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => '{"error": "not found"}'
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

     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await getElementCoordinatesFromVision(mockPage as any, "missing button");
    expect(result).toBeNull();
  });

  it("returns null when AI returns invalid format", async () => {
    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot"))
    };

    const mockGenerateContent = vi.fn().mockResolvedValue({
      response: {
        text: () => 'I could not find any JSON here.'
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

     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await getElementCoordinatesFromVision(mockPage as any, "login button");
    expect(result).toBeNull();
  });

  it("returns null and catches exception when AI call fails", async () => {
    const mockPage = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot"))
    };

    const mockGenerateContent = vi.fn().mockRejectedValue(new Error("API offline"));

    vi.mocked(GoogleGenerativeAI).mockImplementation(function() {
      return {
        getGenerativeModel: () => ({
          generateContent: mockGenerateContent
        })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });

     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await getElementCoordinatesFromVision(mockPage as any, "login button");
    expect(result).toBeNull();
  });
});
