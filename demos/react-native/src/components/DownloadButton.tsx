// demos/react-native/src/components/DownloadButton.tsx
/**
 * Per-row download button. Reads streamWorkerUrl + a fresh JWT from `api`
 * (same convention as the rest of the demo). Three states: idle → downloading
 * → done. On done, the button shows a checkmark; tap is no-op.
 */
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { OfflineModule, downloadTrack } from '@demos/offline'
import { api } from '@/lib/api'

export function DownloadButton({
  trackId,
  metaJson,
}: {
  trackId: string
  metaJson: string
}) {
  const [state, setState] = useState<'idle' | 'downloading' | 'done'>('idle')

  useEffect(() => {
    OfflineModule.hasTrack(trackId).then((has) => setState(has ? 'done' : 'idle')).catch(() => {})
  }, [trackId])

  async function onPress() {
    if (state !== 'idle') return
    setState('downloading')
    try {
      const [cfg, jwt, deviceId] = await Promise.all([
        api.config(),
        api.mintJwt().then((r) => r.token),
        OfflineModule.getDeviceId(),
      ])
      await downloadTrack({
        baseUrl: cfg.streamWorkerUrl.replace(/\/$/, ''),
        jwt,
        deviceId,
        trackId,
        metaJson,
      })
      setState('done')
    } catch (e) {
      setState('idle')
      console.warn('download failed', e)
    }
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={state !== 'idle'}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={state === 'done' ? 'downloaded' : 'download'}
      style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
    >
      {state === 'downloading' ? (
        <ActivityIndicator color="#0a84ff" />
      ) : state === 'done' ? (
        <Ionicons name="checkmark" color="#4caf50" size={22} />
      ) : (
        <Ionicons name="download-outline" color="#0a84ff" size={22} />
      )}
    </Pressable>
  )
}
