/**
 * Thin fetch wrappers over webapp. Cookies are handled by the underlying
 * native HTTP client (NSURLSession on iOS, OkHttp on Android) — fetch's
 * `credentials: 'include'` is implicit on RN, but we set it for clarity.
 *
 * No retries, no token storage — the integrator scenario is intentionally bare:
 * login → cookie → /api/jwt → SDK call.
 */
import { WEBAPP_URL } from './config'
import type { AppConfig, JwtResponse, Me, SonarAlbumResponse } from './types'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${WEBAPP_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(r.status, body.error ?? `http_${r.status}`)
  }
  return (await r.json()) as T
}

export type AlbumWarmupReport = {
  cb: number
  tracks: number
  head_cached: number
  edge_filled: number
  edge_errors: number
  batches: number
  phases_ms: Record<string, number>
}

type BatchResponse = {
  cb: number
  tracks: number
  offset: number
  limit: number
  head_cached: number
  edge_filled: number
  edge_unverified: number
  edge_errors: number
  phases_ms: Record<string, number>
}

const WARMUP_BATCH_SIZE = 8

/**
 * Calls the stream worker's `/warmup-album` directly. The integrator scenario
 * is "fire on album page mount, don't await" — first track tap then lands on a
 * fully-warm cache stack.
 *
 * The function does the boilerplate of resolving the stream worker URL,
 * minting a fresh JWT, and POSTing — partner SDKs use the equivalent
 * `prefetchAlbum(workerUrl, token, cb)` exported from
 * @cyberscaling/secure-audio-stream-client.
 */
export const api = {
  config: () => call<AppConfig>('/api/config'),
  login: (username: string, password: string) =>
    call<{ ok: boolean; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => call<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => call<Me>('/api/auth/me'),
  album: (cb: string) => call<SonarAlbumResponse>(`/api/album/${encodeURIComponent(cb)}`),
  mintJwt: () => call<JwtResponse>('/api/jwt', { method: 'POST' }),

  async warmupAlbum(cb: number): Promise<AlbumWarmupReport> {
    const cfg = await api.config()
    const { token } = await api.mintJwt()
    const base = cfg.streamWorkerUrl.replace(/\/$/, '')

    async function batch(offset: number, limit: number): Promise<BatchResponse> {
      const r = await fetch(`${base}/warmup-album`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cb, offset, limit }),
      })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        throw new ApiError(r.status, body.error ?? `http_${r.status}`)
      }
      return (await r.json()) as BatchResponse
    }

    const first = await batch(0, WARMUP_BATCH_SIZE)
    const reports: BatchResponse[] = [first]
    if (first.tracks > WARMUP_BATCH_SIZE) {
      const remaining: Promise<BatchResponse>[] = []
      for (let off = WARMUP_BATCH_SIZE; off < first.tracks; off += WARMUP_BATCH_SIZE) {
        remaining.push(batch(off, WARMUP_BATCH_SIZE))
      }
      const settled = await Promise.allSettled(remaining)
      for (const s of settled) if (s.status === 'fulfilled') reports.push(s.value)
    }
    return {
      cb,
      tracks: first.tracks,
      head_cached: reports.reduce((s, r) => s + r.head_cached, 0),
      edge_filled: reports.reduce((s, r) => s + r.edge_filled, 0),
      edge_errors: reports.reduce((s, r) => s + r.edge_errors, 0),
      batches: reports.length,
      phases_ms: first.phases_ms,
    }
  },

  async warmupTracks(refs: Array<{ cb: number; disc: number; track: number }>): Promise<{
    refs_total: number
    refs_warmed: number
    head_cached: number
    edge_filled: number
    edge_errors: number
    not_found: number
    batches: number
    phases_ms: Record<string, number>
  }> {
    if (refs.length === 0) {
      return { refs_total: 0, refs_warmed: 0, head_cached: 0, edge_filled: 0, edge_errors: 0, not_found: 0, batches: 0, phases_ms: {} }
    }
    const cfg = await api.config()
    const { token } = await api.mintJwt()
    const base = cfg.streamWorkerUrl.replace(/\/$/, '')
    const BATCH = 8
    const batches: Array<typeof refs> = []
    for (let i = 0; i < refs.length; i += BATCH) batches.push(refs.slice(i, i + BATCH))

    type BatchRes = {
      refs_total: number
      refs_warmed: number
      head_cached: number
      edge_filled: number
      edge_unverified: number
      edge_errors: number
      not_found: number
      phases_ms: Record<string, number>
    }
    async function call(b: typeof refs): Promise<BatchRes> {
      const r = await fetch(`${base}/warmup-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ refs: b }),
      })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        throw new ApiError(r.status, body.error ?? `http_${r.status}`)
      }
      return (await r.json()) as BatchRes
    }

    const settled = await Promise.allSettled(batches.map(call))
    const reports = settled
      .filter((s): s is PromiseFulfilledResult<BatchRes> => s.status === 'fulfilled')
      .map((s) => s.value)
    return {
      refs_total: refs.length,
      refs_warmed: reports.reduce((s, r) => s + r.refs_warmed, 0),
      head_cached: reports.reduce((s, r) => s + r.head_cached, 0),
      edge_filled: reports.reduce((s, r) => s + r.edge_filled, 0),
      edge_errors: reports.reduce((s, r) => s + r.edge_errors, 0),
      not_found: reports.reduce((s, r) => s + r.not_found, 0),
      batches: reports.length,
      phases_ms: reports[0]?.phases_ms ?? {},
    }
  },
}
