import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { OfflineModule } from '@demos/offline'
import { TopNav } from '@/components/TopNav'
import { api } from '@/lib/api'
import { logoutAndReset } from '@/lib/auth'
import { usePlayer } from '@/lib/playerStore'

export default function Library() {
  const [username, setUsername] = useState<string | null>(null)
  const [offlineCount, setOfflineCount] = useState<number>(0)
  const player = usePlayer()

  useEffect(() => {
    void api.me().then((m) => setUsername(m.username)).catch(() => setUsername(null))
  }, [])

  const refreshOfflineCount = useCallback(async () => {
    try {
      const tracks = await OfflineModule.listTracks()
      setOfflineCount(tracks.length)
    } catch {
      setOfflineCount(0)
    }
  }, [])

  useFocusEffect(useCallback(() => { void refreshOfflineCount() }, [refreshOfflineCount]))

  return (
    <View style={styles.root}>
      <TopNav
        title="Library"
        user={username}
        onLogout={() => { void logoutAndReset(player.stop) }}
      />
      <View style={styles.content}>
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push('/downloads')}
          accessibilityRole="button"
          accessibilityLabel="open downloads"
        >
          <Text style={styles.cardTitle}>Available offline</Text>
          <Text style={styles.cardCount}>{offlineCount}</Text>
          <Text style={styles.cardHint}>
            {offlineCount === 0
              ? 'Tap the download button on any track to make it playable without network.'
              : 'Tap to open downloads →'}
          </Text>
        </Pressable>
        <Text style={styles.muted}>Bientôt: favoris, historique.</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, gap: 24 },
  card: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 16,
    borderColor: '#1a1a1a',
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardPressed: { backgroundColor: '#101010' },
  cardTitle: { color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  cardCount: { color: '#eee', fontSize: 32, fontFamily: 'Menlo', marginTop: 6 },
  cardHint: { color: '#888', fontSize: 12, marginTop: 8 },
  muted: { color: '#666', fontSize: 13, textAlign: 'center' },
})
