# `@secure-audio-stream/webapp`

Demo SPA + Cloudflare Worker showcasing the `@cyberscaling/secure-audio-stream-client` SDK in a credible "music-app-like" UI. Acts as both the visible reference for partner integrators and the test bed for SDK changes.

## Architecture

```
demos/webapp/
  public/                       SPA (vanilla TS, no framework)
    index.html                  persistent shell : #root + #player-bar + #queue-panel + <audio>
    main.ts                     router + lazy playlistStore + mini-bar mount
    router.ts                   pushState-based router
    api.ts                      same-origin auth + JWT mint + logout cleanup
    catalog.ts                  typed wrappers + alias adapters for /api/catalog/*
    covers.ts                   cover CDN URL builder
    playlist-store.ts           singleton wrapping SDK Playlist + localStorage sync
    components/
      mini-bar.ts               persistent bottom bar
      queue-panel.ts            slide-up queue with drag-to-reorder
      track-row.ts              reusable row (cover + title + duration + +queue)
      album-card.ts             reusable cover grid card
      layout.ts                 nav bar + logout button
    pages/
      home.ts                   / : top + news + style chips
      album.ts                  /album/:cb
      artist.ts                 /artist/:id
      style.ts                  /style/:id
      search.ts                 /search
      login.ts                  /login
      explain.ts                /explain
  src/                          demo-worker (Cloudflare Worker)
    index.ts                    Hono app + ASSETS fallback
    auth.ts                     /api/auth/login|logout|me
    jwt.ts                      /api/jwt mint (RS256, short TTL)
    jwks.ts                     /.well-known/jwks.json
    sonar.ts                    legacy /api/album/:cb (replaced by catalog)
    sonar-helpers.ts            sonarFetch + passthroughQuery + x-api-key injection
    catalog.ts                  /api/catalog/* (10 GET routes)
    session.ts                  cookie session helpers (KV-backed)
    types.ts                    Env bindings
  test/                         vitest (worker pool) + happy-dom (client)
    catalog.test.ts             /api/catalog/* — 16 tests
    catalog-adapter.test.ts     browser adapters — 9 tests
    covers.test.ts              CDN URL builder — 3 tests
    playlist-store.test.ts      LS sync + accessors — 7 tests
    mini-bar.test.ts            render reacts to onChange — 4 tests
    queue-panel.test.ts         drag/drop/remove/jump — 5 tests
    helpers.ts                  shared mock + authedCookie minter
    setup-drag-event.ts         happy-dom DragEvent patch
  vite.config.ts                SPA build
  vitest.config.ts              worker tests (@cloudflare/vitest-pool-workers)
  vitest.client.config.ts       browser tests (happy-dom)
  wrangler.toml                 Worker config (env.dev binding)
```

## Rich-demo UI (since 2026-05-11)

Beyond the original login + search + album pages, the webapp ships :

- **Home** (`/`) — top albums + new releases + style chips, all from the catalog API
- **Artist** (`/artist/:id`) — bio + albums + top tracks + similar artists
- **Style** (`/style/:id`) — filtered top albums for a genre
- **Persistent mini-bar** at the bottom of every page — cover, title, ⏮ / ⏯ / ⏭, ≡ queue toggle, 2-px progress bar
- **Queue panel** (slide-up via mini-bar ≡) — drag the ⠿ handle (or anywhere on the row) to reorder, ✕ to remove, tap row to jump
- **LocalStorage persistence** of the queue across reload (key `musicme:webapp:playlist:v1`). Reload restores items but does NOT autoplay ; user clicks ▶ in the mini-bar to resume.

The mini-bar + queue panel are driven by `playlistStore` (singleton in `public/playlist-store.ts`) which wraps the SDK `Playlist` class attached to a single persistent `<audio>` element living in `index.html`. Pages never touch the audio element directly.

## Catalog API proxy

Browse pages call `/api/catalog/*` which proxies `https://sonar.hosting-media.net/*` and injects the `x-api-key` header from the `SONAR_API_KEY` Worker secret.

| Browser → demo-worker | Upstream |
|---|---|
| `GET /api/catalog/albums/top?style_id&limit&offset` | `/albums/top` |
| `GET /api/catalog/albums/news?limit&offset` | `/albums/news` |
| `GET /api/catalog/styles` | `/styles` |
| `GET /api/catalog/albums/:cb` | `/albums/{cb}` |
| `GET /api/catalog/albums/:cb/tracks` | `/albums/{cb}/tracks` |
| `GET /api/catalog/artists/:id[/albums|/tracks|/similar]` | `/artists/{id}/*` |
| `GET /api/catalog/search/global?q` | `/search/global` |

All session-gated (same cookie as the existing routes). Cache-Control `public, max-age=60` on the proxy response.

Three response conventions (raw / aliased / flatten — see `docs/musicme-api.md`) normalised by adapters in `public/catalog.ts`.

## Cover CDN

`https://covers-ng4.hosting-media.net/jpgr<size>/u<cb_padded_13>.jpg` — sizes `60 / 90 / 120 / 175 / 250 / 295 / 500 / 600 / 1000`. Public CDN (no auth). `cb` is padded to 13 digits with leading zeros (global search hits sometimes return shorter cb). The webapp uses 90 for mini-bar/queue, 175 for grids, 295 for album header. Fallback placeholder via inline SVG data: URL.

## Setup

### Pre-requisites

- **Bun 1.3+** (package manager + runtime)
- **Wrangler 4.x** (`bun x wrangler --version`)
- **Cloudflare account** with Workers + KV access
- A **partner record** registered on the stream worker (`secure-stream.musicme.com` or your own deployment). Use the MCP onboarding flow (`musicme-onboarding-mcp` repo) or have Pierre create it. You need :
  - a `partner_id` (e.g. `demo`)
  - a `jwks_url` (e.g. `https://your-webapp.workers.dev/.well-known/jwks.json`)
  - allowed origins matching where you'll serve the webapp

### 1. Install + generate keys

```bash
cd demos/webapp
bun install

# Generate the RS256 keypair used to sign player JWTs. Writes to keys/.
# The private key (PEM) signs JWTs; the public JWK is published at /.well-known/jwks.json.
bun run gen-keys
```

`keys/` is gitignored. Output :
- `keys/jwks-private.pem` — to set as the `RSA_PRIVATE_KEY_PEM` worker secret
- `keys/jwks-public.jwk.json` — to set as the `JWKS_PUBLIC_JWK` worker secret

### 2. Configure wrangler.toml

Open `wrangler.toml` and adjust for your environment (the file ships with a `dev` and `production` block — pick one or duplicate). Required edits :

```toml
[env.dev]
account_id = "<YOUR_CLOUDFLARE_ACCOUNT_ID>"   # find via `bun x wrangler whoami`

[env.dev.vars]
STREAM_WORKER_URL = "https://secure-stream.musicme.com"          # or your own stream-worker
PARTNER_ID         = "demo"                              # must match your partner record
ISS_OVERRIDE       = ""                                  # leave empty → uses worker URL

[[env.dev.kv_namespaces]]
binding = "DEMO_SESSIONS"
id      = "<YOUR_KV_NAMESPACE_ID>"                       # create via wrangler (next step)
```

Demo credentials in `DEMO_USERS` (plaintext, e.g. `alice:wonderland,bob:builder`) are intentional — production deployments must swap for proper auth.

### 3. Create KV namespace

```bash
bun x wrangler kv namespace create DEMO_SESSIONS --env dev
# → outputs an `id = "…"`. Copy it into wrangler.toml under [[env.dev.kv_namespaces]].
```

### 4. Set worker secrets

```bash
# RS256 private key (PEM, multi-line — wrangler accepts via stdin)
bun x wrangler secret put RSA_PRIVATE_KEY_PEM --env dev < keys/jwks-private.pem

# Public JWK (JSON) — also a secret because wrangler doesn't support file-based vars
bun x wrangler secret put JWKS_PUBLIC_JWK --env dev < keys/jwks-public.jwk.json

# Catalog API key (Sonar API — request from Pierre or your catalog provider)
bun x wrangler secret put SONAR_API_KEY --env dev
```

### 5. Local dev

```bash
bun run dev          # vite serves the SPA at http://localhost:5173
# In another terminal:
bun run preview      # builds SPA + runs the worker locally at :8788
```

`bun run dev` alone is enough for UI work (Vite + HMR). For end-to-end audio you need the worker too — use `bun run preview` (combined vite build + wrangler dev).

### 6. Deploy

```bash
bun run deploy       # vite build + wrangler deploy --env dev
```

After deploy :
- Your webapp is live at the Workers URL printed by wrangler
- JWKS published at `https://<your-worker>/.well-known/jwks.json`
- Verify the partner record's `jwks_url` matches that URL — otherwise the stream worker can't verify your JWTs

### 7. Login + use

Open the webapp URL in a browser. Login with one of the `DEMO_USERS` accounts (default : `alice:wonderland` or `bob:builder`). Browse home / search / album / artist / style, build a queue, play tracks.

**Browser support** : iOS 17.1+ Safari (ManagedMediaSource), Chrome / Edge / Firefox desktop (MSE). Earlier iOS falls back to `blob` mode (downloads the whole track before playing).

## Tests

```bash
bun run typecheck            # tsc --noEmit
bun run test                 # worker side (vitest-pool-workers, 16 tests)
bun run test:client          # browser side (happy-dom, 28 tests)
```

Add new browser tests to the `include` list in `vitest.client.config.ts` AND the `exclude` list in `vitest.config.ts` (worker pool excludes them by name).

## See also

- `client/README.md` — SDK API
- `system-design/09-partner-integration-guide.md` — integrator guide
- `docs/musicme-api.md` — catalog API quirks documented endpoint-by-endpoint
