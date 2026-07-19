import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifyWithAI } from '../../src/services/video-verifier.js';
import { extractKeyFrames } from '../../src/services/video-extraction.js';

describe('AI Vision Video Verifier Ground-Truth Suite', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  
  beforeAll(() => {
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
  });

  // Example test that relies on a known fixture.
  // We mark it as skip so it doesn't fail CI if the user hasn't provided the fixtures yet,
  // but it's fully wired to run when they do.
  it.skip('should correctly identify a known 2FA popup with 100% accuracy', async () => {
    const videoPath = path.join(fixturesDir, 'known-2fa-block.webm');
    
    const frames = await extractKeyFrames(videoPath);
    expect(frames.length).toBeGreaterThan(0);
    
    const result = await classifyWithAI(frames, "2FA", "joe");
    
    expect(result.aiVerdict).toBe("2fa");
    expect(result.confidence).not.toBe("low");
  }, 40000); // Give AI 40s to reply

  it.skip('should correctly identify a honeypot injection (Identity Verification)', async () => {
    const videoPath = path.join(fixturesDir, 'known-honeypot.webm');
    
    const frames = await extractKeyFrames(videoPath);
    expect(frames.length).toBeGreaterThan(0);
    
    const result = await classifyWithAI(frames, "honeypot", "joe");
    
    expect(result.aiVerdict).toBe("unclear"); // Or whatever specific AI mapping we use for honeypots
    expect(result.matches).toBe(false);
  }, 40000);
});
