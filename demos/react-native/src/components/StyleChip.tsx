import { Pressable, StyleSheet, Text } from 'react-native'
import { router } from 'expo-router'
import type { Style as MusicStyle } from '@/lib/catalog'

export function StyleChip(props: { style: MusicStyle }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      onPress={() => router.push(`/style/${props.style.id}`)}
      accessibilityRole="button"
    >
      <Text style={styles.text}>{props.style.name}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 16, marginRight: 8 },
  pressed: { opacity: 0.7 },
  text: { color: '#eee', fontSize: 12 },
})
