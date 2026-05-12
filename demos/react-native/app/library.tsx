import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TopNav } from '@/components/TopNav'
import { api } from '@/lib/api'
import { logoutAndReset } from '@/lib/auth'
import { usePlayer } from '@/lib/playerStore'

export default function Library() {
  const [username, setUsername] = useState<string | null>(null)
  const player = usePlayer()
  useEffect(() => {
    void api.me().then((m) => setUsername(m.username)).catch(() => setUsername(null))
  }, [])

  return (
    <View style={styles.root}>
      <TopNav
        title="Library"
        user={username}
        onLogout={() => { void logoutAndReset(player.stop) }}
      />
      <View style={styles.center}>
        <Text style={styles.muted}>Bientôt: favoris, historique.</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: '#666', fontSize: 13, textAlign: 'center' },
})
