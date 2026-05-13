import 'react-native-gesture-handler'
import { useEffect, useRef } from 'react'
import { Alert, AppState } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { OfflineModule, Player, refreshExpiringLicenses } from '@demos/offline'
import { BottomTabBar } from '@/components/BottomTabBar'
import { PersistentPlayer } from '@/components/PersistentPlayer'
import { OfflineBanner } from '@/components/OfflineBanner'
import { api } from '@/lib/api'
import { PlayerProvider, usePlayer } from '@/lib/playerStore'

export default function RootLayout() {
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api.config()
        if (!cfg.streamWorkerUrl) return
        await Player.configure({
          baseUrl: cfg.streamWorkerUrl,
          tokenProvider: async () => (await api.mintJwt()).token,
        })
      } catch {
        // Player will surface the issue when the user tries to start a track.
      }
    })()
  }, [])

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
        <PlayerProvider>
          <HydrationBridge />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}>
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
  useEffect(() => { void player.hydrateFromStorage() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  return null
}
