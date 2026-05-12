import { Hono } from 'hono'
import { authRoute } from './auth'
import { jwksRoute } from './jwks'
import { jwtRoute } from './jwt'
import { catalogRoute } from './catalog'
import { sonarRoute } from './sonar'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// JSON config the SPA reads at boot — keeps the stream worker URL out of the
// build output. Partner id is also exposed so the auth-explanation page can
// show realistic values.
app.get('/api/config', (c) =>
  c.json({
    streamWorkerUrl: c.env.STREAM_WORKER_URL,
    partnerId: c.env.PARTNER_ID,
    jwtTtlSeconds: Number(c.env.JWT_TTL_SECONDS),
  }),
)

app.route('/api/auth', authRoute)
app.route('/api/jwt', jwtRoute)
app.route('/api', sonarRoute)
app.route('/api/catalog', catalogRoute)
app.route('/.well-known', jwksRoute)

// Fallback to static assets (SPA). With run_worker_first=true, Static Assets
// is invoked only when we explicitly hand off via this route. Missing files
// return 404 from ASSETS — we rewrite those to /index.html so the SPA router
// can take over for client-side routes (/album/123…, /explain, etc.).
app.all('*', async (c) => {
  const assetRes = await c.env.ASSETS.fetch(c.req.raw)
  if (assetRes.status !== 404) return assetRes
  const indexUrl = new URL('/index.html', c.req.url).toString()
  return c.env.ASSETS.fetch(new Request(indexUrl, { headers: c.req.raw.headers }))
})

app.onError((err, c) => {
  console.error('[webapp] unhandled', err)
  return c.json({ error: 'internal_error', message: err.message }, 500)
})

export default app
