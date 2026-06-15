/**
 * Lightweight fetch wrappers for the demo SPA. All paths are same-origin and
 * use the session cookie; no JWTs surface to the browser except the one we
 * mint server-side and hand to the SDK via getToken().
 */
export type Me = { username: string; exp: number }

export type AppConfig = {
  streamWorkerUrl: string
  partnerId: string
  jwtTtlSeconds: number
  castAppId: string
}

export type BioMode = 'fast' | 'deep'

export type ArtistBio = {
  summary: string
  bio_markdown: string
  highlights: string[]
  genres: string[]
  years_active: string
  notable_works: string[]
  origin: string
}

export type BioMetrics = {
  cached: boolean
  phases: Array<{ name: string; ms: number }>
  totalMs: number
  llm: { calls: number; promptTokens: number; completionTokens: number; costUsd: number }
  serper: { queries: number; unitUsd: number; costUsd: number }
  totalCostUsd: number
}

export type BioResult = {
  id: string
  name: string
  mode: BioMode
  outcome: 'hit' | 'built'
  sourceUrl: string
  bio: ArtistBio
  metrics: BioMetrics
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'ApiError'
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'include', ...init })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}) as { error?: string })
    const code = (body as { error?: string }).error ?? `http_${r.status}`
    throw new ApiError(r.status, code)
  }
  return (await r.json()) as T
}

export const api = {
  config: () => jsonFetch<AppConfig>('/api/config'),

  login: (username: string, password: string) =>
    jsonFetch<{ ok: boolean; username: string }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  logout: async () => {
    try {
      return await jsonFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
    } finally {
      const { playlistStore } = await import('./playlist-store')
      playlistStore.clear()
      const audio = document.getElementById('player') as HTMLAudioElement | null
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
      }
    }
  },

  me: () => jsonFetch<Me>('/api/auth/me'),

  mintJwt: () =>
    jsonFetch<{ token: string; expiresAt: number }>('/api/jwt', {
      method: 'POST',
    }),

  artistBio: (id: number, name: string, mode: BioMode, refresh = false) => {
    const q = new URLSearchParams({ name, mode })
    if (refresh) q.set('refresh', '1')
    return jsonFetch<BioResult>(`/api/artist-bio/${id}?${q.toString()}`)
  },
}

/** Workspace bar with nav + logout. */
export type NavActive = 'search' | 'explain'
