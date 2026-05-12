import { vi } from 'vitest'

export type FetchHandler = (
  url: string,
  init: RequestInit | undefined,
  request: Request,
) => Promise<Response> | Response

export function mockGlobalFetch(handler: FetchHandler): {
  restore: () => void
  calls: Array<{ url: string; method: string; headers: Headers }>
} {
  const calls: Array<{ url: string; method: string; headers: Headers }> = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    let req: Request
    if (input instanceof Request) {
      req = input
    } else {
      req = new Request(typeof input === 'string' ? input : (input as URL).toString(), init)
    }
    calls.push({ url: req.url, method: req.method, headers: new Headers(req.headers) })
    return handler(req.url, init, req)
  })
  return {
    restore: () => spy.mockRestore(),
    calls,
  }
}

export async function authedCookie(env: { DEMO_SESSIONS: KVNamespace }, username = 'alice'): Promise<string> {
  const { createSession, COOKIE_NAME } = await import('../src/session')
  const { cookieHeader } = await createSession(env as never, username)
  // cookieHeader is the full Set-Cookie value; extract just the token for the Cookie header
  const token = cookieHeader.split(';')[0].split('=').slice(1).join('=')
  return `${COOKIE_NAME}=${token}`
}
