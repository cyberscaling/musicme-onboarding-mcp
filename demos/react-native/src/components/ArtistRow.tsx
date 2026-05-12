import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import type { Artist } from '@/lib/catalog'

export function ArtistRow(props: { artist: Artist }) {
  const initial = (props.artist.name ?? '?').slice(0, 1).toUpperCase()
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => router.push(`/artist/${props.artist.id}`)}
      accessibilityRole="button"
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>{props.artist.name}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, gap: 12, minHeight: 48 },
  pressed: { backgroundColor: '#0a0a0a' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#eee', fontSize: 16, fontWeight: '600' },
  name: { color: '#eee', fontSize: 14, flex: 1 },
})
