/**
 * Sender-side Cast session management. All logic lives in CastStore behind
 * the CastFramework interface so it is unit-testable; browserCastFramework
 * is the real adapter over the gstatic Web Sender script (Chrome only).
 * UI subscribes via onChange and mirrors the receiver's STATUS messages.
 */
import { api } from './api'
import {
  CAST_NAMESPACE,
  type CastQueueItem,
  type ReceiverMessage,
  type SenderMessage,
} from './cast/protocol'

export type CastState = 'unavailable' | 'available' | 'connected'

export type CastSnapshot = {
  items: CastQueueItem[]
  startId?: string
  positionSec?: number
  autoplay?: boolean
}

export type CastFramework = {
  /** Resolve once the framework is ready; reject if unavailable. */
  load(appId: string): Promise<void>
  requestSession(): Promise<void>
  endSession(): void
  /** Send on the custom namespace; only valid while connected. */
  sendMessage(msg: SenderMessage): void
  onSessionState(fn: (connected: boolean) => void): void
  onMessage(fn: (msg: ReceiverMessage) => void): void
}

export type CastStoreDeps = {
  framework: CastFramework
  mintToken: () => Promise<string>
}

type RemoteStatus = Extract<ReceiverMessage, { type: 'STATUS' }>

export class CastStore {
  private deps: CastStoreDeps
  private _state: CastState = 'unavailable'
  private _lastStatus: RemoteStatus | null = null
  private listeners = new Set<() => void>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private tokenTtlSeconds = 3600

  constructor(deps: CastStoreDeps) {
    this.deps = deps
  }

  async init(appId: string, tokenTtlSeconds: number): Promise<void> {
    if (tokenTtlSeconds > 0) this.tokenTtlSeconds = tokenTtlSeconds
    try {
      await this.deps.framework.load(appId)
    } catch {
      return // non-Chrome or script blocked — cast stays unavailable
    }
    this._state = 'available'
    this.deps.framework.onSessionState((connected) => {
      this._state = connected ? 'connected' : 'available'
      if (connected) {
        this.startTokenRefresh()
      } else {
        this.stopTokenRefresh()
        this._lastStatus = null
      }
      this.emit()
    })
    this.deps.framework.onMessage((msg) => {
      if (msg.type === 'STATUS') {
        this._lastStatus = msg
        this.emit()
      }
    })
    this.emit()
  }

  get state(): CastState {
    return this._state
  }

  get lastStatus(): RemoteStatus | null {
    return this._lastStatus
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Connect (device picker) or disconnect, depending on current state. */
  async toggleSession(): Promise<void> {
    if (this._state === 'connected') this.deps.framework.endSession()
    else if (this._state === 'available') await this.deps.framework.requestSession()
  }

  /** Hand the local queue over to the receiver. */
  async sendLoad(snapshot: CastSnapshot): Promise<void> {
    if (this._state !== 'connected') return
    const token = await this.deps.mintToken()
    this.deps.framework.sendMessage({
      type: 'LOAD',
      token,
      items: snapshot.items,
      ...(snapshot.startId !== undefined && { startId: snapshot.startId }),
      ...(snapshot.positionSec !== undefined && { positionSec: snapshot.positionSec }),
      ...(snapshot.autoplay !== undefined && { autoplay: snapshot.autoplay }),
    })
  }

  /**
   * Re-send the queue while keeping the currently-playing track. The receiver
   * reconciles in place (no restart) because startId === the playing item.
   */
  async sendReconcile(items: CastQueueItem[], currentId: string): Promise<void> {
    if (this._state !== 'connected') return
    const token = await this.deps.mintToken()
    this.deps.framework.sendMessage({ type: 'LOAD', token, items, startId: currentId })
  }

  seek(time: number): void {
    if (this._state !== 'connected') return
    this.deps.framework.sendMessage({ type: 'SEEK', time })
  }

  control(type: 'PLAY' | 'PAUSE' | 'NEXT' | 'PREV' | 'STOP'): void {
    if (this._state !== 'connected') return
    this.deps.framework.sendMessage({ type })
  }

  private startTokenRefresh(): void {
    // Clear any existing timer first so a second 'connected' event (e.g. a
    // SESSION_RESUMED after SESSION_STARTED) cannot leak a dangling interval.
    this.stopTokenRefresh()
    const periodMs = Math.max(60, this.tokenTtlSeconds * 0.8) * 1000
    this.refreshTimer = setInterval(() => {
      void this.deps.mintToken().then((token) => {
        this.deps.framework.sendMessage({ type: 'SET_TOKEN', token })
      })
    }, periodMs)
  }

  private stopTokenRefresh(): void {
    if (this.refreshTimer != null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}

const CAST_SENDER_SRC = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

/** Real adapter over window.cast.framework (Chrome only). */
export function browserCastFramework(): CastFramework {
  let stateFn: (connected: boolean) => void = () => {}
  let msgFn: (msg: ReceiverMessage) => void = () => {}

  function attachListener(session: cast.framework.CastSession): void {
    session.addMessageListener(CAST_NAMESPACE, (_ns, raw) => {
      try {
        msgFn(JSON.parse(raw) as ReceiverMessage)
      } catch {
        // malformed receiver message — ignore
      }
    })
  }

  return {
    load(appId: string): Promise<void> {
      return new Promise((resolve, reject) => {
        window.__onGCastApiAvailable = (available) => {
          if (!available) {
            reject(new Error('cast_unavailable'))
            return
          }
          const ctx = cast.framework.CastContext.getInstance()
          ctx.setOptions({
            receiverApplicationId: appId,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
          })
          ctx.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
            const connected =
              e.sessionState === cast.framework.SessionState.SESSION_STARTED ||
              e.sessionState === cast.framework.SessionState.SESSION_RESUMED
            if (connected) {
              const s = cast.framework.CastContext.getInstance().getCurrentSession()
              if (s) attachListener(s)
            }
            stateFn(connected)
          })
          resolve()
        }
        const s = document.createElement('script')
        s.src = CAST_SENDER_SRC
        s.onerror = () => reject(new Error('cast_script_blocked'))
        document.head.appendChild(s)
      })
    },
    async requestSession(): Promise<void> {
      await cast.framework.CastContext.getInstance().requestSession()
    },
    endSession(): void {
      cast.framework.CastContext.getInstance().endCurrentSession(true)
    },
    sendMessage(msg: SenderMessage): void {
      const s = cast.framework.CastContext.getInstance().getCurrentSession()
      void s?.sendMessage(CAST_NAMESPACE, msg)
    },
    onSessionState(fn): void {
      stateFn = fn
    },
    onMessage(fn): void {
      msgFn = fn
    },
  }
}

let defaultStore: CastStore | null = null
let testStore: CastStore | null = null

/** Test hook. Production callers MUST NOT use this. */
export function __setTestCastStore(s: CastStore | null): void {
  testStore = s
}

export function getCastStore(): CastStore {
  if (testStore) return testStore
  if (!defaultStore) {
    defaultStore = new CastStore({
      framework: browserCastFramework(),
      mintToken: async () => (await api.mintJwt()).token,
    })
  }
  return defaultStore
}
