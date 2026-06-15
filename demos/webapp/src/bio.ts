/**
 * Proxy mounted at /api/artist-bio/:id. Mints a partner RS256 JWT server-side
 * (never exposed to the browser) and forwards to the stream worker's
 * /artist-bio endpoint, passing through the JSON (bio + per-phase metrics + cost).
 */
import { Hono } from 'hono'
import { mintRs256Jwt } from './jwt'
import { getSession } from './session'
import type { Env } from './types'

export const bioRoute = new Hono<{ Bindings: Env }>()

bioRoute.get('/:id', async (c) => {
  const sess = await getSession(c.env, c.req.raw)
  if (!sess) return c.json({ error: 'unauthenticated' }, 401)

  const id = c.req.param('id') ?? ''
  if (!/^\d+$/.test(id)) return c.json({ error: 'invalid_id' }, 400)

  const name = (c.req.query('name') ?? '').trim()
  if (!name) return c.json({ error: 'name_required' }, 400)
  const mode = c.req.query('mode') === 'deep' ? 'deep' : 'fast'
  const refresh = c.req.query('refresh') === '1'

  const target = new URL(`${c.env.STREAM_WORKER_URL}/artist-bio/${id}`)
  target.searchParams.set('name', name)
  target.searchParams.set('mode', mode)
  if (refresh) target.searchParams.set('refresh', '1')

  let token: string
  try {
    ;({ token } = await mintRs256Jwt(c.env, c.req.raw, sess.username))
  } catch (e) {
    return c.json({ error: 'mint_failed', message: (e as Error).message }, 500)
  }

  const r = await fetch(target.toString(), { headers: { Authorization: `Bearer ${token}` } })
  const body = await r.text()
  return new Response(body, { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
