import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import { healSelector } from '../../src/hermes/dom-healer.js';
import { Page } from 'playwright-core';

describe('healSelector', () => {
  let mockPage: unknown;
  let mockContext: unknown;
  let mockCDP: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test_key';

    mockCDP = {
      send: vi.fn().mockResolvedValue({ 
        result: { value: JSON.stringify({ tag: 'button', id: 'new-login' }) } 
      }),
      detach: vi.fn().mockResolvedValue(undefined)
    };

    mockContext = {
      newCDPSession: vi.fn().mockResolvedValue(mockCDP)
    };

    mockPage = {
      context: vi.fn().mockReturnValue(mockContext)
    };
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  test('should fallback to null if OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await healSelector(mockPage as Page, 'Login Button');
    expect(result).toBeNull();
  });

  test('should construct correct DeepSeek payload and return healed selector', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => 
      Promise.resolve({
        json: () => Promise.resolve({ choices: [{ message: { content: '#new-login' } }] })
      } as Response)
    );

    const result = await healSelector(mockPage as Page, 'Login Button');
    
    expect(result).toBe('#new-login');
    expect(fetchSpy).toHaveBeenCalled();
    
    const fetchArgs = fetchSpy.mock.calls[0];
    expect(fetchArgs[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    
    const req = fetchArgs[1] as RequestInit;
    expect(req.method).toBe('POST');
    expect((req.headers as any)['Authorization']).toBe('Bearer test_key');
    
    const body = JSON.parse(req.body as string);
    expect(body.model).toBe('deepseek/deepseek-coder');
    expect(body.messages[0].content).toContain('Login Button');
    expect(body.messages[0].content).toContain('new-login');

    fetchSpy.mockRestore();
  });

  test('should return null if DeepSeek fails to find selector', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => 
      Promise.resolve({
        json: () => Promise.resolve({ choices: [{ message: { content: 'NULL' } }] })
      } as Response)
    );

    const result = await healSelector(mockPage as Page, 'Ghost Button');
    expect(result).toBeNull();

    fetchSpy.mockRestore();
  });
});
