import 'react-native-gesture-handler'
import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { BottomTabBar } from '@/components/BottomTabBar'
import { PersistentPlayer } from '@/components/PersistentPlayer'
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
          <Stack.Screen name="album/[cb]" />
          <Stack.Screen name="artist/[id]" />
          <Stack.Screen name="style/[id]" />
          <Stack.Screen name="player" />
          <Stack.Screen name="queue" />
        </Stack>
        <PersistentPlayer />
        <BottomTabBar />
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
