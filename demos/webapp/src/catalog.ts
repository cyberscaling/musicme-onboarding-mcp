/**
 * Proxy routes mounted at /api/catalog/*. Each route requires a session
 * cookie and delegates to sonarFetch().
 */
import { Hono } from 'hono'
import { getSession } from './session'
import { passthroughQuery, sonarFetch } from './sonar-helpers'
import type { Env } from './types'

export const catalogRoute = new Hono<{ Bindings: Env }>()

catalogRoute.use('*', async (c, next) => {
  const sess = await getSession(c.env, c.req.raw)
  if (!sess) return c.json({ error: 'unauthenticated' }, 401)
  await next()
})

catalogRoute.get('/albums/top', async (c) =>
  sonarFetch(c.env, '/albums/top', passthroughQuery(c.req.raw, ['style_id', 'limit', 'offset'])),
)

catalogRoute.get('/albums/news', async (c) =>
  sonarFetch(c.env, '/albums/news', passthroughQuery(c.req.raw, ['limit', 'offset'])),
)

catalogRoute.get('/styles', async (c) => sonarFetch(c.env, '/styles'))

catalogRoute.get('/albums/:cb', async (c) => {
  const cb = c.req.param('cb') ?? ''
  if (!/^\d{8,18}$/.test(cb)) return c.json({ error: 'invalid_cb' }, 400)
  return sonarFetch(c.env, `/albums/${cb}`)
})

catalogRoute.get('/albums/:cb/tracks', async (c) => {
  const cb = c.req.param('cb') ?? ''
  if (!/^\d{8,18}$/.test(cb)) return c.json({ error: 'invalid_cb' }, 400)
  return sonarFetch(c.env, `/albums/${cb}/tracks`)
})

catalogRoute.get('/artists/:id', async (c) => {
  const id = c.req.param('id') ?? ''
  if (!/^\d+$/.test(id)) return c.json({ error: 'invalid_id' }, 400)
  return sonarFetch(c.env, `/artists/${id}`)
})

catalogRoute.get('/artists/:id/albums', async (c) => {
  const id = c.req.param('id') ?? ''
  if (!/^\d+$/.test(id)) return c.json({ error: 'invalid_id' }, 400)
  return sonarFetch(c.env, `/artists/${id}/albums`, passthroughQuery(c.req.raw, ['limit', 'offset']))
})

catalogRoute.get('/artists/:id/tracks', async (c) => {
  const id = c.req.param('id') ?? ''
  if (!/^\d+$/.test(id)) return c.json({ error: 'invalid_id' }, 400)
  return sonarFetch(c.env, `/artists/${id}/tracks`, passthroughQuery(c.req.raw, ['limit', 'offset']))
})

catalogRoute.get('/artists/:id/similar', async (c) => {
  const id = c.req.param('id') ?? ''
  if (!/^\d+$/.test(id)) return c.json({ error: 'invalid_id' }, 400)
  return sonarFetch(c.env, `/artists/${id}/similar`, passthroughQuery(c.req.raw, ['limit']))
})

catalogRoute.get('/search/global', async (c) =>
  sonarFetch(c.env, '/search/global', passthroughQuery(c.req.raw, ['q', 'page', 'size'])),
)
