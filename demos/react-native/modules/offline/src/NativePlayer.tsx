import { requireNativeViewManager } from 'expo-modules-core'
import { forwardRef } from 'react'
import type { ViewProps } from 'react-native'
import type { TrackRef } from './types'

const NativeView = requireNativeViewManager('OfflineExpoModule')

export type NativePlayerProps = ViewProps & {
  trackRef: TrackRef
  title?: string
  artist?: string
  coverUrl?: string
  autoPlay?: boolean
  playing?: boolean
  seekToMs?: number | null
  onReady?: (e: { nativeEvent: { duration: number } }) => void
  onError?: (e: { nativeEvent: { message: string } }) => void
  onPlay?: () => void
  onPause?: () => void
  onTimeUpdate?: (e: { nativeEvent: { position: number; duration: number } }) => void
  onEnded?: () => void
  onStalled?: () => void
  onSessionRotated?: () => void
  onMetrics?: (e: { nativeEvent: {
    v: 1
    trackRef: string
    outcome: 'canplay' | 'error' | 'aborted'
    bootstrapMs: number | null
    firstKeyMs: number
    firstRangeMs: number | null
    firstCanplayMs: number | null
    totalPlayMs: number | null
    bufferUnderruns: number
    sessionRotations: number
    fileSizeBytes: number | null
  } }) => void
}

export const NativePlayer = forwardRef<unknown, NativePlayerProps>(
  function NativePlayer(props, ref) {
    return <NativeView ref={ref as any} {...props} />
  },
)
