/**
 * Shared helpers for proxying browser requests to the Sonar catalog API.
 * Centralises x-api-key injection, Cache-Control, and upstream error mapping.
 */
import type { Env } from './types'

export const SONAR_BASE = 'https://sonar.hosting-media.net'

export async function sonarFetch(
  env: Env,
  path: string,
  query?: URLSearchParams,
): Promise<Response> {
  if (!env.SONAR_API_KEY) {
    return new Response(JSON.stringify({ error: 'sonar_not_configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const url = `${SONAR_BASE}${path}${query && [...query.keys()].length ? `?${query.toString()}` : ''}`
  const upstream = await fetch(url, {
    headers: { accept: 'application/json', 'x-api-key': env.SONAR_API_KEY },
  })
  if (upstream.status === 404) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!upstream.ok) {
    const txt = await upstream.text().catch(() => '')
    return new Response(
      JSON.stringify({ error: 'upstream_failed', status: upstream.status, body: txt.slice(0, 200) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const body = await upstream.text()
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  })
}

export function passthroughQuery(req: Request, allowed: readonly string[]): URLSearchParams {
  const src = new URL(req.url).searchParams
  const out = new URLSearchParams()
  for (const k of allowed) {
    const v = src.get(k)
    if (v != null && v !== '') out.set(k, v)
  }
  return out
}
