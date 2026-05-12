// demos/react-native/src/lib/auth.ts
import { router } from 'expo-router'
import { OfflineModule } from '@demos/offline'
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
  try {
    await OfflineModule.wipeAll()
  } catch {
    // Native call can fail if the module isn't loaded (e.g. Expo Go). Don't
    // block logout — the redirect still happens.
  }
  router.replace('/login')
}
