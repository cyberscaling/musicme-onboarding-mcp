/**
 * Custom bottom tab bar. Always rendered at root layout so it stays visible
 * on every screen (album, artist, style, player, queue, …). Tap → router.replace
 * to the target tab. expo-router native Tabs nav was discarded because it
 * hides tab bar as soon as you push to a sibling route at root level.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router, useSegments } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'

const TABS = [
  { name: 'home', icon: 'home-outline' as const, label: 'Accueil' },
  { name: 'search', icon: 'search-outline' as const, label: 'Recherche' },
  { name: 'library', icon: 'albums-outline' as const, label: 'Library' },
]

export const TAB_BAR_BASE_HEIGHT = 49

export function BottomTabBar() {
  const segments = useSegments() as string[]
  const insets = useSafeAreaInsets()
  const first = segments[0] ?? ''
  // Hide on auth / boot screens.
  if (first === 'login' || first === 'index' || first === '') return null

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: TAB_BAR_BASE_HEIGHT + insets.bottom }]}>
      {TABS.map((t) => {
        const active = first === t.name
        return (
          <Pressable
            key={t.name}
            style={styles.tab}
            onPress={() => router.replace(`/${t.name}` as never)}
            accessibilityRole="button"
            accessibilityLabel={t.label}
          >
            <Ionicons name={t.icon} color={active ? '#eee' : '#666'} size={22} />
            <Text style={[styles.label, { color: active ? '#eee' : '#666' }]}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0b0b0b',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    flexDirection: 'row',
  },
  tab: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 6 },
  label: { fontSize: 10, marginTop: 2 },
})
