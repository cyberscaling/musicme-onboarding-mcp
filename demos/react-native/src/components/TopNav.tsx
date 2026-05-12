// demos/react-native/src/components/TopNav.tsx
/**
 * Custom header rendered at the top of each screen. Replaces the
 * Stack/Tabs default header for parity with the webapp top-nav. Logout
 * is wired through the optional `onLogout` callback so this file stays
 * UI-only.
 */
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function TopNav(props: {
  title: string
  back?: boolean
  user?: string | null
  onLogout?: () => void
}) {
  const insets = useSafeAreaInsets()
  const initial = props.user ? props.user.slice(0, 1).toUpperCase() : null
  return (
    <View style={[styles.root, { paddingTop: insets.top + 4 }]}>
      <View style={styles.row}>
        {props.back ? (
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="back"
            hitSlop={8}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.title} numberOfLines={1}>{props.title}</Text>
        {initial != null ? (
          <Pressable
            onPress={() => {
              if (!props.onLogout) return
              Alert.alert('Logout', 'Sign out and clear queue?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Logout', style: 'destructive', onPress: props.onLogout },
              ])
            }}
            style={styles.avatar}
            accessibilityRole="button"
            accessibilityLabel="account"
          >
            <Text style={styles.avatarText}>{initial}</Text>
          </Pressable>
        ) : (
          <View style={styles.avatar} />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0b0b0b', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1a1a1a' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, gap: 8, minHeight: 44 },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  backIcon: { color: '#eee', fontSize: 28, fontWeight: '300' },
  title: { color: '#eee', fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#eee', fontSize: 13, fontWeight: '600' },
})
