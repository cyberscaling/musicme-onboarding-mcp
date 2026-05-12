import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { authedCookie, mockGlobalFetch } from './helpers'

async function send(req: Request): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await app.fetch(req, env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

describe('/api/catalog/* — auth gate', () => {
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  const routes = [
    '/api/catalog/albums/top',
    '/api/catalog/albums/news',
    '/api/catalog/styles',
    '/api/catalog/albums/5400863209100',
    '/api/catalog/albums/5400863209100/tracks',
    '/api/catalog/artists/123',
    '/api/catalog/artists/123/albums',
    '/api/catalog/artists/123/tracks',
    '/api/catalog/artists/123/similar',
    '/api/catalog/search/global?q=test',
  ]

  for (const path of routes) {
    it(`401 without session cookie : ${path}`, async () => {
      const r = await send(new Request(`https://x${path}`))
      expect(r.status).toBe(401)
    })
  }
})

describe('/api/catalog/* — proxy behaviour', () => {
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  it('injects x-api-key + forwards to sonar', async () => {
    restore = mockGlobalFetch((url, _init, req) => {
      expect(url).toContain('sonar.hosting-media.net/albums/top')
      expect(req.headers.get('x-api-key')).toBe('test-sonar-key')
      return new Response(JSON.stringify([{ cb: '1', album: 'X' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }).restore as never
    const cookie = await authedCookie(env)
    const r = await send(
      new Request('https://x/api/catalog/albums/top?limit=5', { headers: { Cookie: cookie } }),
    )
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toContain('max-age=60')
    expect(await r.json()).toEqual([{ cb: '1', album: 'X' }])
  })

  it('forwards query params (style_id, limit, offset)', async () => {
    let capturedUrl = ''
    restore = mockGlobalFetch((url) => {
      capturedUrl = url
      return new Response('[]', { status: 200 })
    }).restore as never
    const cookie = await authedCookie(env)
    await send(
      new Request('https://x/api/catalog/albums/top?style_id=2&limit=5&offset=10', {
        headers: { Cookie: cookie },
      }),
    )
    expect(capturedUrl).toContain('style_id=2')
    expect(capturedUrl).toContain('limit=5')
    expect(capturedUrl).toContain('offset=10')
  })

  it('returns 404 when upstream is 404', async () => {
    restore = mockGlobalFetch(() => new Response('not found', { status: 404 })).restore as never
    const cookie = await authedCookie(env)
    const r = await send(
      new Request('https://x/api/catalog/albums/5400863999999', { headers: { Cookie: cookie } }),
    )
    expect(r.status).toBe(404)
  })

  it('returns 503 when SONAR_API_KEY missing', async () => {
    const cookie = await authedCookie(env)
    const altEnv = { ...env, SONAR_API_KEY: '' } as typeof env
    const ctx = createExecutionContext()
    const res = await app.fetch(
      new Request('https://x/api/catalog/styles', { headers: { Cookie: cookie } }),
      altEnv,
      ctx,
    )
    await waitOnExecutionContext(ctx)
    expect(res.status).toBe(503)
  })

  it('returns 502 on upstream 5xx', async () => {
    restore = mockGlobalFetch(() => new Response('upstream blew up', { status: 500 })).restore as never
    const cookie = await authedCookie(env)
    const r = await send(
      new Request('https://x/api/catalog/styles', { headers: { Cookie: cookie } }),
    )
    expect(r.status).toBe(502)
  })

  it('search/global passes q param', async () => {
    let capturedUrl = ''
    restore = mockGlobalFetch((url) => {
      capturedUrl = url
      return new Response('{"hits":[]}', { status: 200 })
    }).restore as never
    const cookie = await authedCookie(env)
    await send(
      new Request('https://x/api/catalog/search/global?q=daft%20punk', { headers: { Cookie: cookie } }),
    )
    expect(capturedUrl).toContain('search/global')
    expect(capturedUrl).toContain('q=daft')
  })
})
