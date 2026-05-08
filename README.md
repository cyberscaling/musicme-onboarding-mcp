# musicme-partner-onboarding (MCP server)

A small Python MCP (Model Context Protocol) server that lets a new musicme
partner self-register on the platform from inside their own AI-coding
environment (Claude Code, Cursor, Claude Desktop, …).

The musicme operator hands you **two things**:

1. an **onboarding API key** (single string, treat as a secret),
2. (optional) the **admin URL** — defaults to `https://admin-stream.musicme.cc`.

You configure these as environment variables in your MCP client. From there,
the agent inside your editor can call:

- `register_partner(partner_id, name, allowed_origins)` — creates the
  partner, generates the cryptographic keys, and mints a `mint_key`.
  **The mint_key is shown once.** Store it in your backend secret manager
  before the agent moves on.
- `update_allowed_origins(partner_id, allowed_origins)` — replace the list
  of allowed CORS origins (add `http://localhost:5173` for dev, etc.).
- `get_partner_status(partner_id)` — read-only health check.
- `integration_guide()` — pointer to the full integration document.

After registration, you no longer need this MCP server in day-to-day work —
it's a one-shot installer. You can keep it installed for future
re-registrations (new partners, environment splits, etc.).

This repository also ships:

- [`prompts/integration-prompts.md`](prompts/integration-prompts.md) — a 6-step
  prompt sequence to guide an AI agent through the full integration flow
  (audit → clarify → specs → tests → implementation → docs).
- [`skill/musicme-integration/`](skill/) — a Claude Code / Cursor skill
  that activates the integration flow with a single command and embeds
  technical knowledge + troubleshooting.

---

## Install

Requires Python 3.10+. The recommended path for end-users is **zero install**
via [uv](https://docs.astral.sh/uv/) — `uvx` pulls and caches the package
on first run, so the partner only adds 4 lines to their MCP client config.

If you prefer a persistent install:

```bash
# install once globally:
uv tool install git+https://github.com/Cyberscaling/musicme-onboarding-mcp.git

# or from a local clone:
git clone https://github.com/Cyberscaling/musicme-onboarding-mcp.git
cd musicme-onboarding-mcp
uv tool install .

# or with pip:
pip install git+https://github.com/Cyberscaling/musicme-onboarding-mcp.git
```

Verify:

```bash
musicme-onboarding-mcp --help   # FastMCP standard CLI
```

---

## Configure your MCP client

The `command`/`args` form below uses `uvx` so nothing has to be installed
ahead of time — uv will fetch the package on first start and cache it.
Replace with `"command": "musicme-onboarding-mcp"` (no args) if you went
the `uv tool install` route above.

### Claude Code (`.mcp.json` in your project root)

```json
{
  "mcpServers": {
    "musicme-onboarding": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/Cyberscaling/musicme-onboarding-mcp.git",
        "musicme-onboarding-mcp"
      ],
      "env": {
        "MUSICME_ADMIN_URL": "https://admin-stream.musicme.cc",
        "MUSICME_ONBOARDING_API_KEY": "<paste the key the musicme operator gave you>"
      }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

Same structure as above.

### Claude Desktop (`claude_desktop_config.json`)

Same as the Claude Code block above — `command: "uvx"` with the same `args`.

### Pinning a version (optional)

To pin to a specific tagged release instead of always pulling `main`:

```json
"args": [
  "--from",
  "git+https://github.com/Cyberscaling/musicme-onboarding-mcp.git@v0.1.0",
  "musicme-onboarding-mcp"
]
```

Restart your editor after editing the config. The MCP client logs (stderr)
should show:

```
[musicme-partner-onboarding] starting admin_url=https://admin-stream.musicme.cc key_present=yes
```

If it shows `key_present=NO`, your env var is not propagating. Check the
JSON file path and restart the client.

---

## Use

In your editor, ask the agent something like:

> "Register a new musicme partner. id=`mon-site`, name=`Mon Site Musique`,
> allowed origin `https://www.mon-site.fr`."

The agent will call `register_partner(...)` and surface a JSON object that
includes `mint_key`. **Copy that key into your secret manager
immediately.** It will never be shown again.

The response also gives you:

| Field | Use |
|---|---|
| `mint_key` | secret — your backend uses this to mint short-lived JWTs |
| `partner_id` | constant in your app config |
| `expected_iss` | (informational) the issuer your JWTs will carry |
| `jwks_url` | (informational) where the streaming worker fetches your public key |
| `admin_url` | use as `${admin_url}/api/internal/mint/${partner_id}` for token mint |
| `stream_url` | use as `${stream_url}/init-stream` for player init |

For the rest of the integration (backend mint endpoint, frontend SDK), see
[`system-design/09-partner-integration-guide.md`](https://github.com/Cyberscaling/secure-audio-stream/blob/main/system-design/09-partner-integration-guide.md).

---

## Security notes

- The `MUSICME_ONBOARDING_API_KEY` lets you create partners on the musicme
  platform. Treat it like a database password: env vars only, never in Git,
  rotate at the first sign of compromise.
- The `mint_key` returned by `register_partner` belongs in your **backend**
  only. Never ship it in the frontend bundle or in localStorage.
- This MCP server runs locally over stdio; no traffic leaves your machine
  except direct HTTPS calls to the musicme admin worker.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `missing_config` on every call | `MUSICME_ONBOARDING_API_KEY` not set | Check the `env` block in your MCP client config; restart editor. |
| `unauthorized` (401) | Key wrong, rotated, or revoked | Contact the musicme operator. |
| `partner_exists` (409) | Slug already taken | Choose a different `partner_id`, or ask the operator if you forgot a previous registration. |
| `network_error` | Cannot reach `admin-stream.musicme.cc` | Verify connectivity, corporate proxy, or DNS. |
| Editor doesn't see the tool | MCP client did not start the server | Check stderr logs of the MCP client. Restart after edits. |

If you stay stuck, contact the musicme operator with the failing JSON
output (no secrets in it — only the configured admin URL).
