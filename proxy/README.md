# Joule Gemini proxy

Holds the Google Gemini API key server-side so the app bundle never carries it.
PRD §8, build-order item 17 — *"mandatory before any APK leaves your device."*

## Why this exists

The app originally inlined the key via `EXPO_PUBLIC_GEMINI_API_KEY`. That is fine
for a personally sideloaded APK. It stops being fine the moment a build reaches a
second person's phone: TestFlight puts the bundle on Apple's servers and hers, and
anyone who unpacks it has the key.

## What it protects, and what it doesn't

**It does** keep the Google API key off every device. A leaked `JOULE_PROXY_TOKEN`
is rotated here in seconds; a leaked Google key is a credential on your account.

**It doesn't** make the client trustworthy. The shared token still ships inside the
app and is extractable by anyone willing to unpack an IPA. What that buys an
attacker is free-tier quota, behind a model allowlist, on an endpoint you can
revoke — not a Google credential. That is the honest posture, and the one PRD §8
asks for.

## Environment variables

Set both in the Vercel project (Settings → Environment Variables):

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | Your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `JOULE_PROXY_TOKEN` | Any long random string — generate with `openssl rand -hex 32` |

The app sends `JOULE_PROXY_TOKEN` as an `x-joule-token` header. It is **not** the
Gemini key and is safe to rotate independently.

## Contract

```
POST /api/gemini
x-joule-token: <JOULE_PROXY_TOKEN>
Content-Type: application/json

{ "model": "gemini-3.6-flash", "payload": { ...generateContent body... } }
```

Google's status and body are passed through **untouched**. That is deliberate: the
app's fallback chain depends on seeing Google's real model-deprecation 404s, which
name the replacement model. Rewriting those errors would break it.

## Adding a model

`ALLOWED_MODELS` in `api/gemini.js` mirrors `MODEL_FALLBACKS` in
`src/lib/ai/geminiClient.ts`. Update both. It is an allowlist rather than a pattern
because the model name is interpolated into a URL, and a permissive regex there is
a path-traversal surface.

## Not included

No rate limiting. Vercel serverless functions don't share memory between
invocations, so an in-process counter would be theatre. If quota abuse ever becomes
real, use Vercel KV or Upstash — deliberately not faked here.
