// demos/react-native/src/components/AlbumCard.tsx
/**
 * Square grid card. Designed for FlatList numColumns=2 with horizontal
 * padding on parent.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Cover } from './Cover'
import type { Album } from '@/lib/catalog'

export function AlbumCard(props: { album: Album; size?: number }) {
  const size = props.size ?? 150
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed, { width: size }]}
      onPress={() => router.push(`/album/${props.album.cb}`)}
      accessibilityRole="button"
    >
      <Cover cb={props.album.coverCb} size={175} fallbackLabel={props.album.title} style={{ width: size, height: size, borderRadius: 4 }} />
      <Text numberOfLines={2} style={styles.title}>{props.album.title}</Text>
      {props.album.artist ? (
        <Text numberOfLines={1} style={styles.artist}>{props.album.artist}</Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { padding: 6 },
  pressed: { opacity: 0.7 },
  title: { color: '#eee', fontSize: 13, marginTop: 6 },
  artist: { color: '#888', fontSize: 11, marginTop: 2 },
})
