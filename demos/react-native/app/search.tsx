// demos/react-native/app/(tabs)/search.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { TopNav } from '@/components/TopNav'
import { AlbumCard } from '@/components/AlbumCard'
import { ArtistRow } from '@/components/ArtistRow'
import { catalog, type Album, type Artist } from '@/lib/catalog'
import { ApiError, api } from '@/lib/api'
import { logoutAndReset } from '@/lib/auth'
import { usePlayer } from '@/lib/playerStore'

const UPC_RE = /^\d{12,13}$/

export default function Search() {
  const [q, setQ] = useState('')
  const [albums, setAlbums] = useState<Album[]>([])
  const [artists, setArtists] = useState<Artist[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const player = usePlayer()
  useEffect(() => {
    void api.me().then((m) => setUsername(m.username)).catch(() => setUsername(null))
  }, [])
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const term = q.trim()
    if (term.length < 2) {
      setAlbums([])
      setArtists([])
      setErr(null)
      return
    }
    debounce.current = setTimeout(() => {
      setBusy(true)
      setErr(null)
      catalog.searchGlobal(term)
        .then((r) => {
          setAlbums(r.albums)
          setArtists(r.artists)
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 401) {
            router.replace('/login')
            return
          }
          setErr((e as Error).message)
        })
        .finally(() => setBusy(false))
    }, 300)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [q])

  const empty = useMemo(() => q.trim().length < 2, [q])
  const upcMatch = useMemo(() => {
    const t = q.trim()
    return UPC_RE.test(t) ? t : null
  }, [q])

  return (
    <View style={s.root}>
      <TopNav
        title="Recherche"
        user={username}
        onLogout={() => { void logoutAndReset(player.stop) }}
      />
      <View style={s.inputWrap}>
        <TextInput
          style={s.input}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => {
            if (upcMatch) router.push(`/album/${upcMatch}`)
          }}
          placeholder="titre, album, artiste — ou UPC 12-13 chiffres"
          placeholderTextColor="#555"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          keyboardType={/^\d+$/.test(q) ? 'number-pad' : 'default'}
        />
        {upcMatch ? (
          <Pressable
            style={({ pressed }) => [s.upcBtn, pressed && s.upcBtnPressed]}
            onPress={() => router.push(`/album/${upcMatch}`)}
            accessibilityRole="button"
            accessibilityLabel={`open album by UPC ${upcMatch}`}
          >
            <Text style={s.upcBtnText}>Ouvrir album UPC {upcMatch} →</Text>
          </Pressable>
        ) : null}
      </View>
      {busy ? <ActivityIndicator color="#888" style={{ marginTop: 12 }} /> : null}
      {err ? <Text style={s.err}>error: {err}</Text> : null}
      {empty ? (
        <Text style={s.hint}>tape un titre, artiste, album</Text>
      ) : (
        <ScrollView contentContainerStyle={s.results}>
          {albums.length > 0 ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Albums</Text>
              <FlatList
                data={albums}
                keyExtractor={(a) => a.cb}
                numColumns={2}
                scrollEnabled={false}
                renderItem={({ item }) => <AlbumCard album={item} />}
                columnWrapperStyle={{ justifyContent: 'space-around' }}
              />
            </View>
          ) : null}
          {artists.length > 0 ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Artistes</Text>
              {artists.map((a) => <ArtistRow key={a.id} artist={a} />)}
            </View>
          ) : null}
          {!busy && albums.length === 0 && artists.length === 0 ? (
            <Text style={s.hint}>aucun résultat</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  inputWrap: { paddingHorizontal: 16, paddingVertical: 12 },
  input: { borderWidth: 1, borderColor: '#333', color: '#eee', padding: 12, borderRadius: 6, fontSize: 16 },
  upcBtn: { marginTop: 10, padding: 12, backgroundColor: '#0a3c6b', borderRadius: 6, alignItems: 'center' },
  upcBtnPressed: { backgroundColor: '#082d4f' },
  upcBtnText: { color: '#cce4ff', fontSize: 14, fontFamily: 'Menlo' },
  err: { color: '#ff6666', padding: 16, fontFamily: 'Menlo' },
  hint: { color: '#666', padding: 24, textAlign: 'center' },
  results: { paddingBottom: 200 },
  section: { marginTop: 16 },
  sectionTitle: { color: '#eee', fontSize: 17, fontWeight: '600', paddingHorizontal: 16, marginBottom: 8 },
})
