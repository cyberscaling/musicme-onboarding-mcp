import 'react-native-gesture-handler'
import { useEffect, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { OfflineModule, refreshExpiringLicenses } from '@demos/offline'
import { BottomTabBar } from '@/components/BottomTabBar'
import { PersistentPlayer } from '@/components/PersistentPlayer'
import { OfflineBanner } from '@/components/OfflineBanner'
import { api } from '@/lib/api'
import { PlayerProvider, usePlayer } from '@/lib/playerStore'

export default function RootLayout() {
  const [streamWorkerUrl, setStreamWorkerUrl] = useState<string | null>(null)

  // Resolve the stream worker URL once on boot. The mint endpoint we hand to
  // the player store is just `api.mintJwt`, no extra plumbing.
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api.config()
        setStreamWorkerUrl(cfg.streamWorkerUrl)
      } catch {
        // Player will surface the issue when the user tries to start a track.
      }
    })()
  }, [])

  // Offline license auto-refresh on foreground. Best-effort: silently swallows
  // errors (no network → tracks just keep their current license until next
  // foreground with connectivity). Exception: subscription expiry surfaces
  // exactly one Alert per session.
  const subExpiredAlerted = useRef(false)
  useEffect(() => {
    async function tick() {
      try {
        const cfg = await api.config()
        const { token } = await api.mintJwt()
        if (!cfg.streamWorkerUrl || !token) return
        const deviceId = await OfflineModule.getDeviceId()
        const { failed } = await refreshExpiringLicenses({
          baseUrl: cfg.streamWorkerUrl.replace(/\/$/, ''),
          jwt: token,
          deviceId,
        })
        const expired = failed.some((f) => f.reason === 'subscription_expired')
        if (expired && !subExpiredAlerted.current) {
          subExpiredAlerted.current = true
          Alert.alert(
            'Subscription expired',
            'Your offline downloads will keep playing until each license expires, but no new licenses can be refreshed until you renew your subscription.',
          )
        }
      } catch {
        // best-effort
      }
    }
    void tick()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tick()
    })
    return () => sub.remove()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StatusBar style="light" />
      <PlayerProvider
        mintToken={async () => (await api.mintJwt()).token}
        streamWorkerUrl={streamWorkerUrl}
      >
        <HydrationBridge />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#000' },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="home" />
          <Stack.Screen name="search" />
          <Stack.Screen name="library" />
          <Stack.Screen name="downloads" />
          <Stack.Screen name="album/[cb]" />
          <Stack.Screen name="artist/[id]" />
          <Stack.Screen name="style/[id]" />
          <Stack.Screen name="player" />
          <Stack.Screen name="queue" />
        </Stack>
        <PersistentPlayer />
        <BottomTabBar />
        <OfflineBanner />
      </PlayerProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function HydrationBridge() {
  const player = usePlayer()
  useEffect(() => {
    void player.hydrateFromStorage()
    // Run once after provider mounts; storage read is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
