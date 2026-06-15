/**
 * Minimal ambient types for the Google Cast Web Sender framework, loaded
 * dynamically from gstatic by cast-sender.ts. Only the surface we touch.
 * Merges with the receiver-side `cast.framework` namespace declarations
 * (caf-types.d.ts) — distinct classes, same namespace.
 */
interface Window {
  __onGCastApiAvailable?: (available: boolean) => void
}

declare namespace chrome.cast {
  const AutoJoinPolicy: { ORIGIN_SCOPED: string }
}

declare namespace cast.framework {
  const CastContextEventType: { SESSION_STATE_CHANGED: string }
  const SessionState: {
    SESSION_STARTED: string
    SESSION_RESUMED: string
    SESSION_ENDED: string
  }

  class CastContext {
    static getInstance(): CastContext
    setOptions(opts: { receiverApplicationId: string; autoJoinPolicy: string }): void
    addEventListener(type: string, fn: (event: { sessionState: string }) => void): void
    getCurrentSession(): CastSession | null
    requestSession(): Promise<string>
    endCurrentSession(stopCasting: boolean): void
  }

  class CastSession {
    sendMessage(namespace: string, message: unknown): Promise<void>
    addMessageListener(namespace: string, listener: (ns: string, message: string) => void): void
  }
}
