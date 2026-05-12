import { Hono } from 'hono'
import type { Env } from './types'

export const jwksRoute = new Hono<{ Bindings: Env }>()

/**
 * `/.well-known/jwks.json`
 *
 * Public-only document — the `JWKS_PUBLIC_JWK` secret holds a single JWK with
 * `kid`, `kty=RSA`, `n`, `e`, `alg=RS256`, `use=sig`. The stream worker fetches
 * this when verifying a Bearer JWT whose `iss` matches the partner row.
 */
jwksRoute.get('/jwks.json', async (c) => {
  if (!c.env.JWKS_PUBLIC_JWK) {
    return c.json({ error: 'jwks_not_configured' }, 503)
  }
  let jwk: unknown
  try {
    jwk = JSON.parse(c.env.JWKS_PUBLIC_JWK)
  } catch {
    return c.json({ error: 'jwks_malformed' }, 500)
  }
  return new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: {
      'Content-Type': 'application/jwk-set+json',
      // The stream worker caches JWKS for 1h via TTL in jwksCache. Long
      // public-cache here lets edge caches help too.
      'Cache-Control': 'public, max-age=3600, immutable',
    },
  })
})
