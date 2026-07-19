import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import { verifyLoginSuccessVisually } from '../../src/hermes/visual-verifier.js';
import { Page, BrowserContext, CDPSession } from 'playwright-core';

describe('verifyLoginSuccessVisually', () => {
  let mockPage: unknown;
  let mockContext: unknown;
  let mockCDP: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test_key';

    mockCDP = {
      send: vi.fn().mockResolvedValue({ data: 'mock_base64_image' }),
      detach: vi.fn().mockResolvedValue(undefined)
    };

    mockContext = {
      newCDPSession: vi.fn().mockResolvedValue(mockCDP)
    };

    mockPage = {
      context: vi.fn().mockReturnValue(mockContext),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('mock_base64_image'))
    };
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  test('should fallback to true if OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await verifyLoginSuccessVisually(mockPage as Page);
    expect(result).toBe(true);
  });

  test('should construct correct OpenRouter payload and return true on YES', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => 
      Promise.resolve({
        json: () => Promise.resolve({ choices: [{ message: { content: 'YES' } }] })
      } as Response)
    );

    const result = await verifyLoginSuccessVisually(mockPage as Page);
    
    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
    
    const fetchArgs = fetchSpy.mock.calls[0];
    expect(fetchArgs[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    
    const req = fetchArgs[1] as RequestInit;
    expect(req.method).toBe('POST');
    expect((req.headers as any)['Authorization']).toBe('Bearer test_key');
    
    const body = JSON.parse(req.body as string);
    expect(body.model).toBe('openbmb/minicpm-lcm-tutorial');
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,mock_base64_image');

    fetchSpy.mockRestore();
  });

  test('should return false if AI rejects success', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => 
      Promise.resolve({
        json: () => Promise.resolve({ choices: [{ message: { content: 'NO' } }] })
      } as Response)
    );

    const result = await verifyLoginSuccessVisually(mockPage as Page);
    expect(result).toBe(false);

    fetchSpy.mockRestore();
  });
});
