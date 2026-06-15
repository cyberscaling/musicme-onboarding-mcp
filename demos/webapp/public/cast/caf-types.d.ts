/**
 * Minimal ambient types for the CAF receiver framework, loaded via <script>
 * from gstatic in cast.html. Only the surface main.ts touches.
 */
declare namespace cast.framework {
  class CastReceiverContext {
    static getInstance(): CastReceiverContext
    addCustomMessageListener(
      namespace: string,
      listener: (event: { senderId: string; data: unknown }) => void,
    ): void
    sendCustomMessage(namespace: string, senderId: string | undefined, message: unknown): void
    addEventListener(type: string, handler: (event: unknown) => void): void
    start(options?: {
      disableIdleTimeout?: boolean
      skipPlayersLoad?: boolean
      maxInactivity?: number
    }): CastReceiverContext
  }

  namespace system {
    const EventType: { SENDER_CONNECTED: string }
  }
}
