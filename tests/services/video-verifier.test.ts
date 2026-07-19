import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// We mock before imports
vi.mock("@google/generative-ai", () => {
  const generateContentMock = vi.fn();
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { generateContent: generateContentMock };
      }
    },
    __generateContentMock: generateContentMock
  };
});

vi.mock("child_process", () => {
  const spawnMock = vi.fn();
  const execMock = vi.fn();
  return {
    spawn: spawnMock,
    exec: execMock,
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      promises: {
        ...actual.promises,
        readdir: vi.fn(),
        readFile: vi.fn(),
        rm: vi.fn(),
        mkdtemp: vi.fn(),
      }
    },
    existsSync: vi.fn(),
    promises: {
      ...actual.promises,
      readdir: vi.fn(),
      readFile: vi.fn(),
      rm: vi.fn(),
      mkdtemp: vi.fn(),
    }
  };
});

vi.mock("ffmpeg-static", () => ({ default: "/fake/ffmpeg" }));

import {
  isVerificationAvailable,
  extractKeyFrames,
  classifyWithAI,
  verifySiteRecording,
  processVerificationJob,
  validateAiConfig
} from "../../src/services/video-verifier.js";

 
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { __generateContentMock } = await import("@google/generative-ai") as any;
const cp = await import("child_process");

describe("video-verifier", () => {
  let isVerificationAvailable: any;
  let extractKeyFrames: any;
  let classifyWithAI: any;
  let verifySiteRecording: any;
  let processVerificationJob: any;
  let validateAiConfig: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.GEMINI_API_KEY = "fake-key";
    
    const mod = await import("../../src/services/video-verifier.js");
    isVerificationAvailable = mod.isVerificationAvailable;
    extractKeyFrames = mod.extractKeyFrames;
    classifyWithAI = mod.classifyWithAI;
    verifySiteRecording = mod.verifySiteRecording;
    processVerificationJob = mod.processVerificationJob;
    validateAiConfig = mod.validateAiConfig;
  });

  describe("isVerificationAvailable", () => {
    it("returns true if valid", async () => {
      // For testing, validate updates the state
      __generateContentMock.mockResolvedValueOnce({ response: { text: () => "hello" } });
      await validateAiConfig();
      expect(isVerificationAvailable()).toBe(true);
    });
  });

  describe("validateAiConfig", () => {
    it("returns false if no key is present", async () => {
      vi.resetModules();
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
      delete process.env.LOCAL_MINICPM_URL;
      const { validateAiConfig } = await import("../../src/services/video-verifier.js");
      const result = await validateAiConfig();
      expect(result).toBe(false);
      process.env.GEMINI_API_KEY = "fake-key";
    });

    it("returns false on API error and disables verification", async () => {
      __generateContentMock.mockRejectedValueOnce(new Error("403 Forbidden"));
      const result = await validateAiConfig();
      expect(result).toBe(false);
      expect(isVerificationAvailable()).toBe(false);
    });
  });

  describe("classifyWithAI", () => {
    const dummyBuffer = Buffer.from("dummy");

    it("returns unclear if GEMINI_API_KEY is empty", async () => {
      vi.resetModules();
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
      delete process.env.LOCAL_MINICPM_URL;
      const { classifyWithAI } = await import("../../src/services/video-verifier.js");
      const result = await classifyWithAI([dummyBuffer], "success", "TestSite");
      expect(result.aiVerdict).toBe("unclear");
      expect(result.signalAvailable).toBe(false);
      process.env.GEMINI_API_KEY = "fake-key";
    });

    it("returns unclear if no frames", async () => {
      const result = await classifyWithAI([], "success", "TestSite");
      expect(result.aiVerdict).toBe("unclear");
      expect(result.signalAvailable).toBe(false);
    });

    it("parses valid JSON response", async () => {
      __generateContentMock.mockResolvedValueOnce({
        response: { text: () => JSON.stringify({ verdict: "wrong-password", confidence: "high", reasoning: "saw error" }) }
      });
      const result = await classifyWithAI([dummyBuffer], "noaccount", "TestSite");
      expect(result.aiVerdict).toBe("wrong-password");
      expect(result.matches).toBe(true); // noaccount matches wrong-password
      expect(result.signalAvailable).toBe(true);
    });

    it("retries on 429 rate limit", async () => {
      __generateContentMock
        .mockRejectedValueOnce(new Error("429 Too Many Requests"))
        .mockResolvedValueOnce({
          response: { text: () => JSON.stringify({ verdict: "success", confidence: "high", reasoning: "ok" }) }
        });
      const result = await classifyWithAI([dummyBuffer], "success", "TestSite");
      expect(result.aiVerdict).toBe("success");
    });
    
    it("returns unclear on 400 series error (non 429)", async () => {
      __generateContentMock.mockRejectedValueOnce(new Error("403 Forbidden"));
      const result = await classifyWithAI([dummyBuffer], "success", "TestSite");
      expect(result.aiVerdict).toBe("unclear");
      expect(result.signalAvailable).toBe(false);
    });

    it("handles invalid JSON response", async () => {
      __generateContentMock.mockResolvedValueOnce({
        response: { text: () => "I think it failed but I didn't return JSON" }
      });
      const result = await classifyWithAI([dummyBuffer], "success", "TestSite");
      expect(result.aiVerdict).toBe("unclear");
      expect(result.signalAvailable).toBe(false);
    });
  });

  describe("extractKeyFrames", () => {
    it("returns empty array if file does not exist (and is local)", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const frames = await extractKeyFrames("/path/to/missing.webm");
      expect(frames).toEqual([]);
    });

    it("extracts frames via adaptive scene detection successfully", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.mkdtemp).mockResolvedValue("/tmp/vv-frames-123");
       
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      vi.mocked(fs.promises.readdir).mockResolvedValue(["adaptive-001.jpg", "adaptive-002.jpg"] as any);
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("img"));

      const mockSpawn = {
        on: vi.fn().mockImplementation((event, cb) => {
          if (event === "close") cb(0);
        }),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() }
      };
       
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      vi.mocked(cp.spawn).mockReturnValue(mockSpawn as any);

      const frames = await extractKeyFrames("http://remote.webm");
      expect(frames.length).toBe(2);
      expect(fs.promises.readdir).toHaveBeenCalledWith("/tmp/vv-frames-123");
      expect(fs.promises.rm).toHaveBeenCalledWith("/tmp/vv-frames-123", { recursive: true, force: true });
    });

    it("falls back to time-based extraction if adaptive yields 0 frames and uses ffprobe for duration", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => 
        p.toString().includes("remote.webm") || 
        p.toString().includes("ffprobe") ||
        p.toString().includes("ffmpeg") ||
        p.toString().includes("frame-")
      );
      vi.mocked(fs.promises.mkdtemp).mockResolvedValue("/tmp/vv-frames-123");
      // Adaptive returns nothing
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([]);

      let spawnCallCount = 0;
      const mockSpawn = {
        on: vi.fn().mockImplementation((event, cb) => {
          if (event === "close") cb(0);
        }),
        kill: vi.fn(),
        stdout: { 
          on: vi.fn().mockImplementation((event, cb) => {
            if (event === "data" && spawnCallCount === 2) { // 2nd spawn is ffprobe
              cb(Buffer.from("12.5\n"));
            }
          })
        },
        stderr: { on: vi.fn() }
      };
      
      vi.mocked(cp.spawn).mockImplementation(() => {
        spawnCallCount++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return mockSpawn as any;
      });

      // Mock readFile for the fallback frames
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("fallback-frame"));

      // Call extractKeyFrames
      const frames = await extractKeyFrames("http://remote.webm");
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0]).toEqual(Buffer.from("fallback-frame"));
    });

    it("falls back to time-based extraction and uses ffmpeg output if ffprobe fails", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => 
        p.toString().includes("remote.webm") ||
        p.toString().includes("ffmpeg") ||
        p.toString().includes("frame-")
      );
      vi.mocked(fs.promises.mkdtemp).mockResolvedValue("/tmp/vv-frames-123");
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([]);

      let spawnCallCount = 0;
      const mockSpawn = {
        on: vi.fn().mockImplementation((event, cb) => {
          if (event === "close") cb(0);
        }),
        kill: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { 
          on: vi.fn().mockImplementation((event, cb) => {
            if (event === "data" && spawnCallCount === 2) { // ffmpeg duration output
              cb(Buffer.from("  Duration: 00:01:23.45, start: 0.0\n"));
            }
          })
        }
      };
      
      vi.mocked(cp.spawn).mockImplementation(() => {
        spawnCallCount++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return mockSpawn as any;
      });

      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from("fallback-frame"));

      const frames = await extractKeyFrames("http://remote.webm");
      expect(frames.length).toBeGreaterThan(0);
    });
  });

  describe("verifySiteRecording", () => {
    it("returns unclear if frames extraction fails (0 frames)", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const res = await verifySiteRecording("/missing.webm", "success", "SiteA");
      expect(res.aiVerdict).toBe("unclear");
      expect(res.signalAvailable).toBe(false);
    });
  });

  describe("processVerificationJob", () => {
    it("processes all sites and returns a map", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // will cause 0 frames -> unclear
      const job = {
        email: "test@example.com",
        rowIndex: 0,
        sites: [
          { name: "SiteA", engineOutcome: "success", videoPath: "/missing.webm" }
        ]
      };
      const res = await processVerificationJob(job);
      expect(res.size).toBe(1);
      expect(res.get("SiteA")!.aiVerdict).toBe("unclear");
    });
  });
});
