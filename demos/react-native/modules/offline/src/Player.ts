import { OfflineModule } from './module'
import type { TrackRef } from './types'

export type PlayerConfigureOptions = {
  baseUrl: string
  tokenProvider: () => Promise<string>
  /** Refresh interval for the cached token (ms). Default 4 minutes. */
  refreshIntervalMs?: number
}

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'

type Listeners = {
  state: Array<(s: PlayerStatus) => void>
  error: Array<(e: { code: string; message: string }) => void>
}

class PlayerImpl {
  private listeners: Listeners = { state: [], error: [] }
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private tokenProvider: (() => Promise<string>) | null = null
  private baseUrl: string | null = null

  async configure(opts: PlayerConfigureOptions): Promise<void> {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.tokenProvider = opts.tokenProvider
    const initial = await opts.tokenProvider()
    await OfflineModule.configurePlayer(this.baseUrl, initial)
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    const interval = opts.refreshIntervalMs ?? 4 * 60_000
    this.refreshTimer = setInterval(() => { void this.refreshToken() }, interval)
  }

  async refreshToken(): Promise<void> {
    if (!this.tokenProvider) return
    try {
      const t = await this.tokenProvider()
      await OfflineModule.setStreamToken(t)
    } catch {
      // best-effort
    }
  }

  on(event: 'state', cb: (s: PlayerStatus) => void): () => void
  on(event: 'error', cb: (e: { code: string; message: string }) => void): () => void
  on(event: keyof Listeners, cb: (...args: any[]) => void): () => void {
    this.listeners[event].push(cb as any)
    return () => {
      this.listeners[event] = this.listeners[event].filter((l) => l !== cb) as any
    }
  }

  _emitState(s: PlayerStatus): void { for (const l of this.listeners.state) l(s) }
  _emitError(e: { code: string; message: string }): void { for (const l of this.listeners.error) l(e) }

  async prefetch(ref: TrackRef): Promise<void> {
    try { await OfflineModule.prefetch(ref) } catch { /* best-effort */ }
  }
}

export const Player = new PlayerImpl()
