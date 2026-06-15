import type { ReceiverMessage, SenderMessage } from '../public/cast/protocol'
import type { CastFramework } from '../public/cast-sender'

/** Controllable in-memory CastFramework for tests. */
export class FakeCastFramework implements CastFramework {
  sent: SenderMessage[] = []
  failLoad = false
  private stateFn: ((connected: boolean) => void) | null = null
  private msgFn: ((msg: ReceiverMessage) => void) | null = null

  async load(_appId: string): Promise<void> {
    if (this.failLoad) throw new Error('cast_unavailable')
  }
  async requestSession(): Promise<void> {
    this.connect()
  }
  endSession(): void {
    this.disconnect()
  }
  sendMessage(msg: SenderMessage): void {
    this.sent.push(msg)
  }
  onSessionState(fn: (connected: boolean) => void): void {
    this.stateFn = fn
  }
  onMessage(fn: (msg: ReceiverMessage) => void): void {
    this.msgFn = fn
  }

  connect(): void {
    this.stateFn?.(true)
  }
  disconnect(): void {
    this.stateFn?.(false)
  }
  pushMessage(msg: ReceiverMessage): void {
    this.msgFn?.(msg)
  }
}
