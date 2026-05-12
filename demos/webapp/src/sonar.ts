/**
 * Proxy to the partner-provided tracklisting API. The `x-api-key` header is
 * server-side only — never exposed to the browser, even though the demo would
 * still work with a public key. Mirrors how a real partner integration should
 * shield its credentials.
 */
import { Hono } from 'hono'
import { getSession } from './session'
import type { Env } from './types'

export const sonarRoute = new Hono<{ Bindings: Env }>()

const SONAR_BASE = 'https://sonar.hosting-media.net'

sonarRoute.get('/album/:cb', async (c) => {
  const sess = await getSession(c.env, c.req.raw)
  if (!sess) return c.json({ error: 'unauthenticated' }, 401)
  const cb = c.req.param('cb') ?? ''
  if (!/^\d{8,18}$/.test(cb)) {
    return c.json({ error: 'invalid_cb' }, 400)
  }
  if (!c.env.SONAR_API_KEY) {
    return c.json({ error: 'sonar_not_configured' }, 503)
  }
  const r = await fetch(`${SONAR_BASE}/albums/${cb}`, {
    headers: {
      accept: 'application/json',
      'x-api-key': c.env.SONAR_API_KEY,
    },
  })
  if (r.status === 404) return c.json({ error: 'album_not_found', cb }, 404)
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    return c.json({ error: 'upstream_failed', status: r.status, body: txt.slice(0, 200) }, 502)
  }
  // Pass through. Note: tracklist is unsorted in upstream — SPA sorts.
  const body = await r.text()
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
