// demos/react-native/src/lib/auth.ts
import { router } from 'expo-router'
import { api } from './api'
import { persistence, PLAYLIST_KEY } from './persistence'

export async function logoutAndReset(stop: () => void): Promise<void> {
  try {
    await api.logout()
  } catch {
    // ignore — best-effort
  }
  stop()
  await persistence.remove(PLAYLIST_KEY)
  router.replace('/login')
}
