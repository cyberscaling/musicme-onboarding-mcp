/**
 * Message protocol on the custom Cast channel between the webapp sender and
 * the CAF receiver (cast.html). Plain JSON objects discriminated by `type`.
 * Breaking change → bump the namespace suffix.
 */
export const CAST_NAMESPACE = 'urn:x-cast:com.cyberscaling.sas'

import type { TrackRef } from '@cyberscaling/secure-audio-stream-client'

/** Wire shape = the SDK's TrackRef — aliased so protocol and SDK cannot drift. */
export type CastTrackRef = TrackRef

export type CastTrackMeta = {
  title: string
  artist?: string
  album?: string
  coverCb?: string
}

export type CastQueueItem = { id: string; ref: CastTrackRef; meta: CastTrackMeta }

export type SenderMessage =
  | {
      type: 'LOAD'
      token: string
      items: CastQueueItem[]
      startId?: string
      positionSec?: number
      autoplay?: boolean
    }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SEEK'; time: number }
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'STOP' }

export type ReceiverState = 'idle' | 'loading' | 'playing' | 'paused'

export type ReceiverMessage =
  | {
      type: 'STATUS'
      state: ReceiverState
      itemId: string | null
      index: number
      currentTime: number
      duration: number
      meta: CastTrackMeta | null
    }
  | { type: 'ERROR'; code: string; message: string }

const SENDER_TYPES = new Set(['LOAD', 'PLAY', 'PAUSE', 'NEXT', 'PREV', 'SEEK', 'SET_TOKEN', 'STOP'])

/** Validate an incoming raw message (receiver side). Returns null if malformed. */
export function parseSenderMessage(raw: unknown): SenderMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (typeof m.type !== 'string' || !SENDER_TYPES.has(m.type)) return null
  switch (m.type) {
    case 'LOAD':
      if (typeof m.token !== 'string' || !Array.isArray(m.items)) return null
      return m as SenderMessage
    case 'SEEK':
      if (typeof m.time !== 'number' || !Number.isFinite(m.time)) return null
      return m as SenderMessage
    case 'SET_TOKEN':
      if (typeof m.token !== 'string') return null
      return m as SenderMessage
    default:
      return m as SenderMessage
  }
}
