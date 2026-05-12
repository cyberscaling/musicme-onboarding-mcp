export type Me = { username: string; exp: number }

export type SonarTrack = {
  id: string
  disc_number: number
  track_number: number
  title: string
  timing: number
}

export type SonarAlbumResponse = {
  album: {
    id: number
    title: string
    release_date?: string
    label?: string
    track_count: number
    artists?: { id: number; name: string }[]
  }
  artists?: { id: number; name: string }[]
  tracks: SonarTrack[]
}

export type JwtResponse = { token: string; expiresAt: number }

export type AppConfig = {
  streamWorkerUrl: string
  partnerId: string
  jwtTtlSeconds: number
}
