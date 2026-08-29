// demos/react-native/app/album/[cb].tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { TopNav } from '@/components/TopNav'
import { Cover } from '@/components/Cover'
import { TrackRow } from '@/components/TrackRow'
import { catalog, type Album, type Track } from '@/lib/catalog'
import { api, ApiError } from '@/lib/api'
import { usePlayer } from '@/lib/playerStore'

export default function AlbumPage() {
  const params = useLocalSearchParams<{ cb: string }>()
  const cb = params.cb ?? ''
  const [data, setData] = useState<{ album: Album; tracks: Track[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const player = usePlayer()

  useEffect(() => {
    setData(null)
    setErr(null)
    void (async () => {
      if (!cb) return
      try {
        const r = await catalog.album(cb)
        setData(r)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login')
          return
        }
        setErr((e as Error).message)
      }
    })()
    void (async () => {
      if (!cb) return
      try {
        await api.warmupAlbum(Number(cb))
      } catch {
        // best-effort
      }
    })()
  }, [cb])

  if (err) {
    return (
      <View style={s.root}>
        <TopNav title="Album" back />
        <View style={s.center}><Text style={s.err}>error: {err}</Text></View>
      </View>
    )
  }
  if (!data) {
    return (
      <View style={s.root}>
        <TopNav title="Album" back />
        <View style={s.center}><ActivityIndicator color="#888" /></View>
      </View>
    )
  }

  const a = data.album
  const tracks = data.tracks
  const albumArtist = a.artist ?? ''
  const refs = tracks.map((t) => ({
    ref: { cb: Number(t.cb || cb), disc: t.disc, track: t.track, context: 'on_demand' as const },
    meta: { title: t.title, ...(t.artist || albumArtist ? { artist: t.artist ?? albumArtist } : {}) },
  }))

  return (
    <View style={s.root}>
      <TopNav title={a.title} back />
      <FlatList
        data={tracks}
        keyExtractor={(t) => `${t.disc}-${t.track}`}
        ListHeaderComponent={
          <View style={s.header}>
            <Cover cb={a.coverCb} size={295} fallbackLabel={a.title} style={s.cover} />
            <Text style={s.title}>{a.title}</Text>
            {a.artist ? (
              <Pressable
                onPress={() => a.artistId != null ? router.push(`/artist/${a.artistId}`) : undefined}
              >
                <Text style={[s.artist, a.artistId != null && s.linkable]}>{a.artist}</Text>
              </Pressable>
            ) : null}
            {a.releaseDate ? <Text style={s.muted}>{a.releaseDate}</Text> : null}
            <Pressable
              onPress={() => { void player.playAlbumEphemeral(refs, 0) }}
              style={s.playAll}
            >
              <Text style={s.playAllText}>▶ Play all</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            index={index}
            showCover={false}
            onPlay={() => { void player.playAlbumEphemeral(refs, index) }}
            onEnqueue={() => player.enqueue({
              ref: { cb: Number(item.cb || cb), disc: item.disc, track: item.track, context: 'on_demand' as const },
              meta: { title: item.title, ...(item.artist || albumArtist ? { artist: item.artist ?? albumArtist } : {}) },
            })}
          />
        )}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        contentContainerStyle={{ paddingBottom: 200 }}
      />
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: '#ff6666', fontFamily: 'Menlo' },
  header: { alignItems: 'center', padding: 16 },
  cover: { borderRadius: 6 },
  title: { color: '#eee', fontSize: 18, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  artist: { color: '#bbb', marginTop: 4 },
  linkable: { textDecorationLine: 'underline' },
  muted: { color: '#777', fontSize: 12, marginTop: 4 },
  playAll: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 18, backgroundColor: '#eee', borderRadius: 6 },
  playAllText: { color: '#000', fontWeight: '600' },
  sep: { height: 1, backgroundColor: '#111' },
})
