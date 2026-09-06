// ═══════════════════════════════════════════════════════════════════════
// GEMINI TRANSPORT CONFIG TESTS
//
// Covers the precedence rule the whole proxy feature hinges on: proxy
// when configured, otherwise the existing direct key, otherwise nothing
// (AI unavailable). `hasGeminiApiKey()` gates every AI-backed input path
// (InputMethodMenu, the five capture screens), so its four states —
// proxy-only, direct-only, both, neither — are exercised explicitly here
// rather than just implied by the transport tests in geminiClient.test.ts.
// ═══════════════════════════════════════════════════════════════════════

import { getGeminiTransport, hasGeminiApiKey, hasGeminiProxyConfig } from '../apiKey';

const ORIGINAL_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
const ORIGINAL_TOKEN = process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

describe('Gemini transport config', () => {
  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = ORIGINAL_URL;
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = ORIGINAL_TOKEN;
  });

  it('is unavailable when neither a direct key nor a proxy is configured', () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

    expect(hasGeminiApiKey()).toBe(false);
    expect(getGeminiTransport()).toBeNull();
  });

  it('is available with only a direct key (today\'s .env, unchanged)', () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'direct-key';
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

    expect(hasGeminiApiKey()).toBe(true);
    expect(getGeminiTransport()).toEqual({ kind: 'direct', apiKey: 'direct-key' });
  });

  it('is available with only a proxy configured — the intended end state once the key moves server-side', () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';

    expect(hasGeminiApiKey()).toBe(true);
    expect(hasGeminiProxyConfig()).toBe(true);
    expect(getGeminiTransport()).toEqual({
      kind: 'proxy',
      config: { url: 'https://proxy.example/api/gemini', token: 'shared-token' },
    });
  });

  it('prefers the proxy over a direct key when both are configured', () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'direct-key';
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';

    const transport = getGeminiTransport();
    expect(transport?.kind).toBe('proxy');
  });

  it('treats a half-configured proxy (URL but no token) as not configured', () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

    expect(hasGeminiProxyConfig()).toBe(false);
    expect(hasGeminiApiKey()).toBe(false);
  });

  it('treats a half-configured proxy (token but no URL) as not configured', () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';

    expect(hasGeminiProxyConfig()).toBe(false);
    expect(hasGeminiApiKey()).toBe(false);
  });

  it('trims whitespace the same way the original direct-key reader did', () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = '  direct-key  ';
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

    expect(getGeminiTransport()).toEqual({ kind: 'direct', apiKey: 'direct-key' });
  });
});
