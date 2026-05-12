import { Hono } from 'hono'
import { createSession, destroySession, getSession } from './session'
import type { Env } from './types'

export const authRoute = new Hono<{ Bindings: Env }>()

/** Parse `DEMO_USERS` env: comma-separated `user:pass` pairs. */
function parseUsers(s: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const pair of s.split(',')) {
    const [u, p] = pair.split(':')
    if (u && p) m.set(u.trim(), p.trim())
  }
  return m
}

authRoute.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { username?: string; password?: string } | null
  const username = body?.username?.trim()
  const password = body?.password?.trim()
  if (!username || !password) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const users = parseUsers(c.env.DEMO_USERS)
  if (users.get(username) !== password) {
    // constant-ish delay — simple defence against trivial brute force
    await new Promise((r) => setTimeout(r, 250))
    return c.json({ error: 'bad_credentials' }, 401)
  }
  const { cookieHeader } = await createSession(c.env, username)
  return new Response(JSON.stringify({ ok: true, username }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader },
  })
})

authRoute.post('/logout', async (c) => {
  const clearHeader = await destroySession(c.env, c.req.raw)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearHeader },
  })
})

authRoute.get('/me', async (c) => {
  const sess = await getSession(c.env, c.req.raw)
  if (!sess) return c.json({ error: 'unauthenticated' }, 401)
  return c.json({ username: sess.username, exp: sess.exp })
})
