// demos/react-native/app/artist/[id].tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { TopNav } from '@/components/TopNav'
import { AlbumCard } from '@/components/AlbumCard'
import { ArtistRow } from '@/components/ArtistRow'
import { TrackRow } from '@/components/TrackRow'
import { catalog, type Album, type Artist, type Track } from '@/lib/catalog'
import { ApiError } from '@/lib/api'
import { usePlayer } from '@/lib/playerStore'

export default function ArtistPage() {
  const params = useLocalSearchParams<{ id: string }>()
  const id = Number(params.id ?? 0)
  const [data, setData] = useState<{ artist: Artist; albums: Album[]; topTracks: Track[]; similar: Artist[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const player = usePlayer()

  useEffect(() => {
    setData(null)
    setErr(null)
    if (!id) return
    void (async () => {
      try {
        const r = await catalog.artist(id)
        setData(r)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login')
          return
        }
        setErr((e as Error).message)
      }
    })()
  }, [id])

  if (err) {
    return (
      <View style={s.root}>
        <TopNav title="Artiste" back />
        <View style={s.center}><Text style={s.err}>error: {err}</Text></View>
      </View>
    )
  }
  if (!data) {
    return (
      <View style={s.root}>
        <TopNav title="Artiste" back />
        <View style={s.center}><ActivityIndicator color="#888" /></View>
      </View>
    )
  }

  return (
    <View style={s.root}>
      <TopNav title={data.artist.name} back />
      <ScrollView contentContainerStyle={{ paddingBottom: 200 }}>
        {data.artist.bio ? (
          <Text style={s.bio} numberOfLines={6}>{data.artist.bio}</Text>
        ) : null}

        {data.albums.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Albums</Text>
            <FlatList
              data={data.albums}
              keyExtractor={(a) => a.cb}
              numColumns={2}
              scrollEnabled={false}
              renderItem={({ item }) => <AlbumCard album={item} />}
              columnWrapperStyle={{ justifyContent: 'space-around' }}
            />
          </View>
        ) : null}

        {data.topTracks.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Top tracks</Text>
            {data.topTracks.map((t, i) => (
              <TrackRow
                key={`${t.cb}-${t.disc}-${t.track}`}
                track={t}
                index={i}
                onPlay={() => {
                  void player.playSingle({ cb: Number(t.cb), disc: t.disc, track: t.track, context: 'on_demand', title: t.title, artist: t.artist ?? data.artist.name })
                }}
                onEnqueue={() => player.enqueue({
                  ref: { cb: Number(t.cb), disc: t.disc, track: t.track, context: 'on_demand' as const },
                  meta: { title: t.title, artist: t.artist ?? data.artist.name },
                })}
              />
            ))}
          </View>
        ) : null}

        {data.similar.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Similaires</Text>
            {data.similar.map((a) => <ArtistRow key={a.id} artist={a} />)}
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: '#ff6666', fontFamily: 'Menlo' },
  bio: { color: '#bbb', paddingHorizontal: 16, paddingTop: 12, fontSize: 13, lineHeight: 18 },
  section: { marginTop: 16 },
  sectionTitle: { color: '#eee', fontSize: 17, fontWeight: '600', paddingHorizontal: 16, marginBottom: 8 },
})
