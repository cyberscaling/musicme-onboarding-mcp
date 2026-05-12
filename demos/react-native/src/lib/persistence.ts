/**
 * AsyncStorage wrapper with JSON serialisation. Mirrors the localStorage
 * shape used by the webapp playlist-store so the player store hydration
 * logic stays symmetric across demos.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

export const persistence = {
  get: async <T,>(key: string): Promise<T | null> => {
    const raw = await AsyncStorage.getItem(key)
    if (raw == null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },
  set: async <T,>(key: string, value: T): Promise<void> => {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  },
  remove: async (key: string): Promise<void> => {
    await AsyncStorage.removeItem(key)
  },
}

export const PLAYLIST_KEY = 'musicme:rn:playlist:v1'
