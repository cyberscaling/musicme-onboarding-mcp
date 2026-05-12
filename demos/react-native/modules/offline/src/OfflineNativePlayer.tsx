import { requireNativeViewManager } from 'expo-modules-core'
import { forwardRef } from 'react'
import type { ViewProps } from 'react-native'

const NativeView = requireNativeViewManager('OfflineExpoModule')

export type OfflineNativePlayerProps = ViewProps & {
  trackId: string
  autoPlay?: boolean
  /** Declarative play state. Native observes changes and calls .play() / .pause(). */
  playing?: boolean
  /** When set to a non-null number, native seeks to that position (ms). JS should reset to null after dispatch. */
  seekToMs?: number | null
  onReady?: () => void
  onError?: (e: { nativeEvent: { message: string } }) => void
  onPlay?: () => void
  onPause?: () => void
  onTimeUpdate?: (e: { nativeEvent: { position: number } }) => void
  onEnded?: () => void
}

export const OfflineNativePlayer = forwardRef<unknown, OfflineNativePlayerProps>(
  function OfflineNativePlayer(props, ref) {
    return <NativeView ref={ref as any} {...props} />
  },
)
