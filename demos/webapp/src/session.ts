import type { Env, SessionData } from './types'

const COOKIE_NAME = 'demo_sess'
const KV_PREFIX = 'sess:'

export function readCookie(headerValue: string | null, name: string): string | null {
  if (!headerValue) return null
  for (const part of headerValue.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

export function buildSetCookie(name: string, value: string, ttlSeconds: number, secure: boolean): string {
  const attrs = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ttlSeconds}`,
  ]
  if (secure) attrs.push('Secure')
  return attrs.join('; ')
}

export function buildClearCookie(name: string, secure: boolean): string {
  const attrs = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) attrs.push('Secure')
  return attrs.join('; ')
}

export async function createSession(
  env: Env,
  username: string,
): Promise<{ sid: string; cookieHeader: string }> {
  const sid = crypto.randomUUID()
  const ttl = Number(env.SESSION_TTL_SECONDS)
  const data: SessionData = { username, exp: Date.now() + ttl * 1000 }
  await env.DEMO_SESSIONS.put(`${KV_PREFIX}${sid}`, JSON.stringify(data), { expirationTtl: ttl })
  return { sid, cookieHeader: buildSetCookie(COOKIE_NAME, sid, ttl, true) }
}

export async function getSession(env: Env, request: Request): Promise<SessionData | null> {
  const sid = readCookie(request.headers.get('cookie'), COOKIE_NAME)
  if (!sid) return null
  const raw = await env.DEMO_SESSIONS.get(`${KV_PREFIX}${sid}`)
  if (!raw) return null
  const data = JSON.parse(raw) as SessionData
  if (data.exp < Date.now()) {
    await env.DEMO_SESSIONS.delete(`${KV_PREFIX}${sid}`)
    return null
  }
  return data
}

export async function destroySession(env: Env, request: Request): Promise<string> {
  const sid = readCookie(request.headers.get('cookie'), COOKIE_NAME)
  if (sid) await env.DEMO_SESSIONS.delete(`${KV_PREFIX}${sid}`)
  return buildClearCookie(COOKIE_NAME, true)
}

export { COOKIE_NAME }
