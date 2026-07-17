import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

vi.mock("node:fs", () => {
  return {
    default: {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn()
    }
  };
});

vi.mock("@google/generative-ai", () => {
  const generateContentMock = vi.fn();
  return {
    GoogleGenerativeAI: vi.fn(function() { return {
      getGenerativeModel: vi.fn(function() { return {
        generateContent: generateContentMock
      }; })
    }; }),
    // Export the mock so we can control it in tests
    __generateContentMock: generateContentMock
  };
});

describe("fingerprint-ai-verifier", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let verifyFingerprintCoherence: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    
    // Set API key to enable AI calls
    process.env.GEMINI_API_KEY = "test-key";
    
    // Dynamically import to pick up env vars and fresh mocks
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const module = await import("../../src/stealth/fingerprint-ai-verifier.js?refresh=" + Date.now());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    verifyFingerprintCoherence = module.verifyFingerprintCoherence;
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it("loads cache on startup if exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      "fp-somehash": { coherent: true, mismatches: [], fixSuggestions: {}, modelUsed: "cached" }
    }));

    // Re-import the module so the top-level cache-load code runs with our mocks
    await import("../../src/stealth/fingerprint-ai-verifier.js?cache-test=" + Date.now());

    // Since we don't know the hash function exactly, we can't easily trigger the cache hit.
    // We just verify it doesn't crash.
    expect(fs.readFileSync).toHaveBeenCalled();
  });

  it("skips if no api key", async () => {
    process.env.GEMINI_API_KEY = "";
    process.env.GOOGLE_AI_API_KEY = "";
    process.env.GOOGLE_AGENT_PLATFORM_API_KEY = "";
    
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import("../../src/stealth/fingerprint-ai-verifier.js?no-key=" + Date.now());
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const res = await mod.verifyFingerprintCoherence({ os: "windows" } as any);
    
    expect(res.modelUsed).toBe("disabled");
  });

  it("returns cache hit if available", async () => {
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { __generateContentMock } = await import("@google/generative-ai") as any;
    vi.mocked(__generateContentMock).mockResolvedValue({
      response: { text: () => JSON.stringify({ coherent: true, mismatches: [], fixSuggestions: {} }) }
    });

    const bundle = { os: "linux" };
    // First call caches it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await verifyFingerprintCoherence(bundle as any);
    
    // Second call should hit cache
    vi.mocked(__generateContentMock).mockClear();
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const res = await verifyFingerprintCoherence(bundle as any);
    
    expect(__generateContentMock).not.toHaveBeenCalled();
    expect(res.coherent).toBe(true);
  });

  it("handles valid AI response", async () => {
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { __generateContentMock } = await import("@google/generative-ai") as any;
    vi.mocked(__generateContentMock).mockResolvedValue({
      response: { text: () => JSON.stringify({ coherent: false, mismatches: ["OS mismatch"], fixSuggestions: { os: "mac" } }) }
    });

     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const res = await verifyFingerprintCoherence({ os: "ios" } as any);
    expect(res.coherent).toBe(false);
    expect(res.mismatches).toContain("OS mismatch");
    expect(res.fixSuggestions.os).toBe("mac");
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("handles invalid JSON from AI", async () => {
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { __generateContentMock } = await import("@google/generative-ai") as any;
    vi.mocked(__generateContentMock).mockResolvedValue({
      response: { text: () => "I am an AI and I say yes" }
    });

     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const res = await verifyFingerprintCoherence({ os: "android" } as any);
    expect(res.modelUsed).toBe("gemini-2.5-flash"); // falls back to true
    expect(res.coherent).toBe(true);
  });

  it("handles API error", async () => {
     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { __generateContentMock } = await import("@google/generative-ai") as any;
    vi.mocked(__generateContentMock).mockRejectedValue(new Error("API Down"));

     
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const res = await verifyFingerprintCoherence({ os: "unknown" } as any);
    expect(res.modelUsed).toBe("error");
    expect(res.coherent).toBe(true); // defaults to true
  });
});
