// ═══════════════════════════════════════════════════════════════════════
// AI PROXY TESTS — fake `fetch`/`req`/`res` only, never a live deploy.
//
// Covers the multi-provider contract added for the OpenRouter failover
// (src/lib/ai/geminiClient.ts's `maybeFailoverToOpenRouter`):
//   - each provider's own model allowlist is enforced independently
//   - requesting OpenRouter without OPENROUTER_API_KEY configured fails
//     loudly with a clear message, never crashing and never silently
//     calling Google instead
//   - omitting `provider` entirely still defaults to Google, so an older
//     client (built before this field existed) keeps working unmodified
// ═══════════════════════════════════════════════════════════════════════

import handler from '../gemini';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function mockReq({ method = 'POST', token = 'right-token', body = {} } = {}) {
  return {
    method,
    headers: { 'x-joule-token': token },
    body,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    send(text) {
      this.body = text;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
  return res;
}

function setBaseEnv({ gemini = 'gemini-key', token = 'right-token', openrouter } = {}) {
  process.env.GEMINI_API_KEY = gemini;
  process.env.JOULE_PROXY_TOKEN = token;
  if (openrouter === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = openrouter;
  }
}

describe('AI proxy handler', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it('rejects a Google model not on ALLOWED_GOOGLE_MODELS', async () => {
    setBaseEnv();
    const req = mockReq({ body: { model: 'gemini-9000', payload: { contents: [] } } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain('Model not permitted');
    expect(res.body.error.message).toContain('gemini-9000');
  });

  it('defaults to Google when `provider` is omitted entirely (older-client compatibility)', async () => {
    setBaseEnv();
    global.fetch = jest.fn(async () => ({
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ candidates: [] }),
    }));
    const req = mockReq({ body: { model: 'gemini-3.6-flash', payload: { contents: [] } } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-3.6-flash');
    expect(url).toContain('gemini-key');
  });

  it('rejects an OpenRouter model not on ALLOWED_OPENROUTER_MODELS', async () => {
    setBaseEnv({ openrouter: 'or-key' });
    const req = mockReq({ body: { provider: 'openrouter', model: 'anthropic/claude-3-haiku', payload: { messages: [] } } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain('Model not permitted');
    expect(res.body.error.message).toContain('anthropic/claude-3-haiku');
  });

  it('returns a clear error when OpenRouter is requested but OPENROUTER_API_KEY is not configured — never crashes, never falls through to Google', async () => {
    setBaseEnv(); // no openrouter key
    global.fetch = jest.fn();
    const req = mockReq({ body: { provider: 'openrouter', model: 'openai/gpt-5-nano', payload: { messages: [] } } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error.message).toMatch(/OPENROUTER_API_KEY/);
    // Must not have silently forwarded the request to Google instead.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards a valid OpenRouter request with the Authorization/attribution headers and forces payload.model to the validated model', async () => {
    setBaseEnv({ openrouter: 'or-key' });
    global.fetch = jest.fn(async () => ({
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
    }));
    const req = mockReq({
      body: {
        provider: 'openrouter',
        model: 'openai/gpt-5-nano',
        payload: { model: 'something-else-the-client-should-not-control', messages: [{ role: 'user', content: [] }] },
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer or-key');
    expect(init.headers['X-Title']).toBe('Joule');
    expect(init.headers['HTTP-Referer']).toBeTruthy();
    const sentBody = JSON.parse(init.body);
    // The proxy must not trust a client-supplied payload.model that
    // differs from the validated top-level `model`.
    expect(sentBody.model).toBe('openai/gpt-5-nano');
  });

  it('still requires the x-joule-token header for an OpenRouter request, same as Google', async () => {
    setBaseEnv({ openrouter: 'or-key', token: 'right-token' });
    const req = mockReq({ token: 'wrong-token', body: { provider: 'openrouter', model: 'openai/gpt-5-nano', payload: {} } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown provider value', async () => {
    setBaseEnv({ openrouter: 'or-key' });
    const req = mockReq({ body: { provider: 'anthropic', model: 'claude', payload: {} } });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain('Unknown provider');
  });
});
