// demos/react-native/app/(tabs)/home.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { TopNav } from '@/components/TopNav'
import { AlbumCard } from '@/components/AlbumCard'
import { StyleChip } from '@/components/StyleChip'
import { catalog, type Album, type Style as MusicStyle } from '@/lib/catalog'
import { ApiError, api } from '@/lib/api'
import { logoutAndReset } from '@/lib/auth'
import { usePlayer } from '@/lib/playerStore'

export default function Home() {
  const [top, setTop] = useState<Album[] | null>(null)
  const [news, setNews] = useState<Album[] | null>(null)
  const [styles_, setStyles] = useState<MusicStyle[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const player = usePlayer()
  useEffect(() => {
    void api.me().then((m) => setUsername(m.username)).catch(() => setUsername(null))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [t, n, s] = await Promise.all([
          catalog.topAlbums({ limit: 12 }),
          catalog.newsAlbums({ limit: 12 }),
          catalog.styles(),
        ])
        setTop(t)
        setNews(n)
        setStyles(s)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login')
          return
        }
        setErr((e as Error).message)
      }
    })()
  }, [])

  return (
    <View style={s.root}>
      <TopNav
        title="Accueil"
        user={username}
        onLogout={() => { void logoutAndReset(player.stop) }}
      />
      <ScrollView contentContainerStyle={s.scroll}>
        {err ? <Text style={s.err}>error: {err}</Text> : null}

        <Section title="Top">
          {top == null ? <ActivityIndicator color="#888" /> : <Grid albums={top} />}
        </Section>

        <Section title="Nouveautés">
          {news == null ? <ActivityIndicator color="#888" /> : <Grid albums={news} />}
        </Section>

        <Section title="Styles">
          {styles_ == null ? (
            <ActivityIndicator color="#888" />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
              {styles_.map((st) => <StyleChip key={st.id} style={st} />)}
            </ScrollView>
          )}
        </Section>
      </ScrollView>
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Grid({ albums }: { albums: Album[] }) {
  return (
    <FlatList
      data={albums}
      keyExtractor={(a) => a.cb}
      numColumns={2}
      scrollEnabled={false}
      renderItem={({ item }) => <AlbumCard album={item} />}
      columnWrapperStyle={s.gridRow}
    />
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  scroll: { paddingBottom: 200 },
  err: { color: '#ff6666', padding: 16, fontFamily: 'Menlo' },
  section: { marginTop: 16 },
  sectionTitle: { color: '#eee', fontSize: 17, fontWeight: '600', paddingHorizontal: 16, marginBottom: 8 },
  gridRow: { justifyContent: 'space-around' },
  chipsRow: { paddingHorizontal: 16, paddingVertical: 4 },
})
