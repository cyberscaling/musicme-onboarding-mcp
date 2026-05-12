// demos/react-native/app/style/[id].tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { TopNav } from '@/components/TopNav'
import { AlbumCard } from '@/components/AlbumCard'
import { catalog, type Album } from '@/lib/catalog'
import { ApiError } from '@/lib/api'

export default function StylePage() {
  const params = useLocalSearchParams<{ id: string }>()
  const id = Number(params.id ?? 0)
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setAlbums(null)
    setErr(null)
    if (!id) return
    void (async () => {
      try {
        const r = await catalog.stylePage(id, { limit: 30 })
        setAlbums(r)
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login')
          return
        }
        setErr((e as Error).message)
      }
    })()
  }, [id])

  return (
    <View style={s.root}>
      <TopNav title="Style" back />
      {err ? <Text style={s.err}>error: {err}</Text> : null}
      {albums == null ? (
        <View style={s.center}><ActivityIndicator color="#888" /></View>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(a) => a.cb}
          numColumns={2}
          renderItem={({ item }) => <AlbumCard album={item} />}
          columnWrapperStyle={{ justifyContent: 'space-around' }}
          contentContainerStyle={{ paddingBottom: 200 }}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: '#ff6666', padding: 16, fontFamily: 'Menlo' },
})
