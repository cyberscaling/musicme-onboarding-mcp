"""MCP server exposing tools for self-service partner onboarding on the
musicme secure-audio-stream platform.

Run via stdio (for use inside Claude Code, Cursor, or any MCP-compatible
client). Configuration is purely environmental — the partner's operator sets
two env vars in their MCP client config:

    MUSICME_ADMIN_URL              default: https://admin-stream.musicme.cc
    MUSICME_ONBOARDING_API_KEY     provided by the musicme operator (secret)

The shared key is what authorizes the partner to call the onboarding
endpoint. It is rotated by the musicme operator if compromised.

Exposed tools:

    register_partner(id, name, allowed_origins)
        Atomically creates the partner row, generates a managed RSA-2048
        keypair, and mints a `mint` API key. Returns the mint secret
        ONCE — surface it to the operator immediately and have them store
        it in a secret manager. Subsequent calls with the same `id`
        return 409.

    get_partner_status(id)
        Reads back the partner's current configuration (no secrets).
        Useful to confirm registration succeeded and to retrieve URLs.

Both tools fail fast on misconfiguration: if MUSICME_ONBOARDING_API_KEY is
missing, every call short-circuits with a clear error so the user knows to
fix their MCP client config.
"""
from __future__ import annotations

import os
import re
import sys
from typing import Any
from urllib.parse import urlparse

import httpx
from mcp.server.fastmcp import FastMCP

DEFAULT_ADMIN_URL = "https://admin-stream.musicme.cc"
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$")
DEFAULT_TIMEOUT_S = 30.0


def _is_allowed_origin(value: object) -> bool:
    """Mirror of admin-worker's `isAllowedOrigin`.

    Accepts any `https://...` origin plus the loopback dev origins
    `http://localhost`, `http://127.0.0.1`, `http://[::1]` (with optional
    port + path). These are the only `http://` cases that are safe to
    allow because they cannot be reached from the open internet.
    """
    if not isinstance(value, str) or not value:
        return False
    try:
        u = urlparse(value)
    except Exception:
        return False
    if u.scheme == "https" and u.hostname:
        return True
    if u.scheme == "http" and u.hostname in {"localhost", "127.0.0.1", "::1"}:
        return True
    return False

mcp = FastMCP(
    "musicme-partner-onboarding",
    instructions=(
        "Tools to onboard a new partner on the musicme secure-audio-stream "
        "platform. Use `register_partner` once per partner; the response "
        "contains a one-shot mint key that must be stored in the partner's "
        "backend secret manager. Use `get_partner_status` to confirm a prior "
        "registration."
    ),
)


def _admin_url() -> str:
    return os.environ.get("MUSICME_ADMIN_URL", DEFAULT_ADMIN_URL).rstrip("/")


def _onboarding_key() -> str | None:
    key = os.environ.get("MUSICME_ONBOARDING_API_KEY", "").strip()
    return key or None


def _client() -> httpx.Client:
    return httpx.Client(timeout=DEFAULT_TIMEOUT_S)


def _require_config() -> tuple[str, str] | dict[str, Any]:
    """Return (admin_url, onboarding_key) or an error dict to surface to MCP."""
    key = _onboarding_key()
    if not key:
        return {
            "error": "missing_config",
            "detail": (
                "MUSICME_ONBOARDING_API_KEY is not set in this MCP server's "
                "environment. The musicme operator must provide it. Add it "
                "to the `env` block of your MCP client configuration "
                "(e.g. `~/.cursor/mcp.json`, Claude Desktop config, or a "
                "Claude Code project `.mcp.json`)."
            ),
        }
    return _admin_url(), key


@mcp.tool()
def register_partner(
    partner_id: str,
    name: str,
    allowed_origins: list[str],
) -> dict[str, Any]:
    """Register a new partner on the musicme platform (one-shot).

    Args:
        partner_id: Slug-formatted unique identifier, e.g. "mon-site". Lowercase
            alphanumeric and hyphens, 2-40 characters. Used in URLs and JWTs.
        name: Human-readable name displayed in the admin dashboard.
        allowed_origins: List of `https://...` origins from which the partner's
            frontend will load the audio player. Cross-origin calls from any
            other origin will be blocked.

    Returns:
        A dict with the partner configuration. The most important field is
        `mint_key` — this is shown ONCE and must be persisted by the partner's
        operator (1Password, Vault, AWS Secrets Manager, etc.) before they
        dismiss the response. Losing it means re-running registration with a
        new partner id, or having the musicme operator manually rotate.

    Errors:
        - `missing_config`: MUSICME_ONBOARDING_API_KEY is not set.
        - `invalid_body`: Body validation failed; see `details`.
        - `partner_exists` (HTTP 409): A partner with this id is already
          registered. Choose a different id or contact the musicme operator
          if you believe this is wrong.
        - `unauthorized` (HTTP 401): The onboarding key is wrong, expired, or
          revoked. Contact the musicme operator.
    """
    config = _require_config()
    if isinstance(config, dict):
        return config
    admin_url, key = config

    # Client-side validation — same regex as the server, so we fail fast with
    # a clear message instead of round-tripping a bad request.
    errors: list[str] = []
    if not isinstance(partner_id, str) or not SLUG_RE.match(partner_id):
        errors.append("partner_id must be a slug: lowercase alphanumeric + hyphens, 2-40 chars")
    if not isinstance(name, str) or not name.strip():
        errors.append("name must be a non-empty string")
    if not isinstance(allowed_origins, list) or len(allowed_origins) == 0:
        errors.append("allowed_origins must be a non-empty list of origins")
    elif not all(_is_allowed_origin(o) for o in allowed_origins):
        errors.append(
            "each origin must be https://... or http://localhost/127.0.0.1/[::1] (dev only)"
        )
    if errors:
        return {"error": "invalid_body", "details": errors}

    body = {
        "id": partner_id,
        "name": name.strip(),
        "allowed_origins": allowed_origins,
    }

    try:
        with _client() as c:
            resp = c.post(
                f"{admin_url}/api/onboarding/partners",
                headers={"X-Onboarding-Key": key, "Content-Type": "application/json"},
                json=body,
            )
    except httpx.RequestError as e:
        return {"error": "network_error", "detail": str(e)}

    parsed: dict[str, Any]
    try:
        parsed = resp.json()
    except ValueError:
        parsed = {"_raw": resp.text[:500]}

    if resp.status_code == 201:
        # Guard against the server forgetting to send mint_key — surface a
        # readable error rather than a confusing dict.
        if "mint_key" not in parsed:
            return {
                "error": "server_response_malformed",
                "detail": "server returned 201 but no mint_key field",
                "raw": parsed,
            }
        return {
            "ok": True,
            "instructions": (
                "STORE THE `mint_key` BELOW NOW — it cannot be retrieved later. "
                "Add it to the partner backend secret manager (e.g. as env var "
                "MINT_KEY) and never to a Git-tracked file."
            ),
            **parsed,
        }

    return {
        "error": "registration_failed",
        "status": resp.status_code,
        "response": parsed,
    }


@mcp.tool()
def update_allowed_origins(partner_id: str, allowed_origins: list[str]) -> dict[str, Any]:
    """Replace the list of allowed origins for an already-registered partner.

    Use this when the partner needs to add or remove a frontend origin
    (e.g. add `http://localhost:5173` for local dev, swap a staging URL
    for the production URL). The new list **replaces** the previous one
    entirely — pass the full desired set, not a delta.

    Args:
        partner_id: The slug used when calling `register_partner`.
        allowed_origins: Full new list of origins. Each must be either
            an `https://...` URL or one of the loopback dev cases
            (`http://localhost`, `http://127.0.0.1`, `http://[::1]`)
            with optional port + path. Non-empty list required.

    Returns:
        On success, `{ partner_id, allowed_origins, updated_at }`.

    Errors:
        - `missing_config`: MUSICME_ONBOARDING_API_KEY is not set.
        - `invalid_body`: Body validation failed; see `details`.
        - `not_found` (HTTP 404): Unknown partner id.
        - `unauthorized` (HTTP 401): Onboarding key wrong / revoked.
    """
    config = _require_config()
    if isinstance(config, dict):
        return config
    admin_url, key = config

    errors: list[str] = []
    if not isinstance(partner_id, str) or not SLUG_RE.match(partner_id):
        errors.append("partner_id must be a slug: lowercase alphanumeric + hyphens")
    if not isinstance(allowed_origins, list) or len(allowed_origins) == 0:
        errors.append("allowed_origins must be a non-empty list of origins")
    elif not all(_is_allowed_origin(o) for o in allowed_origins):
        errors.append(
            "each origin must be https://... or http://localhost/127.0.0.1/[::1] (dev only)"
        )
    if errors:
        return {"error": "invalid_body", "details": errors}

    try:
        with _client() as c:
            resp = c.patch(
                f"{admin_url}/api/onboarding/partners/{partner_id}",
                headers={"X-Onboarding-Key": key, "Content-Type": "application/json"},
                json={"allowed_origins": allowed_origins},
            )
    except httpx.RequestError as e:
        return {"error": "network_error", "detail": str(e)}

    try:
        parsed = resp.json()
    except ValueError:
        parsed = {"_raw": resp.text[:500]}

    if resp.status_code == 200:
        return {"ok": True, **parsed}
    return {
        "error": "update_failed",
        "status": resp.status_code,
        "response": parsed,
    }


@mcp.tool()
def get_partner_status(partner_id: str) -> dict[str, Any]:
    """Read back the configuration of an already-registered partner.

    Args:
        partner_id: The slug used when calling `register_partner`.

    Returns:
        Public-facing partner config (URLs, allowed origins, key health
        flags). Never contains the mint key — that is one-shot at creation.

    Errors:
        - `missing_config`: MUSICME_ONBOARDING_API_KEY is not set.
        - `not_found` (HTTP 404): Unknown partner id.
        - `unauthorized` (HTTP 401): Onboarding key wrong / revoked.
    """
    config = _require_config()
    if isinstance(config, dict):
        return config
    admin_url, key = config

    if not isinstance(partner_id, str) or not SLUG_RE.match(partner_id):
        return {
            "error": "invalid_body",
            "details": ["partner_id must be a slug: lowercase alphanumeric + hyphens"],
        }

    try:
        with _client() as c:
            resp = c.get(
                f"{admin_url}/api/onboarding/partners/{partner_id}",
                headers={"X-Onboarding-Key": key},
            )
    except httpx.RequestError as e:
        return {"error": "network_error", "detail": str(e)}

    try:
        parsed = resp.json()
    except ValueError:
        parsed = {"_raw": resp.text[:500]}

    if resp.status_code == 200:
        return parsed
    return {
        "error": "lookup_failed",
        "status": resp.status_code,
        "response": parsed,
    }


@mcp.tool()
def integration_guide() -> dict[str, Any]:
    """Returns a pointer to the human-readable integration guide.

    Use this when the user asks "how do I integrate the player?" or
    "what do I do after registering?". It returns a stable URL to the
    full guide that explains the JWT flow, the SDK usage, and the
    mint-key handling.
    """
    return {
        "guide_url": (
            "https://github.com/Cyberscaling/secure-audio-stream/blob/main/"
            "system-design/09-partner-integration-guide.md"
        ),
        "summary": (
            "1) Backend: store the mint_key in a secret manager. "
            "2) Backend: expose POST /api/player-token (auth-gated) that "
            "calls POST {admin_url}/api/internal/mint/{partner_id} with "
            "header X-Mint-Key=<mint_key> and returns the JWT. "
            "3) Frontend: use @secure-audio-stream/client SDK with "
            "getToken=() => fetch('/api/player-token').then(r => r.json().token). "
            "4) Test by playing a known cb/disc/track."
        ),
    }


def main() -> None:
    """Entrypoint for stdio MCP server."""
    # Surface a clear startup banner on stderr so MCP clients (which capture
    # stderr) show what's running. Stdout is reserved for the JSON-RPC framing.
    print(
        f"[musicme-partner-onboarding] starting "
        f"admin_url={_admin_url()} "
        f"key_present={'yes' if _onboarding_key() else 'NO (server will reject every tool call)'}",
        file=sys.stderr,
    )
    mcp.run()


if __name__ == "__main__":
    main()
