// demos/react-native/app/downloads.tsx
/**
 * Downloads screen. Lists tracks persisted by @demos/offline. Tap → play
 * via PersistentPlayer (which auto-routes to OfflineNativePlayer because
 * the track is in the offline catalog). The delete action removes the
 * blob + license + meta entry, then refreshes.
 */
import { useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { OfflineModule, type OfflineTrack } from '@demos/offline'
import { TopNav } from '@/components/TopNav'
import { usePlayer } from '@/lib/playerStore'

function parseTrackId(id: string): { cb: number; disc: number; track: number } | null {
  const parts = id.split(':')
  if (parts.length !== 3) return null
  const cb = Number(parts[0]), disc = Number(parts[1]), track = Number(parts[2])
  if (!Number.isFinite(cb) || !Number.isFinite(disc) || !Number.isFinite(track)) return null
  return { cb, disc, track }
}

export default function DownloadsScreen() {
  const [tracks, setTracks] = useState<OfflineTrack[]>([])
  const player = usePlayer()

  async function refresh() {
    setTracks(await OfflineModule.listTracks())
  }

  useEffect(() => { void refresh() }, [])

  return (
    <View style={s.root}>
      <TopNav title="Downloads" back />
      <FlatList
        data={tracks}
        keyExtractor={(t) => t.trackId}
        renderItem={({ item }) => {
          const ref = parseTrackId(item.trackId)
          return (
            <Pressable
              style={({ pressed }) => [s.row, pressed && s.pressed]}
              onPress={() => {
                if (!ref) return
                void player.playSingle({
                  cb: ref.cb, disc: ref.disc, track: ref.track, context: 'on_demand',
                  ...(item.meta.title ? { title: item.meta.title } : {}),
                  ...(item.meta.artist ? { artist: item.meta.artist } : {}),
                })
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>{item.meta.title ?? item.trackId}</Text>
                <Text style={s.meta} numberOfLines={1}>
                  {item.meta.artist ?? ''} · {(item.sizeBytes / 1024 / 1024).toFixed(1)} MB · exp {new Date(item.licenseExp * 1000).toLocaleDateString()}
                </Text>
              </View>
              <Pressable
                hitSlop={12}
                onPress={async (e) => {
                  e.stopPropagation()
                  await OfflineModule.removeTrack(item.trackId)
                  void refresh()
                }}>
                <Text style={s.action}>delete</Text>
              </Pressable>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <Text style={s.empty}>No downloaded tracks yet.</Text>
        }
        contentContainerStyle={{ paddingBottom: 200 }}
      />
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  row: {
    padding: 12, borderBottomColor: '#222', borderBottomWidth: 1,
    flexDirection: 'row', alignItems: 'center',
  },
  pressed: { backgroundColor: '#0a0a0a' },
  title: { color: '#eee', fontSize: 14 },
  meta: { color: '#888', fontSize: 12, marginTop: 2 },
  action: { color: '#0a84ff', paddingHorizontal: 8, fontSize: 13 },
  empty: { color: '#666', textAlign: 'center', padding: 24, fontSize: 13 },
})
