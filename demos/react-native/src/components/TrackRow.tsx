// demos/react-native/src/components/TrackRow.tsx
/**
 * One-line track row used by album, artist top-tracks, and queue screens.
 * `+` button is on the LEFT (parity with webapp commit 58d82e0 — stays
 * visible under an opened queue panel). Tapping the body triggers onPlay.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Cover } from './Cover'
import type { Track } from '@/lib/catalog'

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export function TrackRow(props: {
  track: Track
  index?: number
  showCover?: boolean
  onPlay: () => void
  onEnqueue?: () => void
}) {
  const t = props.track
  return (
    <View style={styles.row}>
      {props.onEnqueue ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="add to queue"
          style={styles.addBtn}
          onPress={props.onEnqueue}
          hitSlop={8}
        >
          <Text style={styles.addIcon}>+</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        onPress={props.onPlay}
      >
        {props.showCover !== false ? (
          <Cover cb={t.cb} size={90} fallbackLabel={t.title} style={styles.cover} />
        ) : null}
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {props.index != null ? `${props.index + 1}. ` : ''}
            {t.title}
          </Text>
          {t.artist ? (
            <Text style={styles.artist} numberOfLines={1}>{t.artist}</Text>
          ) : null}
        </View>
        <Text style={styles.dur}>{formatDuration(t.durationSec)}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  addBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  addIcon: { color: '#888', fontSize: 22, fontWeight: '600' },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 16, paddingVertical: 6, gap: 12 },
  pressed: { backgroundColor: '#0a0a0a' },
  cover: { width: 40, height: 40, borderRadius: 4 },
  text: { flex: 1 },
  title: { color: '#eee', fontSize: 14 },
  artist: { color: '#888', fontSize: 12, marginTop: 2 },
  dur: { color: '#888', fontFamily: 'Menlo', fontSize: 11, width: 44, textAlign: 'right' },
})
