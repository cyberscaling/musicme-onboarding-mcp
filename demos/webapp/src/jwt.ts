/**
 * RS256 JWT minting for the demo as a registered partner.
 *
 * The stream worker resolves the partner via `iss`, fetches the JWKS at
 * `partner.jwks_url`, and verifies the RS256 signature against `kid`. So the
 * minted JWT must carry:
 *   - header.kid     matching JWKS_PUBLIC_JWK.kid
 *   - payload.iss    matching the partner row's `expected_iss`
 *   - payload.aud    matching the partner row's `expected_aud` (default: secure-audio-stream)
 *   - payload.sub    user id (audited / hashed downstream)
 *   - payload.exp    short-lived (env JWT_TTL_SECONDS)
 */
import { Hono } from 'hono'
import { getSession } from './session'
import type { Env } from './types'

export const jwtRoute = new Hono<{ Bindings: Env }>()

const enc = new TextEncoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlEncodeJSON(obj: unknown): string {
  return base64UrlEncode(enc.encode(JSON.stringify(obj)))
}

/** Strip PEM armor and decode the PKCS#8 body. */
function pemToPkcs8(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(cleaned)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

let cachedKey: { kid: string; key: CryptoKey } | null = null

async function getSigningKey(env: Env): Promise<{ kid: string; key: CryptoKey }> {
  if (cachedKey) return cachedKey
  if (!env.RSA_PRIVATE_KEY_PEM) throw new Error('RSA_PRIVATE_KEY_PEM not set')
  if (!env.JWKS_PUBLIC_JWK) throw new Error('JWKS_PUBLIC_JWK not set')
  const jwk = JSON.parse(env.JWKS_PUBLIC_JWK) as { kid?: string }
  const kid = jwk.kid ?? 'demo-1'
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(env.RSA_PRIVATE_KEY_PEM),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  cachedKey = { kid, key }
  return cachedKey
}

function deriveIss(env: Env, request: Request): string {
  const override = env.ISS_OVERRIDE?.trim()
  if (override) return override
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

export async function mintRs256Jwt(
  env: Env,
  request: Request,
  sub: string,
): Promise<{ token: string; payload: Record<string, unknown> }> {
  const { kid, key } = await getSigningKey(env)
  const ttl = Number(env.JWT_TTL_SECONDS)
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT', kid }
  const payload = {
    iss: deriveIss(env, request),
    aud: 'secure-audio-stream',
    sub,
    iat: now,
    exp: now + ttl,
  }
  const signingInput = `${base64UrlEncodeJSON(header)}.${base64UrlEncodeJSON(payload)}`
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      enc.encode(signingInput),
    ),
  )
  const token = `${signingInput}.${base64UrlEncode(sig)}`
  return { token, payload }
}

jwtRoute.post('/', async (c) => {
  const sess = await getSession(c.env, c.req.raw)
  if (!sess) return c.json({ error: 'unauthenticated' }, 401)
  try {
    const { token, payload } = await mintRs256Jwt(c.env, c.req.raw, sess.username)
    return c.json({ token, expiresAt: (payload.exp as number) * 1000 })
  } catch (e) {
    return c.json({ error: 'mint_failed', message: (e as Error).message }, 500)
  }
})
