# Cloudflare Deploy (Workers + Containers)

This folder contains the Worker source used by the root `wrangler.jsonc`.

## Why Containers

AssppWeb backend needs:

- WebSocket upgrades (`/wisp/`)
- filesystem writes for compiled IPA output
- long-running Node.js runtime behavior

Cloudflare Containers runs the existing Dockerized app with minimal changes.

## Deploy

```bash
npx wrangler login
npx wrangler deploy
```

For local preview on Cloudflare runtime:

```bash
npx wrangler dev
```

## Notes

- Deploy configuration lives in the repository root `wrangler.jsonc`.
- `cloudflare/src/index.ts` imports `cloudflare:containers` (runtime module), so deploy does not require installing local npm dependencies.
- The worker routes all HTTP and WebSocket traffic to one named container instance (`main`) to keep app state consistent.
- Container filesystem is ephemeral. Compiled packages may be lost when the container stops and restarts.
