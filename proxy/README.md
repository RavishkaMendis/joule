# Joule AI proxy (Gemini + OpenRouter failover)

Holds the Google Gemini API key — and, optionally, an OpenRouter key used as an
availability failover — server-side so the app bundle never carries either.
PRD §8, build-order item 17 — *"mandatory before any APK leaves your device."*

## Why this exists

The app originally inlined the key via `EXPO_PUBLIC_GEMINI_API_KEY`. That is fine
for a personally sideloaded APK. It stops being fine the moment a build reaches a
second person's phone: TestFlight puts the bundle on Apple's servers and hers, and
anyone who unpacks it has the key.

Gemini also fails for the owner once or twice a day (plain outages — 5xx/429, not
bad requests). `src/lib/ai/geminiClient.ts` now fails over to OpenRouter's
`openai/gpt-5-nano` as a last resort when that happens, but only when a proxy is
configured — the OpenRouter key must live server-side exactly like Google's, so a
direct-key-only setup (no proxy at all) has no route to the backup and just sees
Gemini's own error, same as before this feature existed.

## What it protects, and what it doesn't

**It does** keep both API keys off every device. A leaked `JOULE_PROXY_TOKEN` is
rotated here in seconds; a leaked upstream key is a credential on that account.

**It doesn't** make the client trustworthy. The shared token still ships inside the
app and is extractable by anyone willing to unpack an IPA. What that buys an
attacker is free-tier quota, behind a model allowlist, on an endpoint you can
revoke — not an upstream credential. That is the honest posture, and the one
PRD §8 asks for.

## Environment variables

Set in the Vercel project (Settings → Environment Variables):

| Name | Value | Required? |
|---|---|---|
| `GEMINI_API_KEY` | Your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Yes |
| `JOULE_PROXY_TOKEN` | Any long random string — generate with `openssl rand -hex 32` | Yes |
| `OPENROUTER_API_KEY` | Your key from [openrouter.ai/keys](https://openrouter.ai/keys) | **No** — the failover simply never fires without it |
| `OPENROUTER_APP_URL` | A public URL for this app, sent as OpenRouter's `HTTP-Referer` attribution header | No — defaults to an inert placeholder |

`OPENROUTER_API_KEY` is deliberately optional: the proxy (and every existing
Gemini path) works exactly as before with only the two required vars set. If the
client ever requests the OpenRouter provider while this key is unset, the proxy
returns a clear `500` naming the problem — it never crashes, and it never silently
calls Google instead of the provider the client explicitly asked for.

The app sends `JOULE_PROXY_TOKEN` as an `x-joule-token` header. It is **not** either
upstream key and is safe to rotate independently.

## Contract

```
POST /api/gemini
x-joule-token: <JOULE_PROXY_TOKEN>
Content-Type: application/json

{ "provider": "google" | "openrouter", "model": "<model id>", "payload": { ... } }
```

`provider` defaults to `"google"` when omitted, so a client built before this field
existed keeps working unmodified. `payload` is forwarded as-is to whichever
upstream API `provider` selects:

- **`google`** (default): `payload` is an untouched Gemini `generateContent` body;
  `model` is interpolated into the Gemini REST URL exactly as before.
- **`openrouter`**: `payload` is an OpenAI-shaped chat-completions body; `model` is
  validated against `ALLOWED_OPENROUTER_MODELS` and then forced onto
  `payload.model` before forwarding (never trusted from the client payload alone),
  and the request goes to `https://openrouter.ai/api/v1/chat/completions` with the
  `Authorization: Bearer <OPENROUTER_API_KEY>`, `HTTP-Referer`, and `X-Title`
  headers added server-side.

Both branches pass the upstream status and body through **untouched**. That is
deliberate: the app's own error classification depends on seeing the real
response — for Google specifically, its model-deprecation 404s (which name the
replacement model and drive the client's fallback chain). Rewriting either would
break that.

## Adding a model

- `ALLOWED_GOOGLE_MODELS` in `api/gemini.js` mirrors `MODEL_FALLBACKS` in
  `src/lib/ai/geminiClient.ts`.
- `ALLOWED_OPENROUTER_MODELS` in `api/gemini.js` mirrors `OPENROUTER_BACKUP_MODEL`
  in the same file.

Update both sides of whichever pair changes. Two separate allowlists rather than
one shared set, and an allowlist rather than a pattern: the Google model name is
interpolated into a URL, so a permissive regex there is a path-traversal surface —
and a single merged allowlist would let a model meant for one provider slip through
the other's branch purely by being present in the set.

## Not included

No rate limiting. Vercel serverless functions don't share memory between
invocations, so an in-process counter would be theatre. If quota abuse ever becomes
real, use Vercel KV or Upstash — deliberately not faked here.

## Why `vercel.json` lives at the REPO ROOT, not here

Vercel's zero-config detection never picked up `api/gemini.js`. Two pushes
produced byte-identical empty builds -- `Build Completed in /vercel/output
[278ms]`, no functions -- and `/api/gemini` returned 404 where the earlier
CLI deployment had served it.

A `vercel.json` placed in this directory changed nothing, which is the
useful datum: the git builds run from the REPO ROOT regardless of what the
dashboard's Root Directory field displays. So the working config is
`/vercel.json` at the repo root, declaring this function by its full path
`proxy/api/gemini.js` and routing `/api/gemini` to it.

Do not "tidy" that file down into this directory. It has been tried; the
build silently produces nothing and the endpoint 404s, which looks exactly
like a healthy deploy in the Vercel dashboard.
