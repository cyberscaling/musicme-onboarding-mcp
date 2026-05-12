import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { router } from 'expo-router'
import { api, ApiError } from '@/lib/api'

export default function Index() {
  useEffect(() => {
    void (async () => {
      try {
        await api.me()
        router.replace('/home')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login')
          return
        }
        router.replace('/login')
      }
    })()
  }, [])

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
      <ActivityIndicator color="#888" />
    </View>
  )
}
