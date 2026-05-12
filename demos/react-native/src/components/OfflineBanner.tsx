// demos/react-native/src/components/OfflineBanner.tsx
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIsOnline } from '@/lib/useIsOnline'

export function OfflineBanner() {
  const online = useIsOnline()
  const insets = useSafeAreaInsets()
  if (online) return null
  return (
    <View
      style={[styles.bar, { paddingTop: insets.top + 4 }]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLabel="offline mode"
    >
      <Text style={styles.text}>Offline — only downloaded tracks will play</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#7a1f1f',
    paddingBottom: 6,
    paddingHorizontal: 12,
    zIndex: 100,
  },
  text: { color: '#fff', fontSize: 12, textAlign: 'center' },
})
